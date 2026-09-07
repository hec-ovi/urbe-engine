import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { triangleGeometry } from './Geometry.js';

/** Static glTF meshes baked once into world-oriented, metre-sized material parts. */
export class ImportedModels {
	constructor( loadAsset = url => new GLTFLoader().loadAsync( url ) ) {
		this.loadAsset = loadAsset;
		this.resources = new Set();
	}
	async load( spec ) {
		const url = `/models/street-props/${spec.file}`;
		try {
			const { scene } = await this.loadAsset( url );
			scene.traverse( mesh => {
				if ( ! mesh.isMesh ) return;
				this.resources.add( mesh.geometry );
				for ( const material of Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ] ) {
					this.resources.add( material );
					for ( const value of Object.values( material ) ) if ( value?.isTexture ) this.resources.add( value );
				}
			} );
			scene.updateMatrixWorld( true );
			const bounds = new THREE.Box3().setFromObject( scene, true );
			const size = bounds.getSize( new THREE.Vector3() );
			if ( bounds.isEmpty() || ! [ size.x, size.y, size.z ].every( n => Number.isFinite( n ) && n > 0 ) ) throw new Error( 'No finite three-dimensional geometry' );
			const tree = [ 'pine', 'maple' ].includes( spec.id );
			const center = bounds.getCenter( new THREE.Vector3() );
			const scale = spec.size ? new THREE.Vector3( ...spec.size ).divide( size ) : new THREE.Vector3().setScalar( spec.height / size.y );
			const normalize = new THREE.Matrix4().makeScale( scale.x, scale.y, scale.z ).multiply( new THREE.Matrix4().makeTranslation( tree ? 0 : - center.x, - bounds.min.y, tree ? 0 : - center.z ) );
			const batches = new Map();
			scene.traverse( mesh => {
				if ( ! mesh.isMesh ) return;
				const materials = Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ];
				if ( mesh.isSkinnedMesh || mesh.morphTargetInfluences?.some( value => value !== 0 ) ) throw new Error( 'Street models must have a static exported pose' );
				const expanded = triangleGeometry( mesh.geometry );
				const transform = normalize.clone().multiply( mesh.matrixWorld );
				expanded.applyMatrix4( transform );
				if ( transform.determinant() < 0 ) reverseWinding( expanded );
				const groups = Array.isArray( mesh.material ) ? mesh.geometry.groups : [ { start: 0, count: expanded.attributes.position.count, materialIndex: 0 } ];
				for ( const group of groups ) {
					const sourceMaterial = materials[ group.materialIndex ];
					const signature = Object.entries( expanded.attributes ).map( ( [ key, attr ] ) => `${key}:${attr.itemSize}` ).sort().join( ',' );
					const key = `${sourceMaterial.uuid}:${signature}`;
					if ( ! batches.has( key ) ) batches.set( key, { source: sourceMaterial, pieces: [] } );
					const geometry = new THREE.BufferGeometry();
					for ( const [ name, attr ] of Object.entries( expanded.attributes ) ) {
						const slice = new THREE.Float32BufferAttribute( group.count * attr.itemSize, attr.itemSize );
						for ( let i = 0; i < group.count; i ++ ) for ( let component = 0; component < attr.itemSize; component ++ ) slice.setComponent( i, component, attr.getComponent( group.start + i, component ) );
						geometry.setAttribute( name, slice );
					}
					batches.get( key ).pieces.push( geometry );
				}
				expanded.dispose();
			} );
			if ( ! batches.size ) throw new Error( 'No static triangle meshes' );
			return [ ...batches.values() ].map( ( { source, pieces } ) => {
				const material = source.clone();
				if ( tree && material.transparent ) { material.transparent = false; material.alphaTest = 0.45; material.depthWrite = true; }
				if ( spec.id === 'bags' || tree ) { material.metalness = 0; material.metalnessMap = null; }
				const geometry = mergeGeometries( pieces );
				pieces.forEach( part => part.dispose() );
				this.resources.add( material ); this.resources.add( geometry );
				return { geometry, material, tintable: true };
			} );
		} catch ( cause ) {
			throw Object.assign( new Error( `E_PROP_ASSET: ${url}: ${cause.message}. Install the street model catalog before play.`, { cause } ), { code: 'E_PROP_ASSET' } );
		}
	}
	dispose() {
		for ( const value of this.resources ) { value.dispose(); if ( value.isTexture ) value.source?.data?.close?.(); }
		this.resources.clear();
	}
}

function reverseWinding( geometry ) {
	for ( const attr of Object.values( geometry.attributes ) ) for ( let i = 0; i < attr.count; i += 3 ) for ( let c = 0; c < attr.itemSize; c ++ ) {
		const a = ( i + 1 ) * attr.itemSize + c, b = ( i + 2 ) * attr.itemSize + c;
		[ attr.array[ a ], attr.array[ b ] ] = [ attr.array[ b ], attr.array[ a ] ];
	}
	const tangent = geometry.attributes.tangent;
	if ( tangent ) for ( let i = 0; i < tangent.count; i ++ ) tangent.setW( i, - tangent.getW( i ) );
}
