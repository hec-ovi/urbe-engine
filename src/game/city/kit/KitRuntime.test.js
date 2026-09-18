import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { planAssembly } from '../../../../../exterior/src/index.ts';
import { Interactor } from '../../player/Interactor.js';
import { releaseShell } from '../streaming/ReleaseShell.js';
import { KitPieces } from './KitPieces.js';
import { KitCellLoader } from './KitCells.js';

const KIT_DIR = new URL( '../../../../../exterior/out/kit', import.meta.url ).pathname;

const factory = {
	resolver: { resolve: () => null },
	build: () => new THREE.MeshStandardMaterial(),
	variant: () => new THREE.MeshStandardMaterial()
};

/** The published kit, read exactly as the runtime reads it from a world. */
async function openKit( { mutate = ( kit ) => kit } = {} ) {

	const kit = mutate( JSON.parse( await readFile( `${KIT_DIR}/kit.json`, 'utf8' ) ) );
	const reads = [];
	const pieces = new KitPieces( { kit, baseUrl: KIT_DIR, factory, readBinary: async ( url ) => {

		reads.push( url );
		const bytes = await readFile( url );

		return bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );

	} } );

	return { kit, pieces, reads };

}

/**
 * One building in the shape kit assembly writes it: the plan, drawn once at the
 * origin with face 0 along +X, and the parcel record that stands it somewhere.
 */
function building( { parcel = 'p1', family = 'mirror-frame', width = 24, depth = 32, floors = 5, frame } = {} ) {

	const at = frame ?? { position: [ 100, 0, 50 ], rotationY: Math.PI / 2 };
	const { blueprint, ...drawn } = planAssembly( {
		family, buildingId: parcel, seed: 'kit', theme: 'cyberpunk',
		parcel: { footprint: [ [ 0, 0 ], [ width, 0 ], [ width, depth ], [ 0, depth ] ], accessPoint: [ width / 2, 0 ], maxHeight: 200 },
		building: { type: 'offices', tier: 'mid', floors },
		entranceEdge: 0
	} );
	const pieces = [ ...new Set( drawn.placements.map( ( piece ) => piece.piece ) ) ];
	const id = `${family}-${width / 8}x${depth / 8}x${floors}f`;
	const lot = worldRing( at, width, depth );

	return {
		plan: {
			id, family: drawn.family, baysAcross: width / 8, baysDeep: depth / 8, floors,
			bands: drawn.bands,
			pieces,
			placements: drawn.placements.map( ( { piece, face, position, rotationY } ) => ( {
				piece: pieces.indexOf( piece ), face, position, rotationY
			} ) ),
			signAnchors: drawn.signAnchors, doors: drawn.doors
		},
		record: {
			parcel, plan: id, origin: at.position, rotationY: at.rotationY, lot,
			bounds: {
				min: [ Math.min( ...lot.map( c => c[ 0 ] ) ), at.position[ 1 ], Math.min( ...lot.map( c => c[ 1 ] ) ) ],
				max: [ Math.max( ...lot.map( c => c[ 0 ] ) ), at.position[ 1 ] + floors * 4.5, Math.max( ...lot.map( c => c[ 1 ] ) ) ]
			},
			signText: null, family, floors, tint: parcel
		}
	};

}

/** Serves a world of one building: every parcel stands from the same plan. */
function serving( one = building() ) {

	return async ( url ) => url.endsWith( `${one.plan.id}.json` ) ? one.plan : { ...one.record, parcel: url.slice( 1, url.indexOf( '.' ) ) };

}

/** The lot rectangle placed by a position and a quarter-turn rotation, first edge along the rotated X axis. */
function worldRing( { position, rotationY }, width, depth ) {

	const c = Math.cos( rotationY ), s = Math.sin( rotationY );
	return [ [ 0, 0 ], [ width, 0 ], [ width, depth ], [ 0, depth ] ].map( ( [ u, v ] ) => [
		Math.round( ( position[ 0 ] + u * c + v * s ) * 1e6 ) / 1e6,
		Math.round( ( position[ 2 ] - u * s + v * c ) * 1e6 ) / 1e6
	] );

}

function source( parcelId, hasInterior, blueprint = null ) {

	return [ parcelId, { parcelId, source: 'kit', placementsUrl: `/${parcelId}.placements.json`, hasInterior, blueprint } ];

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

/** Every material the kit's pieces and their leaves wear between them. */
function materialsOf( pieces ) {

	const buckets = new Set();

	for ( const piece of pieces.pieces.values() ) {

		for ( const { bucket } of piece.surfaces ) buckets.add( bucket );
		for ( const leaf of piece.leaves ) for ( const { bucket } of leaf.surfaces ) buckets.add( bucket );

	}

	return buckets;

}

describe( 'the city draws every kit building from shared pieces', () => {

	it( 'loads each piece once, keeps one batch per material, and appends and drops exactly a cell\'s copies', async () => {

		const { kit, pieces, reads } = await openKit();
		await pieces.ready;

		const files = kit.families.flatMap( ( family ) => family.pieces.map( ( piece ) => piece.file ) );
		expect( reads ).toHaveLength( files.length );
		expect( new Set( reads ).size ).toBe( files.length );

		// Six families, nine pieces each: 198 shared surfaces plus the six
		// entrance leaf pairs a closed building draws with its piece, wearing
		// fifteen materials between them. One batch each, for the whole city.
		const materials = materialsOf( pieces );
		expect( materials.size ).toBe( 15 );
		expect( pieces.batchCount ).toBe( materials.size );
		expect( [ ...pieces.batches.batches.keys() ].sort() ).toEqual( [ ...materials ].sort() );

		// Facades cast and receive; per copy culling answers for the batch.
		const meshes = [ ...pieces.batches.batches.values() ].map( ( batch ) => batch.mesh );
		expect( meshes.every( ( mesh ) => mesh.isBatchedMesh && mesh.castShadow && mesh.receiveShadow ) ).toBe( true );
		expect( meshes.every( ( mesh ) => mesh.perObjectFrustumCulled && ! mesh.frustumCulled ) ).toBe( true );

		const loader = new KitCellLoader( { pieces, factory, readJson: serving() } );
		const hidden = await loader.load( new Map( [ source( 'p1', false ) ] ) );

		// Nothing of a cell reaches the shared draws while the skyline still
		// carries its impostors.
		expect( live( pieces ) ).toBe( 0 );

		hidden.group.visible = true;
		const one = live( pieces );
		expect( one ).toBe( building().plan.placements.length + 1 );

		const other = await shown( loader, [ source( 'p2', false ) ] );
		expect( live( pieces ) ).toBe( one * 2 );
		expect( pieces.batchCount ).toBe( materials.size );

		other.disposeModelInstances();
		expect( live( pieces ) ).toBe( one );

		hidden.disposeModelInstances();
		expect( live( pieces ) ).toBe( 0 );

	} );

	it( 'appends a copy as one instance per surface, with its geometry, matrix and tint, and grows past its first capacity', async () => {

		const { pieces } = await openKit();
		await pieces.ready;

		const pieceId = [ ...pieces.pieces.keys() ].find( ( id ) => pieces.leaves( id ).length );
		const piece = pieces.pieces.get( pieceId );
		const colour = new THREE.Color( 0.25, 0.5, 0.75 );
		const matrix = new THREE.Matrix4().makeRotationY( Math.PI / 2 ).setPosition( 12, 4.5, - 7 );
		const handle = pieces.admit( pieceId, matrix, colour );

		// One instance per surface, each in the batch its material owns, each
		// pointing at the geometry that surface was registered as.
		expect( handle.parts.map( ( part ) => part.batch.name ) )
			.toEqual( piece.surfaces.map( ( surface ) => `kit-pieces:${surface.bucket}` ) );
		expect( handle.leaf.parts ).toHaveLength( piece.leaves.flatMap( ( leaf ) => leaf.surfaces ).length );

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
		for ( let i = 0; i < first * 2; i ++ ) held.push( pieces.admit( pieceId, matrix, colour ) );

		expect( batch.capacity ).toBeGreaterThan( first );
		expect( batch.count ).toBe( held.length + 1 );
		expect( batch.mesh.getMatrixAt( handle.instances[ 0 ], new THREE.Matrix4() ).elements )
			.toEqual( matrix.elements.map( ( value ) => expect.closeTo( value, 4 ) ) );

		for ( const one of held ) pieces.release( one );
		pieces.release( handle );
		expect( live( pieces ) ).toBe( 0 );

	} );

	it( 'gives every building a cuboid compound, no triangles, and a hole wherever the interior reserves one', async () => {

		const { pieces } = await openKit();
		const loader = new KitCellLoader( { pieces, factory, readJson: serving() } );
		const closed = await loader.load( new Map( [ source( 'p1', false ) ] ) );

		// Three plain walls, the entrance wall as two jambs and a lintel, the
		// roof cap, and the leaf nothing is going to move.
		expect( closed.boxColliders ).toHaveLength( 8 );
		expect( closed.shellColliders.size ).toBe( 0 );
		expect( closed.boxColliders.every( ( box ) => box.center.length === 3
			&& box.halfExtents.length === 3 && box.halfExtents.every( ( half ) => half > 0 )
			&& Number.isFinite( box.rotationY ) ) ).toBe( true );

		const roof = closed.boxColliders.at( - 2 );
		expect( roof.halfExtents[ 0 ] ).toBeCloseTo( 12 );
		expect( roof.halfExtents[ 2 ] ).toBeCloseTo( 16 );

		// A parcel that swings its own door keeps one cuboid fewer.
		const open = await loader.load( new Map( [ source( 'p2', true ) ] ) );
		expect( open.boxColliders ).toHaveLength( 7 );

		const flat = building( { frame: { position: [ 0, 0, 0 ], rotationY: 0 } } );
		const flatLoader = new KitCellLoader( { pieces, factory, readJson: serving( flat ) } );
		const plain = await flatLoader.load( new Map( [ source( 'p1', false ) ] ) );
		const cut = await flatLoader.load( new Map( [ source( 'p2', false, reserving() ) ] ) );
		// Inside the roof cap, whose top is where the plan's last band ends.
		const top = flat.plan.bands.at( - 1 ).base + flat.plan.bands.at( - 1 ).height - 0.2;

		expect( cut.boxColliders.length ).toBeGreaterThan( plain.boxColliders.length );

		// The side doorway and the stair head are holes; the wall and the roof
		// beside each of them still stand.
		expect( solidAt( cut.boxColliders, 23.75, 1.2, 11 ) ).toBe( false );
		expect( solidAt( cut.boxColliders, 23.75, 1.2, 20 ) ).toBe( true );
		expect( solidAt( cut.boxColliders, 12, top, 16 ) ).toBe( false );
		expect( solidAt( cut.boxColliders, 4, top, 4 ) ).toBe( true );

		// Without the blueprint the same building is sealed everywhere but its
		// entrance.
		expect( solidAt( plain.boxColliders, 23.75, 1.2, 11 ) ).toBe( true );
		expect( solidAt( plain.boxColliders, 12, top, 16 ) ).toBe( true );

	} );

	it( 'publishes the entrance from the placement table and swings its leaves', async () => {

		const { pieces } = await openKit();
		const loader = new KitCellLoader( { pieces, factory, readJson: serving() } );
		const cell = await shown( loader, [ source( 'p1', true ) ] );

		expect( cell.entrances ).toEqual( cell.doors );
		expect( cell.doors ).toHaveLength( 1 );

		const door = cell.doors[ 0 ];
		expect( door.parcelId ).toBe( 'p1' );
		expect( door.pivots ).toHaveLength( 2 );
		expect( door.pivots.map( ( leaf ) => leaf.sign ).sort() ).toEqual( [ - 1, 1 ] );
		// The lot stands at [100,0,50] turned a quarter, so its entrance face
		// runs -Z from the corner and looks out along -X, away from the lot.
		expect( door.center.toArray().map( ( value ) => Math.round( value ) || 0 ) ).toEqual( [ 100, 0, 34 ] );
		expect( door.normal.toArray().map( ( value ) => Math.round( value ) || 0 ) ).toEqual( [ - 1, 0, 0 ] );
		expect( door.outside.x ).toBeLessThan( 100 );
		expect( door.inside.x ).toBeGreaterThan( 100 );
		expect( door.hinge.distanceTo( door.center ) ).toBeCloseTo( door.width / 2 );

		door.wanted = 1;
		interactorFor( cell.doors ).update( 0.5, null );
		expect( door.pivots.every( ( leaf ) => leaf.pivot.rotation.y !== leaf.closedRotation.y ) ).toBe( true );

		cell.disposeModelInstances();
		releaseShell( cell );

	} );

	it( 'refuses a placement naming a piece the kit does not publish', async () => {

		const { pieces } = await openKit();
		const stray = building();
		stray.plan.pieces.push( 'garden-taper/middle/bay' );
		stray.plan.placements[ 2 ] = { ...stray.plan.placements[ 2 ], piece: stray.plan.pieces.length - 1 };
		const loader = new KitCellLoader( { pieces, factory, readJson: serving( stray ) } );

		await expect( loader.load( new Map( [ source( 'p1', false ) ] ) ) )
			.rejects.toThrow( /E_KIT_PLACEMENT: p1 places garden-taper\/middle\/bay/ );
		expect( live( pieces ) ).toBe( 0 );

	} );

	it( 'refuses a piece file whose bytes differ from the kit manifest', async () => {

		const { pieces } = await openKit( { mutate: ( kit ) => {

			kit.families[ 0 ].pieces[ 0 ].bytes += 1;

			return kit;

		} } );

		await expect( pieces.ready ).rejects.toThrow( /E_KIT_PIECES: .*ground-corner\.glb/ );

	} );

} );

/** A blueprint reserving a side door and a stair head through the roof. */
function reserving() {

	return {
		floors: [ {
			index: 0, elevation: 0, outline: [ [ 0, 0 ], [ 24, 0 ], [ 24, 32 ], [ 0, 32 ] ],
			openings: [
				{ id: 'entry', kind: 'door', edge: 0, offset: 14.4, width: 3.2, height: 3.2, sill: 0 },
				{ id: 'side', kind: 'door', edge: 1, offset: 10, width: 2, height: 2.4, sill: 0 },
				{ id: 'glass', kind: 'window', edge: 3, offset: 4, width: 6, height: 2, sill: 1 }
			]
		} ],
		roof: {
			elevation: 23.23,
			bulkhead: { center: [ 12, 16 ], axis: [ 1, 0 ], width: 4, depth: 3, housingHeight: 2.6,
				doorNormal: [ 0, 1 ], doorWidth: 1, doorHeight: 2.1 }
		}
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
