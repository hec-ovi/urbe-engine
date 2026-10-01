import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { BuildingShots, frameWhole } from './BuildingShots.js';

/** Stands in for Snapshots: keeps each stage, and resolves with what it staged. */
function fakeSnapshots() {

	const stages = [];
	return {
		stages,
		take: vi.fn( ( stage ) => {

			stages.push( stage );
			return Promise.resolve().then( stage ).then( ( staged ) => {

				if ( ! staged ) return null;
				const picture = `blob:${staged.scene.children.length}`;
				staged.done?.();
				return picture;

			} );

		} )
	};

}

describe( 'BuildingShots', () => {

	const box = ( width, height, depth, y ) => new THREE.BoxGeometry( width, height, depth ).translate( 0, y, 0 );
	const plan = {
		surfaces: [
			{ geometry: box( 10, 20, 8, 10 ), material: new THREE.MeshStandardMaterial( { color: 0x808080 } ) },
			{ geometry: box( 4, 2, 0.2, 1 ), material: new THREE.MeshPhysicalMaterial( { transmission: 1 } ) }
		],
		leaves: [ { surfaces: [ { geometry: box( 1, 2, 0.1, 1 ), material: new THREE.MeshStandardMaterial() } ] } ]
	};

	it( 'pictures a kit parcel\'s own plan once whichever copy asks, on a plinth, and nothing for a shell or a plan not standing', async () => {

		const snapshots = fakeSnapshots();
		const records = { p1: { plan: 'tower' }, p2: { plan: 'tower' }, p3: { plan: 'far-plan' } };
		const buildings = new Map( [
			[ 'p1', { source: 'kit', placementsUrl: 'p1' } ], [ 'p2', { source: 'kit', placementsUrl: 'p2' } ],
			[ 'p3', { source: 'kit', placementsUrl: 'p3' } ], [ 'p4', { source: 'shell', shellUrl: 'p4.glb' } ]
		] );
		const pieces = { plans: new Map( [ [ 'tower', plan ] ] ), has: ( id ) => id === 'tower' };
		const shots = new BuildingShots( { snapshots, pieces, buildings, readJson: async ( url ) => records[ url ] } );
		const kept = vi.spyOn( plan.surfaces[ 0 ].geometry, 'dispose' );
		const disposed = vi.spyOn( THREE.BufferGeometry.prototype, 'dispose' );

		// The model: three surfaces and the plinth, with the scene's three lights.
		expect( await shots.building( 'p1' ) ).toBe( 'blob:4' );
		// The picture lets go of its own geometry, which carries the plan's attributes; the plan's stays.
		expect( disposed ).toHaveBeenCalledTimes( 3 );
		expect( disposed.mock.contexts[ 0 ].attributes.position ).toBe( plan.surfaces[ 0 ].geometry.attributes.position );
		expect( kept ).not.toHaveBeenCalled();
		disposed.mockRestore();
		expect( await shots.building( 'p2' ) ).toBe( 'blob:4' );
		expect( snapshots.take ).toHaveBeenCalledOnce();
		expect( shots.scene.children ).toHaveLength( 3 );
		expect( await shots.building( 'p3' ) ).toBeNull();
		expect( await shots.building( 'p4' ) ).toBeNull();
		expect( await shots.building( 'nowhere' ) ).toBeNull();

		// Glass is pictured dark and plain; walls keep their colour.
		const glass = shots.materials.get( plan.surfaces[ 1 ].material );
		expect( glass.color.getHex() ).toBe( 0x24363d );
		expect( shots.materials.get( plan.surfaces[ 0 ].material ).color.getHex() ).toBe( 0x808080 );

	} );

	it( 'frames the whole building from the front right and above', () => {

		const camera = new THREE.PerspectiveCamera( 30, 1, 0.5, 4000 );
		const bounds = new THREE.Box3( new THREE.Vector3( - 5, 0, - 4 ), new THREE.Vector3( 5, 20, 4 ) );
		const distance = frameWhole( camera, bounds );
		const radius = bounds.getBoundingSphere( new THREE.Sphere() ).radius;
		expect( distance ).toBeGreaterThan( radius / Math.sin( THREE.MathUtils.degToRad( 15 ) ) );
		expect( camera.position.x ).toBeGreaterThan( 0 );
		expect( camera.position.y ).toBeGreaterThan( 10 );
		expect( camera.position.z ).toBeGreaterThan( 0 );

	} );

} );
