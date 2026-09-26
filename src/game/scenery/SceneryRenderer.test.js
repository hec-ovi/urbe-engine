import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics } from '../physics/Physics.js';
import { SceneryCompiler } from './SceneryCompiler.js';
import { SceneryRenderer } from './SceneryRenderer.js';
import { assets, courier, crimeScene, frame } from './scenery.test-fixtures.js';

const { assembly } = new SceneryCompiler( { missionAssets: assets } ).compile( crimeScene(), frame, courier );
const factory = { build: ( key, variantId ) => new THREE.MeshStandardMaterial( { name: `${key}#${variantId}` } ) };

describe( 'scenery renderer', () => {

	it( 'stands the posed person on the floor along the footprint, the props and decals, and takes them all down again', async () => {

		const physics = await Physics.create();
		const poser = stillPoser();
		const lighting = { attachRoot: vi.fn(), releaseRoot: vi.fn() };
		const warmup = { warm: vi.fn( async () => 0 ) };
		const renderer = new SceneryRenderer( { poser, materialFactory: factory, physics, lighting, warmup } );
		expect( await renderer.realize( assembly ) ).toBe( true );
		expect( poser.still ).toHaveBeenCalledExactlyOnceWith( assembly.actors[ 0 ], 'Death01', 1 );
		expect( warmup.warm ).toHaveBeenCalledOnce();
		expect( renderer.isRealized( 'courier-found' ) ).toBe( true );

		const scene = renderer.group.getObjectByName( 'scenery:courier-found' );
		const body = scene.getObjectByName( 'scenery-entity:courier' );
		const entity = assembly.entities.find( ( item ) => item.entityId === 'courier' );
		expect( body.position.toArray() ).toEqual( [ entity.transform.position.x, entity.transform.position.y, entity.transform.position.z ] );
		// The still lay along x; its footprint is long along z, so it is turned a quarter onto it, lowest point on the floor.
		const [ root ] = body.children;
		expect( root.rotation.y ).toBeCloseTo( Math.PI / 2, 6 );
		const bounds = new THREE.Box3().setFromObject( body, true );
		expect( bounds.min.y ).toBeCloseTo( entity.transform.position.y, 6 );
		const size = bounds.getSize( new THREE.Vector3() );
		const along = Math.abs( Math.cos( entity.transform.yawRadians ) ) > 0.5 ? size.z : size.x;
		expect( along ).toBeCloseTo( 1.7, 5 );
		expect( lighting.attachRoot ).toHaveBeenCalledWith( root, expect.any( THREE.Vector3 ) );

		const pool = scene.getObjectByName( 'scenery-decal:pool' );
		expect( new THREE.Vector3( 0, 0, 1 ).applyQuaternion( pool.quaternion ).y ).toBeCloseTo( 1, 6 );
		expect( pool.material.name ).toBe( 'cyberpunk/incident-blood/mid#directional-pool' );
		expect( scene.getObjectByName( 'scenery-entity:drive' ).children.map( ( mesh ) => mesh.material.name ) )
			.toEqual( [ 'cyberpunk/metal/mid#paint', 'cyberpunk/plastic/poor#bag', 'cyberpunk/metal/mid#paint' ] );

		// Only the body blocks: the drive is portable.
		const colliders = physics.world.colliders.len();
		renderer.unrealize( 'courier-found' );
		expect( physics.world.colliders.len() ).toBe( colliders - 1 );
		expect( renderer.group.children ).toHaveLength( 0 );
		expect( poser.release ).toHaveBeenCalledExactlyOnceWith( root );
		expect( lighting.releaseRoot ).toHaveBeenCalledExactlyOnceWith( root );

	} );

	it( 'lets an overlay find, sight and take an element, which stays taken when the scene stands again', async () => {

		const physics = await Physics.create();
		const renderer = new SceneryRenderer( { poser: stillPoser(), materialFactory: factory, physics } );
		await renderer.realize( assembly );
		physics.step( 1 / 60 );
		const visuals = renderer.visuals( 'courier-found' );
		const focus = visuals.focus( 'courier' ).position;
		const eye = focus.clone().add( new THREE.Vector3( 0, 1.2, 1.5 ) );
		expect( visuals.unobstructed( eye, focus, 'courier' ) ).toBe( true );
		const wall = new THREE.BoxGeometry( 2, 2, 0.2 ).translate( focus.x, focus.y + 0.6, focus.z + 0.75 );
		physics.addTrimesh( wall );
		physics.step( 1 / 60 );
		expect( visuals.unobstructed( eye, focus, 'courier' ) ).toBe( false );

		visuals.collect( 'drive' );
		expect( visuals.focus( 'drive' ) ).toBeNull();
		renderer.unrealize( 'courier-found' );
		expect( visuals.focus( 'courier' ) ).toBeNull();
		await renderer.realize( assembly );
		expect( visuals.focus( 'courier' ) ).not.toBeNull();
		expect( visuals.focus( 'drive' ) ).toBeNull();

	} );

	it( 'fails closed on a material or a pose it cannot find, and leaves nothing behind', async () => {

		const poser = stillPoser();
		const unresolved = new SceneryRenderer( { poser, materialFactory: { build: ( key ) => ( { name: `unresolved:${key}` } ) } } );
		await expect( unresolved.realize( assembly ) ).rejects.toMatchObject( { code: 'E_SCENERY_MATERIAL' } );
		expect( unresolved.group.children ).toHaveLength( 0 );
		expect( unresolved.isPending( 'courier-found' ) ).toBe( false );
		expect( poser.release ).toHaveBeenCalledOnce();

		const missing = new SceneryRenderer( {
			poser: { still: async () => { throw new Error( 'Pro animation library is missing Death01' ); }, release: vi.fn() },
			materialFactory: factory
		} );
		await expect( missing.realize( assembly ) ).rejects.toMatchObject( { code: 'E_SCENERY_ASSET', message: expect.stringMatching( /missing Death01/ ) } );

	} );

	it( 'drops a scene taken down while it was still being built', async () => {

		let release;
		const renderer = new SceneryRenderer( {
			poser: stillPoser(), materialFactory: factory,
			warmup: { warm: () => new Promise( ( resolve ) => { release = resolve; } ) }
		} );
		const realizing = renderer.realize( assembly );
		await vi.waitFor( () => expect( release ).toBeTypeOf( 'function' ) );
		expect( renderer.isPending( 'courier-found' ) ).toBe( true );
		renderer.unrealize( 'courier-found' );
		release( 0 );
		expect( await realizing ).toBe( false );
		expect( renderer.group.children ).toHaveLength( 0 );
		expect( renderer.isRealized( 'courier-found' ) ).toBe( false );

	} );

} );

/** A still that lies 1.7 m along x and 0.3 m high, standing a little above its origin. */
function stillPoser() {

	return {
		still: vi.fn( async () => {

			const root = new THREE.Group();
			const mesh = new THREE.Mesh( new THREE.BoxGeometry( 1.7, 0.3, 0.5 ), new THREE.MeshStandardMaterial() );
			mesh.position.set( 0.2, 0.4, 0.1 );
			root.add( mesh );
			root.updateMatrixWorld( true );
			return root;

		} ),
		release: vi.fn()
	};

}
