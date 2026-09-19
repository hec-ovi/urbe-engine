import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ExteriorWorkers } from '../../../assembly/ExteriorWorkers.js';
import { sharedRoot } from '../../../assembly/SharedResources.js';
import { PlanLibrary } from '../../../assembly/kit/PlanLibrary.js';
import { parcelBlueprint } from '../../../assembly/kit/PlanBlueprint.js';
import { PLAN_INDEX_FILE } from '../../../assembly/kit/KitFiles.js';
import { cityGltfLoader } from '../../data/CityGltfLoader.js';
import { isSceneryNode } from '../ShellSurface.js';
import { openingRect } from '../Openings.js';
import { Interactor } from '../../player/Interactor.js';
import { releaseShell } from '../streaming/ReleaseShell.js';
import { FrameBudget } from '../../../app/FrameBudget.js';
import { PlanBlueprints } from '../../data/PlanBlueprints.js';
import { ReadBudget } from '../../data/ReadBudget.js';
import { KitPieces } from './KitPieces.js';
import { KitCellLoader } from './KitCells.js';

/** One approved family on a 24 by 32 m lot: an entrance, balcony doors and a roof. */
const FAMILY = 'mirror-frame';
const BAYS = { across: 3, deep: 4 };
/** Two plans of it, so a city can read one and come back for the other. */
const FLOORS = [ 5, 10 ];
const PLANS = FLOORS.map( ( floors ) => `${FAMILY}-${BAYS.across}x${BAYS.deep}x${floors}f` );

const factory = {
	resolver: { resolve: () => null },
	build: () => new THREE.MeshStandardMaterial(),
	variant: () => new THREE.MeshStandardMaterial()
};

let workers = null;
let index = null;
/** plan id -> the plan's own blueprint, which a parcel's is composed from */
let blueprints = null;

/** The world's plan index, read exactly as the runtime reads it from a world. */
function openWorld( { mutate = ( document ) => document, slice, skipUnnamed = false } = {} ) {

	const reads = [];
	const blueprintReads = [];
	const kit = mutate( JSON.parse( JSON.stringify( index ) ) );
	// The city's one plan blueprint reader, built exactly as WorldSource builds it.
	const blueprints = new PlanBlueprints( {
		urls: new Map( kit.plans.map( ( plan ) => [ plan.id, `${sharedRoot()}/${plan.blueprint}` ] ) ),
		readJson: async ( url ) => {

			blueprintReads.push( url );

			return JSON.parse( await readFile( url, 'utf8' ) );

		},
		budget: new ReadBudget()
	} );
	const removed = { triangles: 0 };
	const loader = cityGltfLoader();

	if ( skipUnnamed ) {

		// A read that trusted node names kept the merged surfaces, the window
		// scenery and the door leaves, and left everything else out.
		const parse = loader.parseAsync.bind( loader );
		loader.parseAsync = async ( ...args ) => {

			const gltf = await parse( ...args );
			const strays = [];
			gltf.scene.traverse( ( node ) => {

				if ( node.isMesh && ! isSceneryNode( node ) && ! /^(merged|door)/.test( node.name ) ) strays.push( node );

			} );
			for ( const node of strays ) {

				removed.triangles += trianglesIn( node.geometry );
				node.removeFromParent();

			}

			return gltf;

		};

	}

	const pieces = new KitPieces( {
		kit, baseUrl: sharedRoot(), factory, blueprints, slice, loader,
		readBinary: async ( url ) => {

			reads.push( url );
			const bytes = await readFile( url );

			return bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );

		}
	} );

	return { kit, pieces, reads, blueprints, blueprintReads, removed };

}

/** One parcel standing from a shared plan, in the shape assembly writes it. */
function building( parcel, { origin = [ 100, 0, 50 ], rotationY = Math.PI / 2, plan = PLANS[ 0 ] } = {} ) {

	const lot = [ [ 0, 0 ], [ 24, 0 ], [ 24, 32 ], [ 0, 32 ] ].map( ( [ u, v ] ) => [
		origin[ 0 ] + u * Math.cos( rotationY ) + v * Math.sin( rotationY ),
		origin[ 2 ] - u * Math.sin( rotationY ) + v * Math.cos( rotationY )
	] );

	return {
		parcel, plan, origin, rotationY, lot,
		bounds: {
			min: [ Math.min( ...lot.map( ( c ) => c[ 0 ] ) ), 0, Math.min( ...lot.map( ( c ) => c[ 1 ] ) ) ],
			max: [ Math.max( ...lot.map( ( c ) => c[ 0 ] ) ), blueprints.get( plan ).bounds.height, Math.max( ...lot.map( ( c ) => c[ 1 ] ) ) ]
		},
		signText: null, family: FAMILY, floors: blueprints.get( plan ).floors.length, tint: parcel
	};

}

/** What BuildingSource hands the loader for one kit parcel. */
function source( record, hasInterior ) {

	return [ record.parcel, {
		parcelId: record.parcel, source: 'kit', placementsUrl: `/${record.parcel}.placements.json`,
		hasInterior, blueprint: parcelBlueprint( blueprints.get( record.plan ), record )
	} ];

}

function serving( records ) {

	const byUrl = new Map( records.map( ( record ) => [ `/${record.parcel}.placements.json`, record ] ) );

	return async ( url ) => byUrl.get( url );

}

/** The stream admits a cell hidden and shows it once the skyline excludes it. */
async function shown( loader, sources ) {

	const cell = await loader.load( new Map( sources ) );
	cell.group.visible = true;

	return cell;

}

/** Copies standing in the shared batches, over the whole city. */
function live( pieces ) {

	return pieces.batches.copies;

}

/** Every triangle a geometry draws, indexed or not. */
function trianglesIn( geometry ) {

	return ( geometry.getIndex()?.count ?? geometry.getAttribute( 'position' ).count ) / 3;

}

/** What one building of a plan appends: its shell, its leaves and its fake rooms. */
function copiesOf( pieces, planId ) {

	const plan = pieces.plans.get( planId );

	return 1 + ( plan.leaves.length ? 1 : 0 ) + ( plan.scenery.length ? 1 : 0 );

}

/** Every material the plans and their entrance leaves wear between them. */
function materialsOf( pieces ) {

	const buckets = new Set();

	for ( const plan of pieces.plans.values() ) {

		for ( const { bucket } of [ ...plan.surfaces, ...plan.scenery ] ) buckets.add( bucket );
		for ( const leaf of plan.leaves ) for ( const { bucket } of leaf.surfaces ) buckets.add( bucket );

	}

	return buckets;

}

describe( 'the city draws every building from its shared plan', () => {

	beforeAll( async () => {

		workers = new ExteriorWorkers( 1 );

		const library = new PlanLibrary( { workers } );

		for ( const floors of FLOORS ) library.want( FAMILY, BAYS, floors );
		await library.draw();
		const reference = library.publish();

		index = JSON.parse( readFileSync( join( sharedRoot(), reference.shared, PLAN_INDEX_FILE ), 'utf8' ) );
		blueprints = new Map( PLANS.map( ( id ) => [ id, library.blueprint( id ) ] ) );

	}, 300_000 );

	afterAll( async () => {

		await workers.close();

	} );

	it( 'reads a plan the first time a cell stands on it, keeps one batch per material, and appends and drops exactly a cell\'s copies', async () => {

		const { pieces, reads } = openWorld();

		// A city that has admitted nothing has read nothing: the index alone says
		// what it publishes.
		expect( reads ).toHaveLength( 0 );
		expect( pieces.published( PLANS[ 1 ] ) ).toBe( true );
		expect( pieces.has( PLANS[ 1 ] ) ).toBe( false );

		const first = building( 'p1' );
		const second = building( 'p2', { origin: [ 300, 0, 400 ], rotationY: 0 } );
		const tall = building( 'p3', { origin: [ 600, 0, 900 ], rotationY: 0, plan: PLANS[ 1 ] } );
		const loader = new KitCellLoader( { pieces, factory, readJson: serving( [ first, second, tall ] ) } );
		const hidden = await loader.load( new Map( [ source( first, false ) ] ) );

		// One plan read, and only the one this cell stands on.
		expect( reads ).toHaveLength( 1 );
		expect( reads.some( ( url ) => url.includes( PLANS[ 1 ] ) ) ).toBe( false );

		// One batch per material the standing plans wear, for the whole city,
		// whatever is standing in it.
		const materials = materialsOf( pieces );
		expect( materials.size ).toBeGreaterThan( 1 );
		expect( pieces.batchCount ).toBe( materials.size );
		expect( [ ...pieces.batches.batches.keys() ].sort() ).toEqual( [ ...materials ].sort() );

		// Facades cast and receive; per copy culling answers for the batch.
		const meshes = [ ...pieces.batches.batches.values() ].map( ( batch ) => batch.mesh );
		expect( meshes.every( ( mesh ) => mesh.isBatchedMesh && mesh.castShadow && mesh.receiveShadow ) ).toBe( true );
		expect( meshes.every( ( mesh ) => mesh.perObjectFrustumCulled && ! mesh.frustumCulled ) ).toBe( true );

		// Nothing of a cell reaches the shared draws while the skyline still
		// carries its impostors.
		expect( live( pieces ) ).toBe( 0 );

		hidden.group.visible = true;
		const one = live( pieces );
		expect( one ).toBeGreaterThan( 0 );

		// A second parcel of the same plan costs the same copies, no new read and
		// no new batch.
		const other = await shown( loader, [ source( second, false ) ] );
		expect( live( pieces ) ).toBe( one * 2 );
		expect( reads ).toHaveLength( 1 );
		expect( pieces.batchCount ).toBe( materials.size );

		// A cell standing on a plan nothing has needed yet reads it then, and it
		// joins the batches its materials already own.
		const later = await shown( loader, [ source( tall, false ) ] );
		expect( reads ).toHaveLength( 2 );
		expect( pieces.has( PLANS[ 1 ] ) ).toBe( true );
		expect( pieces.batchCount ).toBe( materials.size );

		later.disposeModelInstances();
		other.disposeModelInstances();
		expect( live( pieces ) ).toBe( one );

		hidden.disposeModelInstances();
		expect( live( pieces ) ).toBe( 0 );

	} );

	it( 'draws every mesh node a plan publishes, whatever the producer named it', async () => {

		const whole = openWorld();
		const named = openWorld( { skipUnnamed: true } );

		await whole.pieces.want( [ PLANS[ 0 ] ] );
		await named.pieces.want( [ PLANS[ 0 ] ] );

		// This plan really does publish nodes outside the merged prefix: the
		// parts its family signs itself with, named after the family.
		expect( named.removed.triangles ).toBeGreaterThan( 0 );

		// And every one of their triangles stands in the batches.
		expect( whole.pieces.trianglesOf( PLANS[ 0 ] ) - named.pieces.trianglesOf( PLANS[ 0 ] ) )
			.toBe( named.removed.triangles );

	} );

	it( 'admits a cell a step at a time while the city is drawn, and flat out while it loads', async () => {

		// A frame yield waits for the display; an event loop turn does not, which
		// is how the two answers tell themselves apart.
		const frames = [];
		vi.stubGlobal( 'requestAnimationFrame', ( run ) => {

			frames.push( run );
			setTimeout( () => run( 0 ), 0 );

		} );

		// Every step is over budget, so each one that yields is counted.
		const slice = new FrameBudget( { slice: 0, paced: false } );
		const { pieces } = openWorld( { slice } );
		const first = building( 'p1' );
		const loader = new KitCellLoader( { pieces, factory, slice, readJson: serving( [ first ] ) } );
		const loading = new Map( [ source( first, false ) ] );

		await loader.open( loading );
		await loader.load( loading );

		// A load has no frame to protect and has to finish before there is one.
		expect( frames ).toHaveLength( 0 );
		expect( pieces.has( PLANS[ 0 ] ) ).toBe( true );

		// Playing, standing a plan and building a building hand the frame back
		// between their steps rather than holding it for the whole cell.
		slice.pace();
		const later = building( 'p2', { origin: [ 300, 0, 400 ], rotationY: 0, plan: PLANS[ 1 ] } );
		const playing = new Map( [ source( later, false ) ] );
		const other = new KitCellLoader( { pieces, factory, slice, readJson: serving( [ later ] ) } );

		await other.open( playing );
		await other.load( playing );

		expect( pieces.has( PLANS[ 1 ] ) ).toBe( true );
		expect( frames.length ).toBeGreaterThan( 20 );
		vi.unstubAllGlobals();

	} );

	it( 'reads a plan\'s blueprint once for the city, whoever asks for it', async () => {

		const { pieces, blueprints, blueprintReads } = openWorld();
		const record = building( 'p1' );
		const loader = new KitCellLoader( { pieces, factory, readJson: serving( [ record ] ) } );

		// What every parcel standing on this plan composes its own blueprint from.
		expect( await blueprints.of( PLANS[ 0 ] ) ).toBeTruthy();

		// And what the kit reads the plan's doors and openings out of when it
		// stands it. One document, one read.
		await shown( loader, [ source( record, false ) ] );

		expect( pieces.has( PLANS[ 0 ] ) ).toBe( true );
		expect( blueprintReads ).toHaveLength( 1 );

	} );

	it( 'appends a copy as one instance per surface, with its geometry, matrix and tint, and grows past its first capacity', async () => {

		const { pieces } = openWorld();
		const planId = PLANS[ 0 ];
		await pieces.want( [ planId ] );

		const plan = pieces.plans.get( planId );
		const colour = new THREE.Color( 0.25, 0.5, 0.75 );
		const matrix = new THREE.Matrix4().makeRotationY( Math.PI / 2 ).setPosition( 12, 4.5, - 7 );
		const handle = pieces.admit( planId, matrix, colour );

		// One instance per surface, each in the batch its material owns, each
		// pointing at the geometry that surface was registered as.
		expect( handle.parts.map( ( part ) => part.batch.name ) )
			.toEqual( plan.surfaces.map( ( surface ) => `kit-plans:${surface.bucket}` ) );
		expect( handle.leaf.parts ).toHaveLength( plan.leaves.flatMap( ( leaf ) => leaf.surfaces ).length );

		for ( const [ index, { batch, geometryId } ] of [ ...handle.parts, ...handle.leaf.parts ].entries() ) {

			const instance = [ ...handle.instances, ...handle.leaf.instances ][ index ];
			expect( batch.mesh.getGeometryIdAt( instance ) ).toBe( geometryId );
			expect( batch.mesh.getMatrixAt( instance, new THREE.Matrix4() ).elements )
				.toEqual( matrix.elements.map( ( value ) => expect.closeTo( value, 4 ) ) );
			expect( batch.mesh.getColorAt( instance, new THREE.Color() ).toArray() )
				.toEqual( colour.toArray().map( ( value ) => expect.closeTo( value, 5 ) ) );

		}

		// A batch that runs out of room reallocates without losing a copy.
		const batch = handle.parts[ 0 ].batch;
		const first = batch.capacity;
		const held = [];
		for ( let i = 0; i < first * 2; i ++ ) held.push( pieces.admit( planId, matrix, colour ) );

		expect( batch.capacity ).toBeGreaterThan( first );
		expect( batch.count ).toBe( held.length + 1 );
		expect( batch.mesh.getMatrixAt( handle.instances[ 0 ], new THREE.Matrix4() ).elements )
			.toEqual( matrix.elements.map( ( value ) => expect.closeTo( value, 4 ) ) );

		for ( const one of held ) pieces.release( one );
		pieces.release( handle );
		expect( live( pieces ) ).toBe( 0 );

	} );

	it( 'gives every building a cuboid compound with a hole wherever its blueprint is open', async () => {

		const { pieces } = openWorld();
		const flat = building( 'p1', { origin: [ 0, 0, 0 ], rotationY: 0 } );
		const loader = new KitCellLoader( { pieces, factory, readJson: serving( [ flat ] ) } );
		const closed = await loader.load( new Map( [ source( flat, false ) ] ) );

		expect( closed.shellColliders.size ).toBe( 0 );
		expect( closed.boxColliders.every( ( box ) => box.center.length === 3
			&& box.halfExtents.length === 3 && box.halfExtents.every( ( half ) => half > 0 )
			&& Number.isFinite( box.rotationY ) ) ).toBe( true );

		// The roof reads solid from above, and the stair head comes through it.
		const top = flat.bounds.max[ 1 ];
		const { bulkhead } = parcelBlueprint( blueprints.get( flat.plan ), flat ).roof;
		expect( solidAt( closed.boxColliders, 2, top - 0.2, 2 ) ).toBe( true );
		expect( solidAt( closed.boxColliders, bulkhead.center[ 0 ], top - 0.2, bulkhead.center[ 1 ] ) ).toBe( false );

		// A closed building fills its own doorway with the leaf it never opens.
		const door = doorOf( flat );
		const at = ( boxes ) => solidAt( boxes, door.center.x, door.center.y + 1, door.center.z );

		expect( at( closed.boxColliders ) ).toBe( true );

		// A parcel that swings its own door loses that cuboid, and the doorway is
		// a real hole through the lot wall while the wall beside it stands.
		const open = await loader.load( new Map( [ source( flat, true ) ] ) );

		expect( open.boxColliders.length ).toBe( closed.boxColliders.length - 1 );
		expect( at( open.boxColliders ) ).toBe( false );
		expect( solidAt( open.boxColliders, 0.25, 1, 16 ) ).toBe( true );

	} );

	it( 'publishes the entrance from the plan and swings its leaves', async () => {

		const { pieces } = openWorld();
		const record = building( 'p1' );
		const loader = new KitCellLoader( { pieces, factory, readJson: serving( [ record ] ) } );
		const cell = await shown( loader, [ source( record, true ) ] );

		expect( cell.entrances ).toEqual( cell.doors );
		expect( cell.doors ).toHaveLength( 1 );

		const door = cell.doors[ 0 ];
		const planned = doorOf( record );

		expect( door.parcelId ).toBe( 'p1' );
		expect( door.pivots.length ).toBeGreaterThan( 0 );
		// The door stands where the plan's own blueprint puts it in this frame.
		expect( door.center.distanceTo( planned.center ) ).toBeLessThan( 1e-6 );
		expect( door.hinge.distanceTo( door.center ) ).toBeCloseTo( door.width / 2 );
		// Outside is out of the building and inside is into it.
		expect( door.outside.clone().sub( door.center ).dot( door.normal ) ).toBeGreaterThan( 0 );
		expect( door.inside.clone().sub( door.center ).dot( door.normal ) ).toBeLessThan( 0 );

		door.wanted = 1;
		interactorFor( cell.doors ).update( 0.5, null );
		expect( door.pivots.every( ( leaf ) => leaf.pivot.rotation.y !== leaf.closedRotation.y ) ).toBe( true );

		cell.disposeModelInstances();
		releaseShell( cell );

	} );

	it( 'draws a parcel that opens a real interior without the plan\'s window scenery', async () => {

		const { pieces } = openWorld();
		const record = building( 'p1' );
		const loader = new KitCellLoader( { pieces, factory, readJson: serving( [ record ] ) } );
		const closed = await shown( loader, [ source( record, false ) ] );
		const plan = pieces.plans.get( record.plan );
		expect( plan.scenery.length ).toBeGreaterThan( 0 );
		const whole = pieces.batches.instanceCount;
		closed.group.visible = false;
		expect( pieces.batches.instanceCount ).toBe( 0 );

		// An open parcel swings its own leaves and shows its real rooms, so
		// neither the shared leaves nor the fake rooms stand in the batches.
		const swung = plan.leaves.reduce( ( sum, leaf ) => sum + leaf.surfaces.length, 0 );
		const open = await shown( loader, [ source( record, true ) ] );
		expect( pieces.batches.instanceCount ).toBe( whole - plan.scenery.length - swung );
		open.disposeModelInstances();
		releaseShell( open );

	} );

	it( 'refuses a record naming a plan this world does not publish', async () => {

		const { pieces } = openWorld();
		const record = building( 'p1' );
		const loader = new KitCellLoader( { pieces, factory, readJson: serving( [ { ...record, plan: 'garden-taper-3x3x9f' } ] ) } );

		await expect( loader.load( new Map( [ source( record, false ) ] ) ) )
			.rejects.toThrow( /E_KIT_PLACEMENT: p1 stands from garden-taper-3x3x9f/ );
		expect( live( pieces ) ).toBe( 0 );

	} );

	it( 'leaves the parcels of a plan whose bytes differ from the index as empty lots, and stands the rest of the cell', async () => {

		const { pieces } = openWorld( { mutate: ( document ) => {

			for ( const plan of document.plans ) if ( plan.id === PLANS[ 1 ] ) plan.bytes += 1;

			return document;

		} } );
		const good = building( 'p1' );
		const corrupt = building( 'p2', { origin: [ 300, 0, 400 ], rotationY: 0, plan: PLANS[ 1 ] } );
		const onError = vi.fn();
		const loader = new KitCellLoader( { pieces, factory, onError, readJson: serving( [ good, corrupt ] ) } );
		const cell = await shown( loader, [ source( good, false ), source( corrupt, false ) ] );

		// The city says which plan it could not read and which parcels that costs.
		expect( onError ).toHaveBeenCalledOnce();
		expect( onError.mock.calls[ 0 ][ 0 ] ).toMatchObject( { code: 'E_KIT_PIECES', message: /p2 stay empty lots/ } );
		expect( pieces.failure( PLANS[ 1 ] ).message ).toMatch( /the index publishes/ );

		// The good parcel stands, with its copies and its colliders; the empty lot
		// has neither.
		expect( pieces.has( PLANS[ 0 ] ) ).toBe( true );
		expect( live( pieces ) ).toBe( copiesOf( pieces, PLANS[ 0 ] ) );
		expect( cell.centers.has( 'p1' ) ).toBe( true );
		expect( cell.centers.has( 'p2' ) ).toBe( false );
		expect( cell.boxColliders.length ).toBeGreaterThan( 0 );

		cell.disposeModelInstances();
		expect( live( pieces ) ).toBe( 0 );

	} );

} );

/** Where the street entrance of one parcel stands, from its composed blueprint. */
function doorOf( record ) {

	const ground = parcelBlueprint( blueprints.get( record.plan ), record ).floors.find( ( floor ) => floor.index === 0 );
	const opening = ground.openings.find( ( entry ) => entry.doorRole === 'main' );
	const rect = openingRect( ground, opening );

	return {
		center: rect.start.clone().add( rect.end ).multiplyScalar( 0.5 ).setY( rect.y0 ),
		width: rect.width
	};

}

/** Whether a point stands inside any of these cuboids. */
function solidAt( boxes, x, y, z ) {

	return boxes.some( ( box ) => {

		const local = new THREE.Vector3( x - box.center[ 0 ], y - box.center[ 1 ], z - box.center[ 2 ] )
			.applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), - box.rotationY );

		return Math.abs( local.x ) <= box.halfExtents[ 0 ]
			&& Math.abs( local.y ) <= box.halfExtents[ 1 ]
			&& Math.abs( local.z ) <= box.halfExtents[ 2 ];

	} );

}

function interactorFor( doors ) {

	return new Interactor( {
		crowd: { within: () => [] },
		doors,
		sim: {},
		controller: {
			body: { feet: new THREE.Vector3( 1e4, 0, 1e4 ) },
			eye: new THREE.Vector3( 1e4, 0, 1e4 ),
			look: new THREE.Vector3( 0, 0, - 1 )
		},
		quests: { candidates: () => [] }
	} );

}
