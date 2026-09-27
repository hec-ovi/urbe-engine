import * as THREE from 'three/webgpu';
import { BodyMesh } from '../src/game/agents/BodyMesh.js';
import { FRAMES } from '../src/game/agents/VatBaker.js';
import { uniform, renderGroup } from 'three/tsl';
import { vehiclePresence, coveredMaterial } from '../src/game/agents/Presence.js';
import { NightFog } from '../src/game/look/NightFog.js';
import { LookPipeline } from '../src/game/look/LookPipeline.js';
import { Rain } from '../src/game/look/Rain.js';

/** Tiny real-backend check, served only by a throwaway Engine. */
async function run() {
	const webgl = new URLSearchParams( location.search ).get( 'backend' ) === 'webgl';
	const renderer = new THREE.WebGPURenderer( { forceWebGL: webgl, antialias: false } );
	await renderer.init();
	renderer.setSize( 320, 240 );
	renderer.shadowMap.enabled = true;
	renderer.info.autoReset = false;
	renderer.toneMapping = THREE.AgXToneMapping;
	document.body.append( renderer.domElement );
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera( 55, 4 / 3, 0.1, 40 );
	camera.position.set( 0, 2.5, 6 );
	camera.lookAt( 0, 1, 0 );
	const light = new THREE.DirectionalLight( 0xffffff, 4 );
	light.position.set( 2, 4, 3 );
	light.castShadow = true;
	light.shadow.mapSize.set( 64, 64 );
	scene.add( light, new THREE.HemisphereLight( 0xaaccee, 0x223344, 1 ) );
	new NightFog( scene, { density: 0.0003, color: 0x10202c } );
	const geometry = new THREE.PlaneGeometry( 1, 2 );
	const vertices = geometry.getAttribute( 'position' );
	const position = new Float32Array( vertices.count * FRAMES * 4 );
	const normal = new Float32Array( position.length );
	for ( let frame = 0; frame < FRAMES; frame ++ ) for ( let i = 0; i < vertices.count; i ++ ) {
		const offset = ( frame * vertices.count + i ) * 4;
		position.set( [ vertices.getX( i ), vertices.getY( i ) + 1, 0, 1 ], offset );
		normal.set( [ 0, 0, 1, 0 ], offset );
	}
	const map = new THREE.DataTexture( new Uint8Array( [ 255, 255, 255, 255 ] ), 1, 1 );
	map.needsUpdate = true;
	const body = new BodyMesh( { mesh: new THREE.Mesh( geometry ), position, normal, vertexCount: vertices.count, rows: FRAMES }, 1, ! webgl,
		{ map, cloth: new THREE.Float32BufferAttribute( new Float32Array( vertices.count * 4 ), 4 ) } );
	const tint = new THREE.Color( 0.6, 0.7, 0.8 );
	const look = { skin: tint, shirt: tint, trousers: tint, sleeve: 0.8, hem: 0.8 };
	const vehicle = new THREE.InstancedMesh( new THREE.BoxGeometry( 1, 0.6, 2 ), new THREE.MeshStandardMaterial( { color: 0x879faa } ), 1 );
	vehicle.setMatrixAt( 0, new THREE.Matrix4().makeTranslation( 1.3, 0.5, 0 ) );
	vehicle.castShadow = true;
	const coverage = vehiclePresence( [ vehicle ], 1 );
	const rigCoverage = uniform( 0 ).setGroup( renderGroup );
	const rig = new THREE.Mesh( new THREE.BoxGeometry( 0.4, 0.4, 0.4 ), coveredMaterial( new THREE.MeshStandardMaterial( { color: 0xffffff } ), rigCoverage ) );
	rig.position.set( 0, 1, 0 );
	rig.castShadow = true;
	const floor = new THREE.Mesh( new THREE.BoxGeometry( 5, 0.1, 5 ), new THREE.MeshStandardMaterial( { color: 0x707070 } ) );
	floor.receiveShadow = true;
	const rain = new Rain( 12 );
	rain.update( camera, false );
	scene.add( body.mesh, vehicle, rig, floor, rain.mesh );
	const pipeline = new LookPipeline( renderer, scene, camera, { bloom: { strength: 0.1, radius: 0.03 } } );
	const draw = presence => {
		renderer.info.reset();
		rigCoverage.value = presence;
		body.setInstance( 0, new THREE.Vector3( -0.8, 0, 0 ), 0, 0, 0, look, presence );
		body.commit( 1 );
		coverage.setX( 0, presence );
		coverage.needsUpdate = true;
		pipeline.render();
	};
	const frames = [];
	for ( const presence of [ 0, 0.5, 1 ] ) {
		draw( presence );
		await new Promise( resolve => requestAnimationFrame( resolve ) );
		frames.push( { presence, calls: renderer.info.render.drawCalls } );
	}
	rain.mesh.visible = false;
	draw( 0 );
	const absent = await renderer.readRenderTargetPixelsAsync( pipeline.renderTarget, 0, 0, 320, 240 );
	body.mesh.visible = vehicle.visible = rig.visible = false;
	draw( 0 );
	const hidden = await renderer.readRenderTargetPixelsAsync( pipeline.renderTarget, 0, 0, 320, 240 );
	const shadowClears = absent.every( ( value, index ) => value === hidden[ index ] );
	rig.visible = true;
	draw( 1 );
	const rigVisible = await renderer.readRenderTargetPixelsAsync( pipeline.renderTarget, 0, 0, 320, 240 );
	const uniformUpdates = rigVisible.some( ( value, index ) => value !== hidden[ index ] );
	body.mesh.visible = vehicle.visible = true;
	rig.visible = false;
	draw( 1 );
	const instances = await renderer.readRenderTargetPixelsAsync( pipeline.renderTarget, 0, 0, 320, 240 );
	const instancesShow = instances.some( ( value, index ) => value !== hidden[ index ] );
	draw( 0.5 );
	const partial = await renderer.readRenderTargetPixelsAsync( pipeline.renderTarget, 0, 0, 320, 240 );
	const partialCoverage = partial.some( ( value, index ) => value !== hidden[ index ] ) && partial.some( ( value, index ) => value !== instances[ index ] );
	rig.visible = true;
	window.presenceProbe = { shadowClears, uniformUpdates, instancesShow, partialCoverage, backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl', frames, draw };
}

run().catch( error => { window.presenceProbe = { error: error.stack }; console.error( error ); } );
