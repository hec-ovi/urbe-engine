import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildHighwayModel, highwayFrameAt } from '../HighwayModel.js';

const query = new URLSearchParams( location.search );
const renderer = new THREE.WebGLRenderer( { antialias: true, preserveDrawingBuffer: true } );
renderer.setPixelRatio( 1 ); renderer.setSize( innerWidth, innerHeight );
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append( renderer.domElement );
const scene = new THREE.Scene(); scene.background = new THREE.Color( '#8b9ba5' );
const camera = new THREE.PerspectiveCamera( 48, innerWidth / innerHeight, 0.05, 1200 );
const controls = new OrbitControls( camera, renderer.domElement );
controls.addEventListener( 'change', draw );
scene.add( new THREE.HemisphereLight( '#d8e9f3', '#5e635d', 1.6 ) );
const key = new THREE.DirectionalLight( '#fff0d3', 3 );
key.position.set( 25, 45, 15 ); key.castShadow = true; key.shadow.mapSize.set( 1024, 1024 );
key.shadow.camera.left = key.shadow.camera.bottom = - 90; key.shadow.camera.right = key.shadow.camera.top = 90;
key.shadow.camera.near = 0.1; key.shadow.camera.far = 220;
key.shadow.normalBias = 0.018; scene.add( key, key.target );
const values = {
	roadway: [ '#45484a', .84, 0 ], 'deck-concrete': [ '#85867f', .8, 0 ],
	'soffit-concrete': [ '#686a65', .88, 0 ], 'pier-concrete': [ '#818279', .86, 0 ],
	'barrier-concrete': [ '#919187', .78, 0 ], 'bearing-steel': [ '#505452', .52, .72 ], 'joint-rubber': [ '#272a29', .92, 0 ]
};
const materials = new Map( Object.entries( values ).map( ( [ slot, v ] ) => {
	const m = new THREE.MeshStandardMaterial( { color: v[ 0 ], roughness: v[ 1 ], metalness: v[ 2 ] } );
	m.name = slot; m.userData.highwayContentSlot = slot; return [ slot, m ];
} ) );
const fixtureSelect = document.querySelector( '#fixture' ), viewSelect = document.querySelector( '#view' );
let model, group, currentSource;
const fixture = ( kind ) => {
	const s = {
		edgeIds: [ 'isolated-' + kind ], path: [ [ 0, 0 ], [ 90, 0 ] ], width: 14, level: 8, deckThickness: 1,
		elevationProfile: [ { distance: 0, level: 8 }, { distance: 90, level: 8 } ],
		ramps: { start: 0, end: 0 }, barriers: { left: { height: 1.1, width: .3 }, right: { height: 1.1, width: .3 } },
		supports: [ 15, 45, 75 ].map( ( x ) => ( { position: [ x, 0 ], footprint: [ [ x - 1, - 1 ], [ x + 1, - 1 ], [ x + 1, 1 ], [ x - 1, 1 ] ], bottom: 0, top: 7 } ) )
	};
	if ( kind === 'ramp' ) {
		s.path[ 1 ][ 0 ] = 120; s.elevationProfile = [ { distance: 0, level: 0 }, { distance: 60, level: 8 }, { distance: 120, level: 8 } ];
		s.supports = [ 30, 60, 90 ].map( ( x ) => ( { position: [ x, 0 ], footprint: [ [ x - 1, - 1 ], [ x + 1, - 1 ], [ x + 1, 1 ], [ x - 1, 1 ] ], bottom: 0, top: Math.min( 8, ( x - 1 ) * 8 / 60 ) - 1 } ) );
	}
	if ( kind === 'bend' ) {
		s.path = [ [ 0, 0 ], [ 45, 0 ], [ 65, 30 ], [ 100, 30 ] ];
		const length = 80 + Math.hypot( 20, 30 ); s.elevationProfile[ 1 ].distance = length;
		s.supports = [ s.supports[ 0 ], { position: [ 83, 30 ], footprint: [ [ 82, 29 ], [ 84, 29 ], [ 84, 31 ], [ 82, 31 ] ], bottom: 0, top: 7 } ];
	}
	return s;
};
async function load( kind ) {
	currentSource = kind === 'tiny' ? ( await ( await fetch( query.get( 'blueprint' ) ?? '/out/games/tiny-check/blueprint.json' ) ).json() ).streets.highwayStructures[ 0 ] : fixture( kind );
	if ( group ) { scene.remove( group ); model.dispose(); }
	model = buildHighwayModel( currentSource ); group = new THREE.Group();
	for ( const part of model.parts ) { const mesh = new THREE.Mesh( part.geometry, materials.get( part.slot ) ); mesh.name = part.slot; mesh.castShadow = mesh.receiveShadow = true; group.add( mesh ); }
	scene.add( group );
	document.querySelector( '#status' ).textContent = model.statistics.triangles.toLocaleString() + ' triangles · ' + model.statistics.materialParts + ' material parts · ' + model.statistics.bearings + ' bearings';
	setView( viewSelect.value );
	return model.statistics;
}
function setView( name ) {
	const box = model.bounds, center = box.getCenter( new THREE.Vector3() );
	const index = Math.floor( currentSource.supports.length / 2 );
	const support = currentSource.supports[ index ];
	const frame = highwayFrameAt( currentSource, model.detail.supports[ index ]?.station ?? 0 );
	const along = new THREE.Vector3( frame.tangent[ 0 ], 0, frame.tangent[ 1 ] );
	const across = new THREE.Vector3( - frame.tangent[ 1 ], 0, frame.tangent[ 0 ] );
	let target = new THREE.Vector3( support?.position[ 0 ] ?? center.x, 6, support?.position[ 1 ] ?? center.z );
	let delta;
	if ( name === 'under' ) { target.y = 7; delta = new THREE.Vector3( - 18, - 5.4, 10 ); }
	else if ( name === 'side' ) { target.y = 4.5; delta = new THREE.Vector3( - 20, 1, 25 ); }
	else if ( name === 'pier' ) { target.y = ( support?.top ?? 7 ) - .25; delta = new THREE.Vector3( - 3.8, - 1.4, 4.8 ); }
	else if ( name === 'deck' ) { target.y = 8; delta = new THREE.Vector3( - 20, 7, 9 ); }
	else { target.y = 8.55; target.addScaledVector( across, currentSource.width / 2 ); delta = new THREE.Vector3( - 4.5, 1.1, 3.5 ); }
	const offset = along.multiplyScalar( delta.x ).addScaledVector( across, delta.z ); offset.y = delta.y;
	camera.position.copy( target ).add( offset ); controls.target.copy( target ); controls.update();
	key.position.copy( target ).add( new THREE.Vector3( 25, 45, 15 ) ); key.target.position.copy( target );
	draw();
}
function draw() { renderer.render( scene, camera ); }
fixtureSelect.value = query.get( 'fixture' ) ?? 'flat'; viewSelect.value = query.get( 'view' ) ?? 'under';
fixtureSelect.onchange = () => load( fixtureSelect.value ); viewSelect.onchange = () => setView( viewSelect.value );
document.querySelector( '#export' ).onclick = async () => {
	const buffer = await new GLTFExporter().parseAsync( group, { binary: true } );
	const url = URL.createObjectURL( new Blob( [ buffer ], { type: 'model/gltf-binary' } ) );
	const anchor = document.createElement( 'a' ); anchor.href = url; anchor.download = 'highway-content-' + fixtureSelect.value + '.glb'; anchor.click();
	setTimeout( () => URL.revokeObjectURL( url ), 1000 );
};
addEventListener( 'resize', () => { renderer.setSize( innerWidth, innerHeight ); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); draw(); } );
window.highwayReview = {
	load, setView, draw,
	snapshot: () => ( { statistics: model.statistics, detail: model.detail, bounds: model.bounds, camera: camera.position.toArray(), target: controls.target.toArray() } ),
	replaceMaterial: ( slot, material ) => { for ( const mesh of group.children ) if ( mesh.name === slot ) mesh.material = material; draw(); },
	get model() { return model; }, get scene() { return scene; }
};
await load( fixtureSelect.value ); window.highwayReviewReady = true;
