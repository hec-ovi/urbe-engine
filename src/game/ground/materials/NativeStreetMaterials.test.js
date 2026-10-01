import { describe, expect, it, vi } from 'vitest';
import { BufferGeometry, ClampToEdgeWrapping, Float32BufferAttribute, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three/webgpu';
import binding from '../../../../../materials/bindings/street-native.json' with { type: 'json' };
import { NativeStreetMaterials, PAINT_RESPONSE } from './NativeStreetMaterials.js';

function loader() {
	return vi.fn( ( id, path, definition ) => ( {
		texture: Object.assign( new Texture(), {
			name: path, flipY: true,
			colorSpace: definition.colorSpace === 'srgb' ? SRGBColorSpace : NoColorSpace,
			wrapS: definition.wrap[ 0 ] === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping,
			wrapT: definition.wrap[ 1 ] === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping
		} ), ready: Promise.resolve()
	} ) );
}

describe( 'NativeStreetMaterials public surface', () => {
	it( 'builds every published effect with shared source resources and safe public paths', async () => {
		const load = loader(), factory = new NativeStreetMaterials( binding, load );
		const materials = Object.keys( binding.surfaces ).map( id => factory.build( id ) );
		for ( const material of materials ) {
			expect( material.isNodeMaterial ).toBe( true );
			expect( material.colorNode?.isNode ).toBe( true );
			expect( factory.build( material.userData.streetNativeSurface ) ).toBe( material );
			expect( material[ Symbol.for( 'urbe.material-resources' ) ] ).toBe( factory.resources( material ) );
			await Promise.all( factory.resources( material ).map( resource => resource.ready ) );
		}
		expect( load.mock.calls.every( ( [ , path ] ) => path.startsWith( 'cyberpunk/assets/' ) ) ).toBe( true );
		expect( new Set( load.mock.calls.map( ( [ id ] ) => id ) ).size ).toBe( load.mock.calls.length );
		expect( factory.build( 'yellowPaint' ) ).toMatchObject( { transparent: true, depthWrite: false, opacity: 1 } );
		expect( factory.build( 'polished' ).isMeshPhysicalNodeMaterial ).toBe( true );
		expect( factory.build( 'oil-patch' ) ).toMatchObject( { polygonOffset: true, polygonOffsetFactor: -1 } );
		expect( factory.build( 'asphalt', { roadRoughness: 0.6 } ) ).not.toBe( factory.build( 'asphalt' ) );
		factory.dispose();
		expect( () => factory.build( 'ordinary' ) ).toThrow( expect.objectContaining( { code: 'E_STREET_MATERIAL' } ) );
	} );

	it( 'requires the authored wear and road-height fields when their effects consume them', () => {
		const factory = new NativeStreetMaterials( binding, loader() );
		const geometry = new BufferGeometry();
		for ( const [ name, size ] of Object.entries( { position: 3, normal: 3, uv: 2, _street_wear: 1, _street_height: 1 } ) ) geometry.setAttribute( name, new Float32BufferAttribute( new Float32Array( 3 * size ), size ) );
		factory.assertGeometry( factory.build( 'asphalt' ), geometry );
		factory.assertGeometry( factory.build( 'concrete' ), geometry );
		geometry.deleteAttribute( '_street_wear' );
		expect( () => factory.assertGeometry( factory.build( 'asphalt' ), geometry ) ).toThrow( /_street_wear/ );
		geometry.deleteAttribute( '_street_height' );
		expect( () => factory.assertGeometry( factory.build( 'concrete' ), geometry ) ).toThrow( /_street_height/ );
		factory.dispose();
	} );

	it( 'rejects corrupt catalogs, map resources and overrides before producing a usable material', () => {
		const load = loader();
		expect( () => new NativeStreetMaterials( { ...binding, version: 999 }, load ) ).toThrow( /Invalid native street catalog/ );
		const broken = structuredClone( binding );
		broken.surfaces.asphalt.maps.basecolor = 'absent';
		expect( () => new NativeStreetMaterials( broken, load ) ).toThrow( /Unknown street texture/ );
		expect( load ).not.toHaveBeenCalled();
		const factory = new NativeStreetMaterials( binding, load );
		expect( () => factory.build( 'absent' ) ).toThrow( /Unknown street surface/ );
		expect( () => factory.build( 'asphalt', { roadRoughness: NaN } ) ).toThrow( /roughness override/ );
		expect( () => new NativeStreetMaterials( binding, () => null ).build( 'ordinary' ) ).toThrow( /texture resource/ );
		expect( () => new NativeStreetMaterials( binding, () => ( { texture: new Texture(), ready: Promise.resolve() } ) ).build( 'ordinary' ) ).toThrow( /sampling disagrees/ );
		factory.dispose();
	} );

	it( 'samples a surface in world metres when a scaled part asks for it, as a material of its own', () => {
		const factory = new NativeStreetMaterials( binding, loader() );
		expect( factory.build( 'concrete', { worldUv: true } ) ).not.toBe( factory.build( 'concrete' ) );
		expect( factory.build( 'concrete', { worldUv: true } ) ).toBe( factory.build( 'concrete', { worldUv: true } ) );
		expect( () => factory.build( 'concrete', { worldUv: 'yes' } ) ).toThrow( /world sampling/ );
		factory.dispose();
	} );

	it( 'lets a photographed surface show its placement wear, and requires the wear field for it', () => {
		const factory = new NativeStreetMaterials( binding, loader() );
		const geometry = new BufferGeometry();
		for ( const [ name, size ] of Object.entries( { position: 3, normal: 3, uv: 2, _street_wear: 1 } ) ) geometry.setAttribute( name, new Float32BufferAttribute( new Float32Array( 3 * size ), size ) );
		factory.assertGeometry( factory.build( 'district-panel-dark' ), geometry );
		geometry.deleteAttribute( '_street_wear' );
		expect( () => factory.assertGeometry( factory.build( 'district-panel-dark' ), geometry ) ).toThrow( /_street_wear/ );
		factory.dispose();
	} );

	it( 'gives road paint the roughness and colour of the worn paint finish the binding publishes for its marking', () => {
		const load = loader(), factory = new NativeStreetMaterials( binding, load );
		const names = material => factory.resources( material ).map( resource => resource.texture.name );
		for ( const [ paint, finish ] of Object.entries( PAINT_RESPONSE ) ) {
			const maps = binding.surfaces[ finish ].maps;
			expect( names( factory.build( paint ) ) ).toEqual( expect.arrayContaining( [ maps.basecolor, maps.roughness ].map( id => binding.textures[ id ].path.slice( 'themes/'.length ) ) ) );
		}
		// Without the finish the marking keeps its tint and its one roughness.
		const bare = structuredClone( binding );
		delete bare.surfaces[ 'crosswalk-worn' ];
		const plain = new NativeStreetMaterials( bare, loader() );
		expect( plain.resources( plain.build( 'whitePaint' ) ).map( resource => resource.texture.name ).some( name => name.includes( 'street-paint' ) ) ).toBe( false );
		factory.dispose();
		plain.dispose();
	} );
} );
