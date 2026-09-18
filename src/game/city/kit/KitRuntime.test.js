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
 * One parcel's placement table in the shape Kit assembly writes: Exterior's
 * own plan in the parcel's frame. Assembly keeps the blueprint in its own file,
 * so the plan here carries none either.
 */
function table( { parcel = 'p1', family = 'mirror-frame', width = 24, depth = 32, floors = 5, transform } = {} ) {

	// The same request Kit assembly sends: the lot as a world ring whose first
	// edge is face 0, so every position in the plan comes back in world metres.
	const frame = transform ?? { position: [ 100, 0, 50 ], rotationY: Math.PI / 2 };
	const lot = worldRing( frame, width, depth );
	const { blueprint, ...plan } = planAssembly( {
		family, buildingId: parcel, seed: 'kit', theme: 'cyberpunk',
		parcel: { footprint: lot, accessPoint: [ ( lot[ 0 ][ 0 ] + lot[ 1 ][ 0 ] ) / 2, ( lot[ 0 ][ 1 ] + lot[ 1 ][ 1 ] ) / 2 ], maxHeight: 200 },
		building: { type: 'offices', tier: 'mid', floors }
	} );

	return {
		parcel,
		family,
		baysAcross: width / 8,
		baysDeep: depth / 8,
		floors,
		signText: null,
		lot,
		bounds: { min: [ Math.min( ...lot.map( c => c[ 0 ] ) ), frame.position[ 1 ], Math.min( ...lot.map( c => c[ 1 ] ) ) ], max: [ Math.max( ...lot.map( c => c[ 0 ] ) ), frame.position[ 1 ] + floors * 4.5, Math.max( ...lot.map( c => c[ 1 ] ) ) ] },
		plan
	};

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

function live( pieces ) {

	return [ ...pieces.pieces.values() ].reduce( ( total, piece ) => total + piece.draw.count + ( piece.leafDraw?.count ?? 0 ), 0 );

}

describe( 'the city draws every kit building from shared pieces', () => {

	it( 'loads each piece file once and keeps one draw per piece surface however many buildings stand', async () => {

		const { kit, pieces, reads } = await openKit();
		await pieces.ready;

		const files = kit.families.flatMap( ( family ) => family.pieces.map( ( piece ) => piece.file ) );
		expect( reads ).toHaveLength( files.length );
		expect( new Set( reads ).size ).toBe( files.length );

		// Six families, nine pieces each: 198 shared surfaces plus the six
		// entrance leaf pairs that a closed building draws with its piece.
		const draws = pieces.drawCount;
		expect( draws ).toBe( 204 );

		const loader = new KitCellLoader( { pieces, factory, readJson: async () => table() } );
		const first = await shown( loader, [ source( 'p1', false ) ] );
		const second = await shown( loader, [ source( 'p2', false ), source( 'p3', false ) ] );

		expect( pieces.drawCount ).toBe( draws );
		expect( live( pieces ) ).toBeGreaterThan( 0 );

		first.disposeModelInstances();
		second.disposeModelInstances();
		expect( live( pieces ) ).toBe( 0 );

	} );

	it( 'appends a cell\'s instances on admission and takes exactly those back out on a drop', async () => {

		const { pieces } = await openKit();
		const loader = new KitCellLoader( { pieces, factory, readJson: async () => table() } );

		const hidden = await loader.load( new Map( [ source( 'p1', false ) ] ) );
		// Nothing of a cell reaches the shared draws while the skyline still
		// carries its impostors.
		expect( live( pieces ) ).toBe( 0 );

		hidden.group.visible = true;
		const resident = hidden;
		const one = live( pieces );
		const copies = table().plan.placements.length;
		expect( one ).toBe( copies + 1 );

		const other = await shown( loader, [ source( 'p2', false ) ] );
		expect( live( pieces ) ).toBe( one * 2 );

		other.disposeModelInstances();
		expect( live( pieces ) ).toBe( one );

		resident.disposeModelInstances();
		expect( live( pieces ) ).toBe( 0 );

	} );

	it( 'gives every building a cuboid compound and no triangles at all', async () => {

		const { pieces } = await openKit();
		const loader = new KitCellLoader( { pieces, factory, readJson: async () => table() } );
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

		const open = await loader.load( new Map( [ source( 'p2', true ) ] ) );
		expect( open.boxColliders ).toHaveLength( 7 );

	} );

	it( 'keeps one instance buffer per piece and uploads only the slots a cell touched', async () => {

		const { pieces } = await openKit();
		await pieces.ready;
		const loader = new KitCellLoader( { pieces, factory, readJson: async () => table() } );
		const first = await shown( loader, [ source( 'p1', false ) ] );
		const draw = [ ...pieces.pieces.values() ].map( ( piece ) => piece.draw )
			.find( ( one ) => one.count > 0 && one.meshes.length > 1 );

		expect( new Set( draw.meshes.map( ( mesh ) => mesh.instanceMatrix ) ).size ).toBe( 1 );
		expect( new Set( draw.meshes.map( ( mesh ) => mesh.instanceColor ) ).size ).toBe( 1 );

		const standing = draw.count;
		draw.matrices.clearUpdateRanges();
		const second = await shown( loader, [ source( 'p2', false ) ] );
		const uploaded = draw.matrices.updateRanges.reduce( ( total, range ) => total + range.count, 0 );

		// The second cell's copies, not the first cell's and not the capacity.
		expect( draw.count ).toBe( standing * 2 );
		expect( uploaded ).toBeGreaterThan( 0 );
		expect( uploaded ).toBeLessThanOrEqual( standing * 16 );
		expect( uploaded ).toBeLessThan( draw.matrices.array.length );
		expect( draw.meshes.every( ( mesh ) => mesh.count === draw.count ) ).toBe( true );

		first.disposeModelInstances();
		second.disposeModelInstances();

	} );

	it( 'cuts the walls and the roof cap wherever the interior reserves an opening', async () => {

		const { pieces } = await openKit();
		const flat = table( { transform: { position: [ 0, 0, 0 ], rotationY: 0 } } );
		const loader = new KitCellLoader( { pieces, factory, readJson: async () => flat } );

		const plain = await loader.load( new Map( [ source( 'p1', false ) ] ) );
		const cut = await loader.load( new Map( [ source( 'p2', false, reserving() ) ] ) );

		expect( cut.boxColliders.length ).toBeGreaterThan( plain.boxColliders.length );

		// The side doorway and the stair head are holes; the wall and the roof
		// beside each of them still stand.
		expect( solidAt( cut.boxColliders, 23.75, 1.2, 11 ) ).toBe( false );
		expect( solidAt( cut.boxColliders, 23.75, 1.2, 20 ) ).toBe( true );
		expect( solidAt( cut.boxColliders, 12, 23, 16 ) ).toBe( false );
		expect( solidAt( cut.boxColliders, 4, 23, 4 ) ).toBe( true );

		// Without the blueprint the same building is sealed everywhere but its
		// entrance.
		expect( solidAt( plain.boxColliders, 23.75, 1.2, 11 ) ).toBe( true );
		expect( solidAt( plain.boxColliders, 12, 23, 16 ) ).toBe( true );

	} );

	it( 'publishes the entrance from the placement table and swings its leaves', async () => {

		const { pieces } = await openKit();
		const loader = new KitCellLoader( { pieces, factory, readJson: async () => table() } );
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
		const stray = table();
		stray.plan.placements[ 2 ] = { ...stray.plan.placements[ 2 ], piece: 'garden-taper/middle/bay' };
		const loader = new KitCellLoader( { pieces, factory, readJson: async () => stray } );

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
