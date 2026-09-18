import Ajv from 'ajv/dist/2020.js';
import { ClampToEdgeWrapping, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import schema from '../../../../../materials/schema/street-native.schema.json' with { type: 'json' };
import { NativeSamples } from './NativeSamples.js';
import { EFFECTS } from './NativeEffects.js';
import { assertAttributes, requiredAttributes } from './NativeGeometry.js';
import { fail } from './NativeMaterialError.js';

const validate = new Ajv( { strict: true } ).compile( schema );
const WRAPS = { repeat: RepeatWrapping, clamp: ClampToEdgeWrapping };
const OPTIONS = [ 'roadRoughness', 'instances', 'scanCells' ];
export const MATERIAL_RESOURCES = Symbol.for( 'urbe.material-resources' );

/** Material-only consumer; the supplied texture port owns image loading and lifetime. */
export class NativeStreetMaterials {
	constructor( binding, loadTexture ) {
		if ( ! validate( binding ) ) fail( `Invalid native street catalog: ${validate.errors[ 0 ].instancePath}` );
		if ( typeof loadTexture !== 'function' ) fail( 'Native street texture port is required' );
		for ( const surface of Object.values( binding.surfaces ) ) {
			if ( ! EFFECTS[ surface.effect ] ) fail( `Unknown native street effect: ${surface.effect}` );
			for ( const id of Object.values( surface.maps ) ) if ( ! Object.hasOwn( binding.textures, id ) ) fail( `Unknown street texture: ${id}` );
		}
		for ( const definition of Object.values( binding.textures ) ) {
			if ( ! definition.path.startsWith( 'themes/' ) || definition.path.split( '/' ).some( part => ! part || part === '.' || part === '..' ) ) fail( 'Invalid public street texture path' );
		}
		this.binding = structuredClone( binding );
		this.loadTexture = loadTexture;
		this.textureCache = new Map();
		this.cache = new Map();
		this.instanceKeys = new WeakMap();
		this.instanceCount = 0;
		this.records = new WeakMap();
		this.disposed = false;
	}

	build( surfaceId, options = {} ) {
		this.#active();
		if ( typeof surfaceId !== 'string' || ! Object.hasOwn( this.binding.surfaces, surfaceId ) ) fail( `Unknown street surface: ${surfaceId}` );
		const surface = this.binding.surfaces[ surfaceId ];
		if ( ! options || typeof options !== 'object' || Array.isArray( options ) || Object.keys( options ).some( key => ! OPTIONS.includes( key ) ) ) fail( 'Invalid street material options' );
		if ( options.roadRoughness !== undefined && ( surface.effect !== 'asphalt' || ! Number.isFinite( options.roadRoughness ) || options.roadRoughness < 0 || options.roadRoughness > 1 ) ) fail( 'Invalid road roughness override' );
		if ( options.instances !== undefined && ( ! options.instances?.tint || ! options.instances.wear ) ) fail( 'Invalid street instance values' );
		if ( options.scanCells !== undefined && ( ! Array.isArray( options.scanCells ) || ! options.instances?.scan
			|| options.scanCells.some( id => ! this.binding.surfaces[ id ]?.maps?.basecolor ) ) ) fail( 'Invalid street scan atlas' );
		const key = `${surfaceId}:${options.roadRoughness ?? ''}:${this.#instanceKey( options.instances )}`;
		if ( this.cache.has( key ) ) return this.cache.get( key );
		const resources = new Map();
		const samples = new NativeSamples( surface, this.binding.sampling.asphalt, id => {
			const resource = this.#texture( id );
			resources.set( id, resource );
			return resource.texture;
		}, { instances: options.instances, scanCells: options.scanCells?.map( id => this.binding.surfaces[ id ] ) } );
		const nodes = EFFECTS[ surface.effect ]( samples, surface.parameters, options );
		const Material = surface.parameters.clearcoat ? MeshPhysicalNodeMaterial : MeshStandardNodeMaterial;
		const material = new Material( { name: `street-native:${surfaceId}`, metalness: 0 } );
		Object.assign( material, nodes );
		// Every copy of a surface draws in one batch, so what one placement
		// asks for itself rides on its own row: its tint multiplies whatever
		// the effect paints, and its wear, scan and text reach the effect.
		if ( options.instances ) material.colorNode = vec3( nodes.colorNode ).mul( options.instances.tint );
		if ( surface.parameters.clearcoat ) material.clearcoat = surface.parameters.clearcoat;
		// A street surface is transparent exactly where its effect paints an opacity.
		if ( nodes.opacityNode ) {
			material.transparent = true;
			material.depthWrite = false;
		}
		if ( surface.parameters.polygonOffset !== undefined ) {
			material.polygonOffset = true;
			material.polygonOffsetFactor = surface.parameters.polygonOffset;
			material.polygonOffsetUnits = 0;
		}
		material.userData.streetNativeSurface = surfaceId;
		const resourceList = Object.freeze( [ ...resources.values() ] );
		material[ MATERIAL_RESOURCES ] = resourceList;
		this.records.set( material, { resources: resourceList, attributes: requiredAttributes( surface.effect ) } );
		this.cache.set( key, material );
		return material;
	}

	resources( material ) { return this.#record( material ).resources; }
	assertGeometry( material, geometry ) { assertAttributes( geometry, this.#record( material ).attributes ); }

	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		for ( const material of this.cache.values() ) material.dispose();
		this.cache.clear();
		this.textureCache.clear();
		this.records = new WeakMap();
	}

	#texture( id ) {
		if ( this.textureCache.has( id ) ) return this.textureCache.get( id );
		const definition = this.binding.textures[ id ];
		if ( ! definition ) fail( `Unknown street texture: ${id}` );
		const resource = this.loadTexture( id, definition.path.slice( 'themes/'.length ), structuredClone( definition ) );
		const texture = resource?.texture;
		if ( ! texture?.isTexture || typeof resource.ready?.then !== 'function' ) fail( `Invalid street texture resource: ${id}` );
		const colorSpace = definition.colorSpace === 'srgb' ? SRGBColorSpace : NoColorSpace;
		if ( texture.colorSpace !== colorSpace || texture.wrapS !== WRAPS[ definition.wrap[ 0 ] ] || texture.wrapT !== WRAPS[ definition.wrap[ 1 ] ] || texture.flipY !== true ) fail( `Street texture sampling disagrees with catalog: ${id}` );
		this.textureCache.set( id, resource );
		return resource;
	}

	/** A material is the batch's, so two tables of copies never share one. */
	#instanceKey( instances ) {
		if ( ! instances ) return '';
		if ( ! this.instanceKeys.has( instances ) ) this.instanceKeys.set( instances, `copies-${ ++ this.instanceCount }` );
		return this.instanceKeys.get( instances );
	}

	#record( material ) {
		this.#active();
		const record = this.records.get( material );
		if ( ! record ) fail( 'Material is not owned by this street factory' );
		return record;
	}
	#active() { if ( this.disposed ) fail( 'Street material factory is disposed' ); }
}
