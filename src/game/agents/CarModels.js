import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = '/models/cars';
const FILES = [
	'NormalCar1.glb', 'NormalCar2.glb', 'SUV.glb', 'Taxi.glb',
	'SportsCar.glb', 'SportsCar2.glb', 'PoliceCar.glb'
];

const LIGHT_MATERIALS = [ 'Headlights', 'TailLights' ];

/**
 * The CC0 Quaternius car pack as two instanced draws per model: the painted
 * body, and the head and tail lights on their own unlit material so they glow
 * through the fog. Each model's per-part material colours are baked into
 * vertex colours, which is what collapses a seven-material car into one mesh.
 */
export class CarModels {

	static async load( capacity ) {

		const loader = new GLTFLoader();
		const gltfs = await Promise.all( FILES.map( ( file ) => loader.loadAsync( `${BASE}/${file}` ) ) );

		return new CarModels( gltfs.map( ( gltf, i ) => build( gltf, FILES[ i ], capacity ) ) );

	}

	constructor( models ) {

		this.models = models;
		this.group = new THREE.Group();
		this.group.name = 'cars';

		for ( const model of models ) {

			this.group.add( model.body );
			if ( model.lights ) this.group.add( model.lights );

		}

	}

	get count() {

		return this.models.length;

	}

	setInstance( model, slot, matrix ) {

		this.models[ model ].body.setMatrixAt( slot, matrix );
		this.models[ model ].lights?.setMatrixAt( slot, matrix );

	}

	commit( counts ) {

		for ( let i = 0; i < this.models.length; i ++ ) {

			const model = this.models[ i ];
			model.body.count = counts[ i ];
			model.body.instanceMatrix.needsUpdate = true;

			if ( model.lights ) {

				model.lights.count = counts[ i ];
				model.lights.instanceMatrix.needsUpdate = true;

			}

		}

	}

}

function build( gltf, name, capacity ) {

	gltf.scene.updateMatrixWorld( true );

	const painted = [];
	const lit = [];

	gltf.scene.traverse( ( node ) => {

		if ( ! node.isMesh ) return;

		const material = node.material;
		const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
		geometry.applyMatrix4( node.matrixWorld );
		geometry.deleteAttribute( 'uv' );
		geometry.deleteAttribute( 'uv1' );
		paint( geometry, material.color ?? new THREE.Color( 0x888888 ) );

		( LIGHT_MATERIALS.includes( material.name ) ? lit : painted ).push( geometry );

	} );

	const bodyGeometry = BufferGeometryUtils.mergeGeometries( painted, false );
	bodyGeometry.computeBoundingBox();

	// Drop the model onto the road: the pack's origin sits at the axles.
	const lift = - bodyGeometry.boundingBox.min.y;
	bodyGeometry.translate( 0, lift, 0 );

	const body = new THREE.InstancedMesh(
		bodyGeometry,
		new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.38, metalness: 0.45 } ),
		capacity
	);
	body.name = `car:${name}`;
	body.frustumCulled = false;
	body.count = 0;
	body.castShadow = true;
	body.instanceMatrix.setUsage( THREE.DynamicDrawUsage );

	let lights = null;

	if ( lit.length ) {

		const geometry = BufferGeometryUtils.mergeGeometries( lit, false );
		geometry.translate( 0, lift, 0 );
		lights = new THREE.InstancedMesh(
			geometry,
			new THREE.MeshBasicMaterial( { vertexColors: true, toneMapped: false } ),
			capacity
		);
		lights.frustumCulled = false;
		lights.count = 0;
		lights.instanceMatrix.setUsage( THREE.DynamicDrawUsage );

	}

	bodyGeometry.computeBoundingBox();

	return { body, lights, length: bodyGeometry.boundingBox.max.z - bodyGeometry.boundingBox.min.z };

}

/** Bakes a material colour into the geometry so many materials become one. */
function paint( geometry, color ) {

	const count = geometry.getAttribute( 'position' ).count;
	const colors = new Float32Array( count * 3 );

	for ( let i = 0; i < count; i ++ ) {

		colors[ i * 3 ] = color.r;
		colors[ i * 3 + 1 ] = color.g;
		colors[ i * 3 + 2 ] = color.b;

	}

	geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );

}
