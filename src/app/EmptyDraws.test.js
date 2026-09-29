import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SphereCulledBatch } from '../game/city/kit/SphereCulledBatch.js';
import { skipEmptyDraws } from './EmptyDraws.js';

/** The two renderer calls the skip uses, recording what reached the backend. */
function renderer() {

	const drawn = [];
	return {
		drawn,
		renderObject( object, scene, camera, geometry, material ) {

			object.onBeforeRender( this, scene, camera, geometry, material, null );
			drawn.push( object.name );

		},
		setRenderObjectFunction( fn ) { this.fn = fn; }
	};

}

function batch( name, z ) {

	const material = new THREE.MeshStandardMaterial();
	const mesh = new SphereCulledBatch( 2, 100, 200, material );
	mesh.name = name;
	mesh.sortObjects = false;
	mesh.setMatrixAt( mesh.addInstance( mesh.addGeometry( new THREE.BoxGeometry() ) ), new THREE.Matrix4().makeTranslation( 0, 0, z ) );
	return mesh;

}

describe( 'objects with nothing to draw', () => {

	it( 'never reach the backend, and a batch culled for the pass is culled once', () => {

		const target = renderer();
		const fn = skipEmptyDraws( target );
		expect( target.fn ).toBe( fn );
		const camera = new THREE.PerspectiveCamera( 70, 1, 0.2, 900 );
		camera.updateMatrixWorld();
		const scene = new THREE.Scene();
		const box = new THREE.BoxGeometry();
		const material = new THREE.MeshStandardMaterial();

		const empty = Object.assign( new THREE.InstancedMesh( box, material, 4 ), { name: 'no copies' } );
		empty.count = 0;
		const copies = Object.assign( new THREE.InstancedMesh( box, material, 4 ), { name: 'copies' } );
		const plain = Object.assign( new THREE.Mesh( box, material ), { name: 'plain' } );
		const ahead = batch( 'ahead', - 20 );
		const behind = batch( 'behind', 20 );
		const sorted = batch( 'sorted', 20 );
		sorted.sortObjects = true;

		// Every cull tests the one copy's sphere radius once.
		let culls = 0;
		const spheres = ahead.spheres;
		ahead.spheres = new Proxy( spheres, { get: ( store, key ) => {

			if ( key === '3' ) culls ++;
			const value = Reflect.get( store, key );
			return typeof value === 'function' ? value.bind( store ) : value;

		} } );

		for ( const object of [ empty, copies, plain, ahead, behind, sorted ] ) fn( object, scene, camera, object.geometry, object.material, null, null, null, null );

		// A sorting batch takes three's own path, which culls in the draw.
		expect( target.drawn ).toEqual( [ 'copies', 'plain', 'ahead', 'sorted' ] );
		expect( ahead._multiDrawCount ).toBe( 1 );
		expect( culls ).toBe( 1 );
		expect( behind._multiDrawCount ).toBe( 0 );

	} );

} );
