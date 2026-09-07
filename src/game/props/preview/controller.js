import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MaterialResolver } from '../../../building/MaterialResolver.js';
import { PbrMaterialFactory } from '../../../building/PbrMaterialFactory.js';
import { ReviewScene } from './ReviewScene.js';
import { ReviewView } from './views/ReviewView.js';
import layout from './layout.json' with { type: 'json' };

const view = new ReviewView( layout, ( id, value ) => { if ( id === 'scene' ) void show( value ); else lighting( value ); } );
document.body.append( view.element );
const scene = new THREE.Scene(); scene.background = new THREE.Color( '#a0aaac' );
const camera = new THREE.PerspectiveCamera( 45, innerWidth / innerHeight, 0.05, 600 );
const renderer = new THREE.WebGPURenderer( { antialias: true } );
renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) ); renderer.setSize( innerWidth, innerHeight );
renderer.toneMapping = THREE.AgXToneMapping; renderer.shadowMap.enabled = true;
document.querySelector( '#stage' ).append( renderer.domElement );
const controls = new OrbitControls( camera, renderer.domElement ); controls.enableDamping = true;
const fill = new THREE.HemisphereLight( '#dbe8ee', '#716454', 2 ); scene.add( fill );
const sun = new THREE.DirectionalLight( '#fff2dc', 3 ); sun.position.set( 25, 60, 20 ); sun.castShadow = true;
sun.shadow.mapSize.set( 2048, 2048 ); Object.assign( sun.shadow.camera, { left: - 100, right: 100, top: 100, bottom: - 100, far: 200 } );
sun.shadow.bias = - 0.0001; sun.shadow.normalBias = 0.02; scene.add( sun );
let active, builder;
function lighting( value ) {
	const night = value === 'night'; fill.intensity = night ? 0.4 : 2; sun.intensity = night ? 1.2 : 3;
	fill.color.set( night ? '#8dbece' : '#dbe8ee' ); sun.color.set( night ? '#e9ab6f' : '#fff2dc' ); scene.background.set( night ? '#111c26' : '#a0aaac' );
}
async function show( mode ) {
	view.setBusy( true ); view.setStatus( 'Loading street details…' );
	try {
		const next = await builder.build( mode );
		if ( active ) { scene.remove( active.group ); active.dispose(); }
		active = next; scene.add( next.group );
		const bounds = new THREE.Box3().setFromObject( next.group ), center = bounds.getCenter( new THREE.Vector3() ), size = bounds.getSize( new THREE.Vector3() );
		controls.target.copy( center ); camera.position.copy( center ).add( ! [ 'gallery', 'arrangements' ].includes( mode ) ? new THREE.Vector3( 1.3, Math.max( 1.7, size.z ), Math.max( 3, size.x * 1.25, size.z * 1.5 ) ) : new THREE.Vector3( size.x * 0.65 + 8, Math.max( 12, size.z * 0.6 ), size.z * 0.65 + 8 ) ); controls.update();
		await renderer.compileAsync( scene, camera ); view.setStatus( next.summary );
	} catch ( error ) { view.setStatus( error.message ); console.error( error ); }
	finally { view.setBusy( false ); }
}
try {
	view.setBusy( true ); view.setStatus( 'Loading materials…' ); await renderer.init();
	const resolver = new MaterialResolver(); await resolver.loadTheme( 'cyberpunk' );
	const factory = new PbrMaterialFactory( resolver ); builder = new ReviewScene( factory );
	const groundMaterial = factory.build( 'cyberpunk/prop-coating/poor', 'worn' ).clone(); groundMaterial.color.set( '#666b68' );
	const groundGeometry = new THREE.PlaneGeometry( 400, 400 );
	for ( let i = 0; i < groundGeometry.attributes.uv.count; i ++ ) groundGeometry.attributes.uv.setXY( i, groundGeometry.attributes.uv.getX( i ) * 400, groundGeometry.attributes.uv.getY( i ) * 400 );
	const ground = new THREE.Mesh( groundGeometry, groundMaterial ); ground.rotation.x = - Math.PI / 2; ground.position.y = 0.199; ground.receiveShadow = true; scene.add( ground );
	await show( 'plastic' );
	renderer.setAnimationLoop( () => { controls.update(); renderer.render( scene, camera ); } );
} catch ( error ) { view.setStatus( error.message ); }
addEventListener( 'resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize( innerWidth, innerHeight ); } );
