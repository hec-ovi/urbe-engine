import { describe, expect, it, vi } from 'vitest';
import { ClampToEdgeWrapping, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three/webgpu';
import binding from '../../../../materials/bindings/street-native.json' with { type: 'json' };
import { DECAL_GRID, decals, frames, masks } from './DetailMasks.js';
import { pack } from './DetailPack.js';
import { ROLES, SurfaceDetail } from './SurfaceDetail.js';
import { exteriorWear, streetWear, wearExterior, wearStreet } from './Weathering.js';
import { NativeStreetMaterials } from '../ground/materials/NativeStreetMaterials.js';
import { shellMaterial } from '../city/ShellSurface.js';

const RESOURCES = Symbol.for( 'urbe.material-resources' );
const inPlace = () => SurfaceDetail.load( { open: () => null } );

describe( 'procedural surface-detail masks', () => {

	it( 'draws the same tileable field on every run, each channel spread evenly', () => {

		const size = 64, field = masks( size );
		expect( masks( size ) ).toEqual( field );
		for ( let channel = 0; channel < 4; channel ++ ) {

			const values = [];
			for ( let index = channel; index < field.length; index += 4 ) values.push( field[ index ] );
			const mean = values.reduce( ( sum, value ) => sum + value, 0 ) / values.length;
			expect( Math.abs( mean - 127.5 ) ).toBeLessThan( 3 );
			// The last column runs on into the first, as a repeat does.
			let seam = 0, inner = 0;
			for ( let row = 0; row < size; row ++ ) {

				seam += Math.abs( field[ ( row * size + size - 1 ) * 4 + channel ] - field[ row * size * 4 + channel ] );
				inner += Math.abs( field[ ( row * size + size / 2 - 1 ) * 4 + channel ] - field[ ( row * size + size / 2 ) * 4 + channel ] );

			}
			expect( seam ).toBeLessThan( inner * 2 + size * 4 );

		}

	} );

	it( 'draws slab frames that leave the middle of a slab untouched', () => {

		const size = 64, field = frames( size );
		expect( frames( size ) ).toEqual( field );
		const middle = ( size / 2 * size + size / 2 ) * 4;
		expect( [ field[ middle ], field[ middle + 1 ] ] ).toEqual( [ 0, 0 ] );
		let rim = 0;
		for ( let x = 0; x < size; x ++ ) rim += field[ x * 4 ];
		expect( rim / size ).toBeGreaterThan( 40 );

	} );

	it( 'keeps every stain inside its atlas cell', () => {

		const cell = 32, atlas = decals( cell ), side = cell * DECAL_GRID;
		expect( decals( cell ) ).toEqual( atlas );
		let covered = 0;
		for ( let y = 0; y < side; y ++ ) {

			for ( let x = 0; x < side; x ++ ) {

				const alpha = atlas[ ( y * side + x ) * 4 + 3 ];
				const u = x % cell, v = y % cell;
				if ( u === 0 || v === 0 || u === cell - 1 || v === cell - 1 ) expect( alpha ).toBe( 0 );
				if ( alpha > 0 ) covered ++;

			}

		}
		expect( covered ).toBeGreaterThan( side * side * 0.05 );

	} );

} );

describe( 'SurfaceDetail', () => {

	it( 'reads the stand-ins until Materials publishes surface-detail masks', async () => {

		const detail = inPlace();
		await detail.ready;
		expect( new Set( Object.values( detail.source ) ) ).toEqual( new Set( [ 'procedural' ] ) );
		expect( Object.keys( detail.source ).sort() ).toEqual( [ ...ROLES ].sort() );
		expect( detail.resources ).toHaveLength( 3 );
		for ( const { texture } of detail.resources ) {

			expect( texture ).toMatchObject( { flipY: false, colorSpace: NoColorSpace } );
			expect( texture.image.data.some( ( value ) => value > 0 ) ).toBe( true );
			await expect( texture[ Symbol.for( 'urbe.texture-ready' ) ] ).resolves.toBeUndefined();

		}
		expect( detail.roles.decals.texture.wrapS ).toBe( ClampToEdgeWrapping );
		expect( detail.roles.smudge.texture.wrapS ).toBe( RepeatWrapping );
		// Two packed fields and an atlas, however many masks the layer reads.
		expect( new Set( ROLES.map( ( role ) => detail.roles[ role ].texture ) ).size ).toBe( 3 );

	} );

	it( 'takes each mask and the atlas the binding names, and falls back where a mask cannot be read', async () => {

		const binding = {
			textures: {
				smudge: { path: 'themes/cyberpunk/assets/surface-detail/broad-smudge/field/roughness.png' },
				streaks: { path: 'themes/cyberpunk/assets/surface-detail/dirt-streaks/field/roughness.png' }
			},
			masks: {
				smudge: { key: 'cyberpunk/surface-detail/broad-smudge', variant: 'field', texture: 'smudge', worldSize: [ 2, 2 ] },
				dirtStreaks: { key: 'cyberpunk/surface-detail/dirt-streaks', variant: 'field', texture: 'streaks', worldSize: [ 2, 2 ] }
			},
			atlas: { key: 'cyberpunk/surface-detail/decal-atlas', variant: 'engine-grid', columns: 4, rows: 4 }
		};
		const mapTexture = vi.fn( ( key, variantId, map, { srgb } ) => ( {
			texture: Object.assign( new Texture(), { colorSpace: srgb ? SRGBColorSpace : NoColorSpace } ), ready: Promise.resolve()
		} ) );
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const detail = SurfaceDetail.load( { binding, mapTexture, open: () => null } );
		expect( detail.source ).toMatchObject( { smudge: 'cyberpunk/surface-detail/broad-smudge#field', streaks: 'cyberpunk/surface-detail/dirt-streaks#field', macro: 'procedural', decals: 'cyberpunk/surface-detail/decal-atlas#engine-grid' } );
		expect( detail.roles.smudge.size ).toEqual( [ 2, 2 ] );
		expect( mapTexture.mock.calls ).toEqual( [ [ 'cyberpunk/surface-detail/decal-atlas', 'engine-grid', 'basecolor', { srgb: true, wrap: 'clamp' } ] ] );
		await detail.ready;
		// Nothing here decodes an image: the named masks stay procedural and say so.
		expect( detail.source ).toMatchObject( { smudge: 'procedural', streaks: 'procedural', decals: 'cyberpunk/surface-detail/decal-atlas#engine-grid' } );
		expect( warn.mock.calls.map( ( [ line ] ) => line ).join( '\n' ) ).toMatch( /broad-smudge.*no image decoder/ );
		warn.mockRestore();

	} );

	it( 'packs a decoded catalog mask into its channel, spread evenly', async () => {

		const size = 32;
		const decode = vi.fn( async () => {

			const image = new Uint8Array( size * size * 4 );
			for ( let index = 0; index < size * size; index ++ ) image[ index * 4 ] = index % size < size / 4 ? 0 : 40;
			return image;

		} );
		const packed = await pack( { size, cell: 16, masks: [ 'a.png', null, null, null ], frames: [ 'b.png', null, null, null ], decals: false }, decode );
		expect( packed.read ).toEqual( { masks: [ 'catalog', 'procedural', 'procedural', 'procedural' ], frames: [ 'catalog', 'procedural', 'procedural', 'procedural' ] } );
		const smudge = new Set(), scuff = new Set();
		for ( let index = 0; index < size * size; index ++ ) {

			smudge.add( packed.masks[ index * 4 ] );
			scuff.add( packed.frames[ index * 4 ] );

		}
		// A world mask is equalised, ties kept together; a slab frame keeps its values.
		expect( [ ...smudge ].sort( ( a, b ) => a - b ) ).toEqual( [ 32, 159 ] );
		expect( [ ...scuff ].sort( ( a, b ) => a - b ) ).toEqual( [ 0, 40 ] );
		expect( packed.decals ).toBeNull();

	} );

} );

describe( 'weathering', () => {

	function loader() {

		return ( id, path, definition ) => ( {
			texture: Object.assign( new Texture(), {
				name: path, flipY: true,
				colorSpace: definition.colorSpace === 'srgb' ? SRGBColorSpace : NoColorSpace,
				wrapS: definition.wrap[ 0 ] === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping,
				wrapT: definition.wrap[ 1 ] === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping
			} ), ready: Promise.resolve()
		} );

	}

	it( 'wears every road, sidewalk, curb, gutter, joint and paint surface and leaves props alone', () => {

		const detail = inPlace();
		const plain = new NativeStreetMaterials( binding, loader() );
		const worn = new NativeStreetMaterials( binding, loader(), { detail } );
		for ( const id of Object.keys( binding.surfaces ) ) {

			const material = worn.build( id );
			const resources = material[ RESOURCES ];
			if ( streetWear( id ) ) {

				expect( detail.resources.every( ( resource ) => resources.includes( resource ) ), id ).toBe( true );
				expect( material.colorNode === plain.build( id ).colorNode, id ).toBe( false );

			} else {

				expect( resources.some( ( resource ) => detail.resources.includes( resource ) ), id ).toBe( false );

			}

		}
		for ( const id of [ 'asphalt', 'district-hex', 'district-panel-dark', 'district-panel-red', 'district-curb-red', 'district-gutter-red', 'joint', 'whitePaint', 'ordinary', 'curb' ] ) {

			expect( streetWear( id ), id ).not.toBeNull();

		}
		expect( worn.build( 'polished' ).clearcoatRoughnessNode?.isNode ).toBe( true );
		expect( wearStreet( detail, 'marquee-led', {} ) ).toBeNull();
		expect( () => new NativeStreetMaterials( binding, loader(), { detail: {} } ) ).toThrow( /surface detail/ );

	} );

	it( 'weathers opaque exterior walls and metals, never glass, light, print or planting', () => {

		const entry = ( physical = {}, maps = {} ) => ( { physical, variants: [ { id: 'a', maps } ] } );
		expect( exteriorWear( 'cyberpunk/concrete-monolith/mid', entry() ) ).toBe( 'wall' );
		expect( exteriorWear( 'cyberpunk/exterior-graphite-coating/mid', entry() ) ).toBe( 'wall' );
		expect( exteriorWear( 'cyberpunk/metal/poor', entry() ) ).toBe( 'metal' );
		expect( exteriorWear( 'cyberpunk/service-alloy/poor', entry() ) ).toBe( 'metal' );
		expect( exteriorWear( 'cyberpunk/door/poor', entry( { metallicFactor: 1 } ) ) ).toBe( 'metal' );
		expect( exteriorWear( 'cyberpunk/paired-window-glass/mid', entry( { transmission: 0.9 } ) ) ).toBeNull();
		expect( exteriorWear( 'cyberpunk/corporate-panel/mid', entry( {}, { emission: 'e.png' } ) ) ).toBeNull();
		expect( exteriorWear( 'cyberpunk/paired-room-lit/mid', entry() ) ).toBeNull();
		expect( exteriorWear( 'cyberpunk/signage/rich', entry() ) ).toBeNull();
		expect( exteriorWear( 'cyberpunk/window-grime-sill/rich', entry( { alphaMode: 'BLEND' } ) ) ).toBeNull();
		expect( exteriorWear( 'cyberpunk/hiromi-fern/mid', entry() ) ).toBeNull();
		expect( exteriorWear( 'cyberpunk/absent/mid', null ) ).toBeNull();
		// A rich or high-rich finish is kept up and wears half as much.
		expect( exteriorWear( 'cyberpunk/ivory-panel/rich', entry() ) ).toBe( 'kept-wall' );
		expect( exteriorWear( 'cyberpunk/metal/high_rich', entry() ) ).toBe( 'kept-metal' );

	} );

	it( 'gives a worn shell surface a tuned copy that shares one graph per profile', () => {

		const detail = inPlace();
		const entries = {
			'cyberpunk/concrete-monolith/mid': { physical: {}, variants: [ { id: 'weathered', maps: {} } ] },
			'cyberpunk/metal/poor': { physical: {}, variants: [ { id: 'zinc', maps: {} } ] },
			'cyberpunk/paired-window-glass/mid': { physical: { transmission: 0.9 }, variants: [ { id: 'clear', maps: {} } ] }
		};
		const built = new Map();
		const factory = {
			resolver: { resolve: ( key ) => entries[ key ] ?? null },
			weathering: { detail, resources: detail.resources, nodes: ( profile ) => wearExterior( detail, profile ) },
			build: ( key ) => built.get( key ) ?? built.set( key, new MeshStandardMaterial( { name: key } ) ).get( key ),
			variant: vi.fn( ( key, tweaks ) => Object.assign( new MeshStandardMaterial( { name: key } ), tweaks.weather ? factory.weathering.nodes( tweaks.weather ) : {} ) )
		};
		const concrete = shellMaterial( factory, { key: 'cyberpunk/concrete-monolith/mid', variantId: 'weathered', exterior: true } );
		const zinc = shellMaterial( factory, { key: 'cyberpunk/metal/poor', variantId: 'zinc', exterior: true } );
		const glass = shellMaterial( factory, { key: 'cyberpunk/paired-window-glass/mid', variantId: 'clear', exterior: true } );
		expect( factory.variant.mock.calls.map( ( [ key, tweaks ] ) => [ key, tweaks ] ) ).toEqual( [
			[ 'cyberpunk/concrete-monolith/mid', { variantId: 'weathered', weather: 'wall' } ],
			[ 'cyberpunk/metal/poor', { variantId: 'zinc', weather: 'metal' } ]
		] );
		// A room module asks for no wear, and gets the shared catalog material.
		expect( shellMaterial( factory, { key: 'cyberpunk/concrete-monolith/mid', variantId: 'weathered' } ) ).toBe( factory.build( 'cyberpunk/concrete-monolith/mid' ) );
		expect( concrete.colorNode.isNode ).toBe( true );
		expect( wearExterior( detail, 'wall' ) ).toBe( wearExterior( detail, 'wall' ) );
		expect( zinc.roughnessNode ).toBe( wearExterior( detail, 'metal' ).roughnessNode );
		expect( glass ).toBe( factory.build( 'cyberpunk/paired-window-glass/mid' ) );
		expect( () => wearExterior( detail, 'nothing' ) ).toThrow( /unknown profile/ );

	} );

} );
