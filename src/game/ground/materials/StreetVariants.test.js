import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, DataArrayTexture, Float32BufferAttribute, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three/webgpu';
import binding from '../../../../../materials/bindings/street-native.json' with { type: 'json' };
import { NativeStreetMaterials } from './NativeStreetMaterials.js';
import { choose, fnv1a, fnvWords, placementId, StreetVariants, withPanelUnits } from './StreetVariants.js';
import { packVariants } from './VariantPack.js';
import { StreetInstanceTable } from '../native-stream/StreetInstanceTable.js';

const map = ( name, colorSpace = 'linear', resolution = [ 4, 4 ] ) => ( { path: `themes/cyberpunk/assets/variants/${name}.png`, sha256: '0'.repeat( 64 ), resolution, colorSpace, wrap: [ 'repeat', 'repeat' ] } );
const bundle = ( set, id, weight, resolution ) => ( {
	id, condition: id, weight, material: { key: 'cyberpunk/street-sidewalk/mid', variant: id },
	maps: Object.fromEntries( [ 'basecolor', 'normal', 'roughness', 'ao' ].map( ( slot ) => [ slot, `${set}-${id}-${slot}` ] ) ),
	resolution
} );

/** A binding in the shape Materials publishes: a panel set over the slabs and a world-cell set over the hex paving. */
function variantBinding() {

	const sets = {
		'concrete-slabs': { worldSize: [ 2, 2 ], selection: { unit: 'panel', salt: 'precast-variants-v1', fallback: 'clean', uvTransform: 'identity' },
			variants: [ bundle( 'concrete', 'clean', 0.55 ), bundle( 'concrete', 'stained', 0.28 ), bundle( 'concrete', 'cracked', 0.1 ), bundle( 'concrete', 'patched', 0.07 ) ] },
		'hex-grey': { worldSize: [ 1.2, 1.385640646 ], selection: { unit: 'world-cell', salt: 'street-hex-grey-v1', fallback: 'clean-a', uvTransform: 'identity' },
			variants: [ bundle( 'hex', 'clean-a', 0.5, [ 4, 6 ] ), bundle( 'hex', 'stained-a', 0.5, [ 4, 6 ] ) ] }
	};
	const textures = {};
	for ( const set of Object.values( sets ) ) {

		for ( const variant of set.variants ) {

			for ( const [ slot, id ] of Object.entries( variant.maps ) ) textures[ id ] = map( id, slot === 'basecolor' ? 'srgb' : 'linear', variant.resolution ?? [ 4, 4 ] );
			delete variant.resolution;

		}

	}

	return { version: 1, baseBinding: { path: 'bindings/street-native.json', sha256: '0'.repeat( 64 ) }, textures, sets,
		surfaces: { ordinary: 'concrete-slabs', 'worn-a': 'concrete-slabs', 'district-hex': 'hex-grey', 'district-junction-blue': 'concrete-slabs', absent: 'concrete-slabs', asphalt: 'concrete-slabs' } };

}

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

function arrays() {

	return vi.fn( ( set ) => {

		const color = Object.assign( new DataArrayTexture( null, 4, 4, set.layers.length ), { name: `${set.id}:color` } );
		const response = Object.assign( new DataArrayTexture( null, 4, 4, set.layers.length ), { name: `${set.id}:response` } );
		const ready = Promise.resolve();
		return { color, response, ready, resources: [ { texture: color, ready }, { texture: response, ready } ] };

	} );

}

/** Every node a node graph reaches. */
function nodes( root ) {

	const seen = new Set(), stack = [ root ];
	while ( stack.length ) {

		const node = stack.pop();
		if ( ! node?.isNode || seen.has( node ) ) continue;
		seen.add( node );
		for ( const child of node.getChildren() ) stack.push( child );

	}

	return [ ...seen ];

}

describe( 'street variants', () => {

	it( 'hashes with FNV-1a 32 over UTF-8 and continues over little-endian words', () => {

		expect( fnv1a( '' ) ).toBe( 2166136261 );
		expect( fnv1a( 'a' ) ).toBe( 0xe40c292c );
		expect( fnv1a( 'foobar' ) ).toBe( 0xbf9cf968 );
		// A word is its four bytes, low byte first, a negative one in two's complement.
		expect( fnvWords( fnv1a( '' ), [ 0x64636261 ] ) ).toBe( fnv1a( 'abcd' ) );
		expect( fnvWords( 1, [ - 1 ] ) ).toBe( fnvWords( 1, [ 0xffffffff ] ) );

	} );

	it( 'picks the first variant whose cumulative weight exceeds the hash, in the proportions the set asks for', () => {

		expect( choose( [ 0.5, 1 ], 0 ) ).toBe( 0 );
		expect( choose( [ 0.5, 1 ], 2147483648 ) ).toBe( 1 );
		expect( choose( [ 0.5, 1 ], 4294967295 ) ).toBe( 1 );
		const variants = new StreetVariants( variantBinding(), { base: binding, worldSeed: 'tiny-check-1' } );
		const counts = [ 0, 0, 0, 0 ];
		for ( let panel = 0; panel < 4000; panel ++ ) counts[ variants.select( 'ordinary', `kerb/ordinary/walk@${panel},0,0`, [ panel % 7 ] ) ] ++;
		[ 0.55, 0.28, 0.1, 0.07 ].forEach( ( weight, index ) => expect( Math.abs( counts[ index ] / 4000 - weight ) ).toBeLessThan( 0.03 ) );
		// The same panel of the same placement draws the same variant, a different seed may not.
		const one = variants.select( 'ordinary', 'kerb/ordinary/walk@1,0,2', [ 3 ] );
		expect( variants.select( 'ordinary', 'kerb/ordinary/walk@1,0,2', [ 3 ] ) ).toBe( one );
		expect( variants.seed( 'ordinary', 'p' ) ).toBe( fnv1a( JSON.stringify( [ 'precast-variants-v1', 'tiny-check-1', 'ordinary', 'p' ] ) ) );
		expect( placementId( { piece: 'kerb/ordinary/walk', position: [ 45.6, 0, 21.8 ] } ) ).toBe( 'kerb/ordinary/walk@45.6,0,21.8' );

	} );

	it( 'dresses only the surfaces of this world that are photographed and sampled the way their set selects', () => {

		const variants = new StreetVariants( variantBinding(), { base: binding, worldSeed: 1 } );
		expect( variants.of( 'ordinary' ) ).toMatchObject( { id: 'concrete-slabs', unit: 'panel', fallback: 0, resolution: [ 4, 4 ] } );
		expect( variants.of( 'worn-a' ) ).toBe( variants.of( 'ordinary' ) );
		expect( variants.of( 'district-hex' ) ).toMatchObject( { unit: 'world-cell', resolution: [ 4, 6 ] } );
		[ 0.55, 0.83, 0.93, 1 ].forEach( ( edge, index ) => expect( variants.of( 'ordinary' ).cdf[ index ] ).toBeCloseTo( edge, 12 ) );
		// A world-sampled surface cannot take panels, a missing one stays missing, asphalt is not photographed.
		const skipped = Object.fromEntries( variants.skipped.map( ( { surfaceId, reason } ) => [ surfaceId, reason ] ) );
		expect( Object.keys( skipped ).sort() ).toEqual( [ 'absent', 'asphalt', 'district-junction-blue' ] );
		expect( variants.of( 'district-junction-blue' ) ).toBe( null );
		const broken = variantBinding();
		broken.textures[ 'concrete-stained-normal' ].colorSpace = 'srgb';
		expect( new StreetVariants( broken, { base: binding } ).of( 'ordinary' ) ).toBe( null );
		expect( () => new StreetVariants( { version: 2 }, { base: binding } ) ).toThrow( /Invalid street variant binding/ );

	} );

	it( 'numbers the panels of a slab-mapped primitive by where their UV charts start, clipped remainders and all', () => {

		// Two 2 m slabs side by side, each its own 0..1 chart, sharing their middle edge's
		// positions; the second slab's right half is drawn as a clipped remainder
		// triangle of the same chart, and the first slab is drawn turned a quarter.
		const positions = [], uvs = [];
		const quad = ( x, chart ) => {

			const corners = [ [ x, 0 ], [ x + 2, 0 ], [ x + 2, 2 ], [ x, 2 ] ];
			for ( const at of [ 0, 1, 2, 0, 2, 3 ] ) { positions.push( corners[ at ][ 0 ], 0, corners[ at ][ 1 ] ); uvs.push( ...chart[ at ] ); }

		};
		quad( 0, [ [ 0, 1 ], [ 0, 0 ], [ 1, 0 ], [ 1, 1 ] ] );
		quad( 2, [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ] );
		positions.push( 3, 0, 0, 4, 0, 0, 4, 0, 1 ); uvs.push( 0.5, 0, 1, 0, 1, 0.5 );
		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );
		geometry.setAttribute( '_street_wear', new Float32BufferAttribute( new Float32Array( positions.length / 3 ), 1 ) );
		// The first slab's chart starts where the second's does, turned: still two panels.
		geometry.setIndex( [ ...Array( positions.length / 3 ).keys() ] );
		withPanelUnits( geometry );
		const panel = geometry.getAttribute( '_street_panel' );
		const units = [ ...geometry.index.array ].map( ( vertex ) => panel.getX( vertex ) );
		expect( new Set( units.slice( 0, 6 ) ).size ).toBe( 1 );
		expect( new Set( units.slice( 6 ) ).size ).toBe( 1 );
		expect( units[ 0 ] ).not.toBe( units[ 6 ] );

		// Two slabs mirrored about their common edge share its two vertices, UVs and
		// all: those are split, and every other attribute follows them.
		const mirrored = ( order ) => {

			const pair = new BufferGeometry();
			pair.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0, 2, 0, 0, 2, 0, 2, 4, 0, 0, 4, 0, 2, 0, 0, 2 ], 3 ) );
			pair.setAttribute( 'uv', new BufferAttribute( new Uint16Array( [ 0, 0, 65535, 0, 65535, 65535, 0, 0, 0, 65535, 0, 65535 ] ), 2, true ) );
			pair.setIndex( order );
			withPanelUnits( pair );
			return { pair, units: [ ...pair.index.array ].map( ( vertex ) => pair.getAttribute( '_street_panel' ).getX( vertex ) ) };

		};
		const { pair, units: split } = mirrored( [ 0, 1, 2, 0, 2, 5, 1, 3, 4, 1, 4, 2 ] );
		expect( pair.getAttribute( 'position' ).count ).toBe( 8 );
		expect( pair.getAttribute( 'uv' ).normalized ).toBe( true );
		expect( split.slice( 0, 6 ) ).toEqual( Array( 6 ).fill( split[ 0 ] ) );
		expect( split.slice( 6 ) ).toEqual( Array( 6 ).fill( split[ 6 ] ) );
		expect( split[ 6 ] ).not.toBe( split[ 0 ] );
		expect( pair.getAttribute( 'position' ).getX( pair.index.getX( 6 ) ) ).toBe( 2 );

		// Turning the triangle order round numbers the same panels the same way.
		const { units: again } = mirrored( [ 1, 3, 4, 1, 4, 2, 0, 1, 2, 0, 2, 5 ] );
		expect( again[ 6 ] ).toBe( split[ 0 ] );
		expect( again[ 0 ] ).toBe( split[ 6 ] );

	} );

	it( 'draws a dressed surface from two texture arrays in place of its four maps, and asks its geometry for panels only per copy', async () => {

		const load = loader(), port = arrays();
		const variants = new StreetVariants( variantBinding(), { base: binding, worldSeed: 'w' } );
		const factory = new NativeStreetMaterials( binding, load, { variants: { binding: variants, arrays: port } } );
		const table = new StreetInstanceTable( { variant: () => 0x12345678 } );
		const copies = factory.build( 'ordinary', { instances: table.ports } );
		expect( factory.panelled( copies ) ).toBe( true );
		expect( factory.resources( copies ).map( ( resource ) => resource.texture.name ) ).toEqual( [ 'concrete-slabs:color', 'concrete-slabs:response' ] );
		expect( load ).not.toHaveBeenCalled();
		expect( copies.userData.streetVariants ).toBe( 'concrete-slabs' );
		const geometry = new BufferGeometry();
		for ( const [ name, size ] of Object.entries( { position: 3, normal: 3, uv: 2, _street_wear: 1 } ) ) geometry.setAttribute( name, new Float32BufferAttribute( new Float32Array( 3 * size ), size ) );
		expect( () => factory.assertGeometry( copies, geometry ) ).toThrow( /_street_panel/ );
		// Without a copy to say which, and on world-sampled parts, a slab draws per world cell or its fallback.
		expect( factory.panelled( factory.build( 'ordinary' ) ) ).toBe( false );
		expect( factory.panelled( factory.build( 'ordinary', { instances: table.ports, worldUv: true } ) ) ).toBe( false );
		factory.assertGeometry( factory.build( 'district-hex' ), geometry );
		// One pair of arrays per set, whichever surfaces wear it.
		factory.build( 'worn-a', { instances: table.ports } );
		expect( port.mock.calls.map( ( [ set ] ) => set.id ) ).toEqual( [ 'concrete-slabs', 'hex-grey' ] );
		// An undressed surface keeps its own maps.
		factory.build( 'concrete' );
		expect( load ).toHaveBeenCalled();
		await Promise.all( factory.resources( copies ).map( ( resource ) => resource.ready ) );
		factory.dispose();

	} );

	it( 'packs a set as an sRGB colour array and a linear normal, roughness and AO array, bottom row first, the fallback standing in for a variant it cannot read', async () => {

		const pixel = ( r, g, b, a = 255 ) => new Uint8Array( [ r, g, b, a, r, g, b, a ] );
		const maps = { basecolor: 10, normal: 20, roughness: 30, ao: 40 };
		const request = { width: 1, height: 2, fallback: 0, layers: [ 'clean', 'stained' ].map( ( id ) => ( { id, maps: Object.fromEntries( Object.keys( maps ).map( ( slot ) => [ slot, { url: `${id}/${slot}`, sha256: 'x' } ] ) ) } ) ) };
		const read = async ( url ) => {

			if ( url === 'stained/ao' ) throw new Error( 'HTTP 404' );
			return url;

		};
		// Each file's top row is its value, its bottom row its value plus one.
		const decode = async ( url ) => {

			const value = maps[ url.split( '/' )[ 1 ] ];
			return new Uint8Array( [ ...pixel( value, value + 1, value + 2 ).slice( 0, 4 ), ...pixel( value + 100, value + 101, value + 102 ).slice( 0, 4 ) ] );

		};
		const packed = await packVariants( request, { decode, read, digest: async () => 'x' } );
		expect( [ ...packed.color.slice( 0, 8 ) ] ).toEqual( [ 110, 111, 112, 255, 10, 11, 12, 255 ] );
		expect( [ ...packed.response.slice( 0, 8 ) ] ).toEqual( [ 120, 121, 130, 140, 20, 21, 30, 40 ] );
		expect( [ ...packed.response.slice( 8 ) ] ).toEqual( [ ...packed.response.slice( 0, 8 ) ] );
		expect( packed.failed ).toEqual( [ 'stained: HTTP 404' ] );
		await expect( packVariants( { ...request, fallback: 1 }, { decode, read, digest: null } ) ).rejects.toThrow( /fallback/ );

	} );

	it( 'keeps a copy\'s hash prefix in a texel of its own, ahead of any glyphs', () => {

		const table = new StreetInstanceTable( { glyphs: 2, variant: () => 0xdeadbeef } );
		expect( table.header ).toBe( 3 );
		table.bind( { mesh: { _indirectTexture: null }, capacity: 1 } );
		table.write( 0, { tint: [ 1, 1, 1 ], wear: 0, text: [ 7, 8 ] } );
		const data = table.image.image.data;
		expect( [ data[ 8 ], data[ 9 ] ] ).toEqual( [ 0xdead, 0xbeef ] );
		expect( [ data[ 12 ], data[ 16 ] ] ).toEqual( [ 7, 8 ] );
		expect( table.ports.variant ).toBeDefined();
		table.dispose();

	} );

} );

describe( 'world-sampled normals', () => {

	it( 'decode a world-sampled surface\'s normal in world X and Z, never in its UV chart, and a panel surface\'s in its chart', () => {

		const factory = new NativeStreetMaterials( binding, loader() );
		const kinds = ( material ) => nodes( material.normalNode ).map( ( node ) => node.constructor.type ?? node.type );
		const world = Object.keys( binding.surfaces ).filter( ( id ) => binding.surfaces[ id ].uv?.mode === 'world-xz' && binding.surfaces[ id ].maps.normal );
		expect( world.length ).toBeGreaterThan( 0 );
		for ( const id of [ ...world, 'asphalt' ] ) {

			const graph = kinds( factory.build( id ) );
			expect( graph, id ).not.toContain( 'NormalMapNode' );
			expect( graph, id ).not.toContain( 'UVNode' );

		}
		expect( kinds( factory.build( 'concrete', { worldUv: true } ) ) ).not.toContain( 'NormalMapNode' );
		expect( kinds( factory.build( 'ordinary' ) ) ).toContain( 'NormalMapNode' );
		factory.dispose();

	} );

} );
