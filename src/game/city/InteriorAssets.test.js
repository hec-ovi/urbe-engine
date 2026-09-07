import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { cutInterior } from './InteriorSurfaces.js';
import { buffersOf, outlinesOf } from './InteriorRooms.js';
import { InteriorStream } from './InteriorStream.js';
import { RoomLights } from '../light/RoomLights.js';
import { Warmup } from '../look/Warmup.js';

const floor = { floor: 0, elevation: 0, height: 3, glbUrl: '/floor.glb',
	rooms: [ { id: 'room', kind: 'living', polygon: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] } ], lights: [] };

function fixture() {

	const image = new Uint8Array( [ 32, 96, 192, 255, 240, 80, 16, 128 ] );
	const map = new THREE.DataTexture( image, 2, 1 );
	map.colorSpace = THREE.SRGBColorSpace;
	map.channel = 1;
	map.flipY = false;
	map.wrapS = THREE.MirroredRepeatWrapping;
	map.repeat.set( 2, 3 );
	map.offset.set( 0.1, 0.2 );
	map.rotation = 0.4;
	map.anisotropy = 4;
	map.matrixAutoUpdate = false;
	map.updateMatrix();
	const detail = map.clone();
	detail.colorSpace = THREE.NoColorSpace;
	const material = new THREE.MeshPhysicalMaterial( {
		name: 'upholstery', map, normalMap: detail, roughnessMap: detail, metalnessMap: detail, aoMap: detail,
		color: new THREE.Color( 0.213, 0.431, 0.617 ), emissive: new THREE.Color( 1.25, 0.3, 0.7 ), emissiveIntensity: 2.4,
		roughness: 0.32, metalness: 0.27, transmission: 0.35, ior: 1.62, thickness: 0.13,
		clearcoat: 0.8, clearcoatRoughness: 0.12, normalScale: new THREE.Vector2( - 0.4, 0.7 ),
		transparent: true, opacity: 0.73, alphaTest: 0.21, side: THREE.DoubleSide, vertexColors: true
	} );
	const unlit = new THREE.MeshBasicMaterial( { name: material.name, color: 0x25aa44, map } );
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1 ], 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1 ], 2 ) );
	geometry.setAttribute( 'uv1', new THREE.Float32BufferAttribute( [ 0.2, 0.3, 0.8, 0.3, 0.2, 0.9, 0.8, 0.3, 0.8, 0.9, 0.2, 0.9 ], 2 ) );
	geometry.setAttribute( 'color', new THREE.Uint8BufferAttribute( new Array( 6 ).fill( [ 128, 64, 255 ] ).flat(), 3, true ) );
	geometry.setAttribute( 'tangent', new THREE.Float32BufferAttribute( new Array( 6 ).fill( [ 1, 0, 0, 1 ] ).flat(), 4 ) );
	geometry.computeVertexNormals();
	geometry.addGroup( 0, 3, 0 ); geometry.addGroup( 3, 3, 1 );
	const imported = new THREE.Mesh( geometry, [ material, unlit ] );
	imported.name = 'original-mesh-name';
	const asset = new THREE.Group();
	// GLTFLoader sanitizes scene names and keeps the glTF name in userData.name.
	asset.name = 'assetdownloaded-chair'; asset.userData.name = 'asset:downloaded-chair';
	asset.position.set( 2, 0.6, 2 ); asset.rotation.y = 0.2; asset.scale.set( - 0.5, 1, 0.5 );
	asset.add( imported );
	const shared = new THREE.Mesh( geometry, material );
	shared.name = 'assetshared-table'; shared.userData.name = 'asset:shared-table'; shared.position.set( 5, 0.6, 2 );
	const catalog = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial( { name: 'cyberpunk/carpet/mid' } ) );
	catalog.name = 'interior-floor'; catalog.position.set( 1, 0.01, 1 );
	const ignored = new THREE.Mesh( geometry, material ); ignored.name = 'exterior-wall';
	const scene = new THREE.Scene(); scene.add( asset, shared, catalog, ignored );
	return { scene, material, imported, image, map, detail };

}

function harness( cut, warmup = null ) {

	const factory = { build: vi.fn( () => new THREE.MeshStandardMaterial() ), tint: vi.fn( async () => null ) };
	const roomLights = new RoomLights( factory, { roomSlots: 2, roomSpots: 1, roomStrips: 0 } );
	const stream = new InteriorStream( { factory, roomLights, haze: null, warmup } );
	stream.worker = { cut: async () => ( { cut, bytes: 0, cost: {} } ), dispose() {} };
	stream.onColliderBand = vi.fn(); stream.onDropBand = vi.fn();
	stream.register( new Map( [ [ 'p0', { floors: [ floor ] } ] ] ), new Map( [ [ 'p0', { x: 2, z: 2 } ] ] ) );
	return stream;

}

async function settle( stream ) {

	stream.update( { x: 2, y: 0.1, z: 2 } );
	while ( stream.loading ) await new Promise( resolve => setTimeout( resolve, 0 ) );
	stream.update( { x: 2, y: 0.1, z: 2 } );

}

describe( 'imported furniture across the worker and streamed floor', () => {

	it( 'transfers source maps and attributes, prepares every light binding, collides and releases the floor', async () => {

		const original = fixture();
		const cut = cutInterior( original.scene, outlinesOf( [ floor ] ) );
		expect( cut.materials.materials ).toHaveLength( 2 );
		expect( cut.materials.textures ).toHaveLength( 2 );
		expect( cut.materials.images ).toHaveLength( 1 );
		const transfers = buffersOf( cut );
		expect( transfers ).toHaveLength( 2 );
		const sent = structuredClone( cut, { transfer: transfers } );
		expect( cut.data.byteLength ).toBe( 0 );
		expect( original.image.byteLength ).toBe( 0 );
		const closeImage = vi.fn(); sent.materials.images[ 0 ].data.close = closeImage;
		const warmed = [], renderables = [];
		const renderer = { compileAsync: async content => {

			let count = 0;
			const band = stream.group.getObjectByName( 'interior:p0:0' );
			content.traverse( mesh => {

				if ( mesh.material ) count ++;
				if ( mesh.material?.map ) warmed.push( { material: mesh.material, detached: band.children.length === 0 && ! band.visible } );

			} );
			renderables.push( count );

		} };
		const stream = harness( sent, new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() ) );
		await settle( stream );
		expect( Math.max( ...renderables ) ).toBe( 1 );
		expect( stream.rooms ).toHaveLength( 1 );
		const room = stream.rooms[ 0 ];
		const physical = room.meshes.find( entry => entry.source?.isMeshPhysicalMaterial );
		const basic = room.meshes.find( entry => entry.source?.isMeshBasicMaterial );
		expect( basic.mesh.material.isMeshBasicNodeMaterial ).toBe( true );
		expect( physical.mesh.material ).not.toBe( basic.mesh.material );
		expect( physical.source.name ).toBe( 'upholstery' );
		const rendered = physical.mesh.material;
		expect( rendered.isMeshPhysicalNodeMaterial ).toBe( true );
		expect( rendered.color.toArray() ).toEqual( original.material.color.toArray() );
		expect( rendered.emissive.toArray() ).toEqual( original.material.emissive.toArray() );
		for ( const property of [ 'emissiveIntensity', 'roughness', 'metalness', 'transmission', 'ior', 'thickness', 'clearcoat', 'clearcoatRoughness', 'transparent', 'opacity', 'alphaTest', 'side', 'vertexColors' ] ) {

			expect( rendered[ property ], property ).toBe( original.material[ property ] );

		}
		expect( rendered.normalScale.toArray() ).toEqual( [ - 0.4, 0.7 ] );
		expect( rendered.map.image.data ).toEqual( new Uint8Array( [ 32, 96, 192, 255, 240, 80, 16, 128 ] ) );
		expect( rendered.map.image ).toBe( rendered.normalMap.image );
		expect( rendered.map.colorSpace ).toBe( THREE.SRGBColorSpace );
		expect( rendered.normalMap.colorSpace ).toBe( THREE.NoColorSpace );
		for ( const property of [ 'channel', 'flipY', 'wrapS', 'anisotropy', 'matrixAutoUpdate' ] ) expect( rendered.map[ property ] ).toBe( original.map[ property ] );
		expect( rendered.map.matrix.elements ).toEqual( original.map.matrix.elements );
		expect( rendered.roughnessMap ).toBe( rendered.metalnessMap );
		expect( rendered.aoMap ).toBe( rendered.normalMap );
		const geometry = physical.mesh.geometry;
		expect( [ ...geometry.attributes.uv1.array ] ).toEqual( [ ...original.imported.geometry.attributes.uv1.array.slice( 0, 2 ), ...original.imported.geometry.attributes.uv1.array.slice( 4, 6 ), ...original.imported.geometry.attributes.uv1.array.slice( 2, 4 ) ] );
		expect( geometry.attributes.color.getX( 0 ) ).toBeCloseTo( 128 / 255 );
		expect( geometry.attributes.tangent.getW( 0 ) ).toBe( - 1 );
		const expected = new THREE.Vector3().fromBufferAttribute( original.imported.geometry.attributes.position, 2 ).applyMatrix4( original.imported.matrixWorld );
		expect( new THREE.Vector3().fromBufferAttribute( geometry.attributes.position, 1 ).distanceTo( expected ) ).toBeLessThan( 1e-6 );
		const corners = [ 0, 1, 2 ].map( i => new THREE.Vector3().fromBufferAttribute( geometry.attributes.position, i ) );
		expect( new THREE.Triangle( ...corners ).getNormal( new THREE.Vector3() ).dot( new THREE.Vector3().fromBufferAttribute( geometry.attributes.normal, 0 ) ) ).toBeCloseTo( 1 );
		expect( warmed.every( entry => entry.detached ) ).toBe( true );
		const clones = new Set( warmed.map( entry => entry.material ).filter( material => material.isMeshPhysicalNodeMaterial ) );
		expect( clones.size ).toBe( 3 );
		for ( const binding of [ stream.roomLights.dim, ...stream.roomLights.slots ] ) expect( [ ...clones ].some( material => material.lightsNode === binding.lightsNode ) ).toBe( true );
		expect( stream.factory.build.mock.calls ).toEqual( [ [ 'cyberpunk/carpet/mid', undefined ], [ 'cyberpunk/carpet/mid', undefined ], [ 'cyberpunk/carpet/mid', undefined ] ] );
		expect( stream.factory.tint.mock.calls ).toEqual( [ [ 'cyberpunk/carpet/mid' ] ] );
		const collider = stream.onColliderBand.mock.calls[ 0 ][ 1 ];
		expect( collider.reduce( ( count, positions ) => count + positions.length / 3, 0 ) ).toBe( 18 );
		const colliding = collider.flatMap( positions => Array.from( positions ) );
		for ( let i = 0; i < geometry.attributes.position.array.length; i += 9 ) expect( colliding.join( ',' ) ).toContain( Array.from( geometry.attributes.position.array.slice( i, i + 9 ) ).join( ',' ) );
		stream.roomLights.update( [ room ], new THREE.Vector3( 2, 0, 2 ), 1 );
		const owned = [ ...new Set( warmed.map( entry => entry.material ) ), physical.source, basic.source, rendered.map, rendered.normalMap, geometry ];
		const disposal = owned.map( resource => vi.spyOn( resource, 'dispose' ) );
		stream.update( { x: 200, y: 0, z: 200 } );
		stream.dispose();
		for ( const spy of disposal ) expect( spy ).toHaveBeenCalledTimes( 1 );
		expect( closeImage ).toHaveBeenCalledTimes( 1 );
		expect( stream.onDropBand ).toHaveBeenCalledWith( 'p0:0' );
		for ( const binding of [ stream.roomLights.dim, ...stream.roomLights.slots ] ) {

			expect( binding.room ).toBeNull();
			expect( [ ...binding.materials.keys() ] ).toEqual( [ 'cyberpunk/carpet/mid' ] );

		}

	} );

	it.each( [ 'fails', 'is cancelled' ] )( 'releases imported resources when preparation %s before the floor becomes visible', async mode => {

		const cut = cutInterior( fixture().scene, outlinesOf( [ floor ] ) );
		const closeImage = vi.fn(); cut.materials.images[ 0 ].data.close = closeImage;
		const owned = new Set();
		const disposed = [];
		const renderer = { compileAsync: async content => {

			content.traverse( node => { if ( node.geometry ) owned.add( node.geometry ); if ( node.material?.map ) { owned.add( node.material ); owned.add( node.material.map ); } } );
			for ( const resource of owned ) disposed.push( vi.spyOn( resource, 'dispose' ) );
			if ( mode === 'fails' ) throw new Error( 'shader preparation failed' );
			stream.dispose();
			return 0;

		} };
		const stream = harness( cut, new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() ) );
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		try {

			await settle( stream );
			if ( mode === 'fails' ) expect( warn ).toHaveBeenCalledWith( 'floor p0:0: shader preparation failed' );
			else expect( warn ).not.toHaveBeenCalled();
			expect( stream.rooms ).toHaveLength( 0 );
			expect( stream.onColliderBand ).not.toHaveBeenCalled();
			for ( const spy of disposed ) expect( spy ).toHaveBeenCalledTimes( 1 );
			expect( closeImage ).toHaveBeenCalledTimes( 1 );
			stream.dispose();

		} finally { warn.mockRestore(); }

	} );
	it( 'stops between renderables after cancellation and retains the active preparation resources until it settles', async () => {

		const cut = cutInterior( fixture().scene, outlinesOf( [ floor ] ) );
		const closeImage = vi.fn(); cut.materials.images[ 0 ].data.close = closeImage;
		let finish, started;
		const active = new Promise( resolve => { finish = resolve; } );
		const entered = new Promise( resolve => { started = resolve; } );
		const disposed = [];
		const renderer = { compileAsync: vi.fn( async object => {

			const owned = new Set();
			object.traverse( node => {

				if ( node.geometry ) owned.add( node.geometry );
				if ( node.material ) owned.add( node.material );
				if ( node.material?.map ) owned.add( node.material.map );

			} );
			for ( const resource of owned ) disposed.push( vi.spyOn( resource, 'dispose' ) );
			started();
			await active;

		} ) };
		const stream = harness( cut, new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() ) );
		stream.update( { x: 2, y: 0.1, z: 2 } );
		await entered;
		stream.dispose();
		for ( const dispose of disposed ) expect( dispose ).not.toHaveBeenCalled();
		expect( closeImage ).not.toHaveBeenCalled();
		finish();
		while ( stream.loading ) await new Promise( resolve => setTimeout( resolve, 0 ) );
		expect( renderer.compileAsync ).toHaveBeenCalledTimes( 1 );
		for ( const dispose of disposed ) expect( dispose ).toHaveBeenCalledTimes( 1 );
		expect( closeImage ).toHaveBeenCalledTimes( 1 );
		expect( stream.rooms ).toHaveLength( 0 );
		expect( stream.onColliderBand ).not.toHaveBeenCalled();

	} );

	it( 'closes a decoded packet delivered after the building leaves the stream', async () => {

		const cut = cutInterior( fixture().scene, outlinesOf( [ floor ] ) );
		const closeImage = vi.fn(); cut.materials.images[ 0 ].data.close = closeImage;
		const stream = harness( cut );
		let land;
		stream.worker.cut = () => new Promise( resolve => { land = resolve; } );
		stream.update( { x: 2, y: 0.1, z: 2 } );
		stream.dispose();
		land( { cut, bytes: 0, cost: {} } );
		while ( stream.loading ) await new Promise( resolve => setTimeout( resolve, 0 ) );
		expect( closeImage ).toHaveBeenCalledTimes( 1 );
		expect( stream.rooms ).toHaveLength( 0 );
		expect( stream.onColliderBand ).not.toHaveBeenCalled();
		expect( stream.factory.build ).not.toHaveBeenCalled();

	} );

} );
