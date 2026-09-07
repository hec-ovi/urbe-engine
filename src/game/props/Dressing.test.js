import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Dressing } from './Dressing.js';
import catalog from './catalog.json' with { type: 'json' };
import catalogSchema from './catalog.schema.json' with { type: 'json' };
import resultSchema from './result.schema.json' with { type: 'json' };
import arrangements from './arrangements.json' with { type: 'json' };
import arrangementsSchema from './arrangements.schema.json' with { type: 'json' };

const rect = ( x, z, w, d ) => [ [ x, z ], [ x + w, z ], [ x + w, z + d ], [ x, z + d ] ];
const factory = { build: () => new THREE.MeshStandardMaterial() };
let fixture;
beforeAll( async () => {
	const bytes = await readFile( new URL( './fixtures/static.glb', import.meta.url ) );
	fixture = bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
} );
const loadAsset = () => new GLTFLoader().parseAsync( fixture, '' );
function world( seed = 'service-yard' ) {
	return {
		meta: { seed }, districts: [ { id: 'd1', kind: 'industrial' } ],
		parcels: [ { id: 'p1', districtId: 'd1', type: 'factory', footprint: rect( 20, 20, 60, 40 ), access: { point: [ 50, 20 ] } } ],
		streets: { edges: [], planting: [ { edgeId: 'e1', kind: 'tree', position: [ - 15, 0 ] }, { edgeId: 'e1', kind: 'tree', position: [ - 15, 20 ] } ], highwayStructures: [] },
		transit: { subwayStations: [] }, volumetric: { ground: [ { polygon: rect( - 80, - 50, 250, 170 ), surface: 'open', bottom: 0, top: 0.2 } ] }
	};
}
async function build( atlas = world(), walk = { edges: [] }, options = {} ) { return new Dressing( atlas, walk, factory, { loadAsset, ...options } ).build(); }
function serialized( result ) { return result.placements.map( p => ( { ...p, matrix: p.matrix.toArray() } ) ); }
function overlapping( a, b ) {
	for ( const ring of [ a, b ] ) for ( let i = 0; i < ring.length; i ++ ) {
		const start = ring[ i ], end = ring[ ( i + 1 ) % ring.length ];
		const project = points => points.map( p => p[ 0 ] * ( start[ 1 ] - end[ 1 ] ) + p[ 1 ] * ( end[ 0 ] - start[ 0 ] ) );
		const x = project( a ), y = project( b );
		if ( Math.min( Math.max( ...x ), Math.max( ...y ) ) - Math.max( Math.min( ...x ), Math.min( ...y ) ) <= 1e-7 ) return false;
	}
	return true;
}
function contains( ring, point ) {
	return ring.every( ( a, i ) => {
		const b = ring[ ( i + 1 ) % ring.length ];
		return ( b[ 0 ] - a[ 0 ] ) * ( point[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( point[ 0 ] - a[ 0 ] ) >= - 1e-5;
	} );
}
function triangles( position, matrix = new THREE.Matrix4() ) {
	const out = [], vertex = new THREE.Vector3();
	for ( let i = 0; i < position.count; i += 3 ) {
		const face = [];
		for ( let j = 0; j < 3; j ++ ) face.push( vertex.fromBufferAttribute( position, i + j ).applyMatrix4( matrix ).toArray().map( Math.fround ).join( ',' ) );
		out.push( face.sort().join( ';' ) );
	}
	return out;
}

describe( 'street dressing contract', () => {
	it( 'loads the declared catalog and deterministically batches real static glTF with folded delivery geometry', async () => {
		const ajv = new Ajv(); expect( ajv.validate( catalogSchema, catalog ), JSON.stringify( ajv.errors ) ).toBe( true );
		expect( ajv.validate( arrangementsSchema, arrangements ), JSON.stringify( ajv.errors ) ).toBe( true );
		for ( const recipe of arrangements.recipes ) recipe.slots.forEach( ( slot, index ) => {
			for ( const model of slot.models ) expect( catalog.models.some( spec => spec.id === model ) ).toBe( true );
			if ( slot.on !== undefined ) expect( slot.on ).toBeLessThan( index );
		} );
		const a = await build(), b = await build();
		expect( ajv.validate( resultSchema, a ), JSON.stringify( ajv.errors ) ).toBe( true );
		expect( serialized( b ) ).toEqual( serialized( a ) );
		expect( a.counts.total ).toBeGreaterThan( 5 );
		expect( a.counts.tree ).toBe( 2 );
		expect( a.counts.guardrail ).toBe( 0 );
		expect( a.counts.box + a.counts.crate ).toBeGreaterThan( 0 );
		for ( const mesh of a.group.children ) {
			expect( mesh.isInstancedMesh ).toBe( true ); expect( mesh.frustumCulled ).toBe( true );
			expect( mesh.boundingSphere.radius ).toBeGreaterThan( 0 );
			expect( mesh.geometry.attributes.uv.count ).toBe( mesh.geometry.attributes.position.count );
		}
		const tree = a.group.children.find( mesh => mesh.name.includes( ':pine:' ) || mesh.name.includes( ':maple:' ) );
		expect( tree.geometry.attributes.color.getX( 0 ) ).toBeCloseTo( 128 / 255 );
		expect( tree.geometry.attributes.uv1.getY( 0 ) ).toBeCloseTo( 0.75 );
		expect( tree.geometry.attributes.tangent.getW( 0 ) ).toBe( - 1 );
		for ( let i = 0; i < a.placements.length; i ++ ) for ( let j = i + 1; j < a.placements.length; j ++ ) {
			const first = a.placements[ i ], second = a.placements[ j ];
			if ( Math.min( first.top, second.top ) - Math.max( first.bottom, second.bottom ) > 1e-7 ) expect( overlapping( first.footprint, second.footprint ) ).toBe( false );
		}
		expect( a.colliders.get( 'props' ).attributes.normal ).toBeUndefined();
		expect( a.colliders.get( 'props' ).attributes.position.count / 36 ).toBe( a.counts.box + a.counts.crate + a.counts.pallet + a.counts.dumpster + a.counts.container + a.counts.tree + a.counts.ornament );
		a.dispose(); b.dispose();
	} );
	it( 'keeps complete visible footprints outside buildings and door aprons at the authored top', async () => {
		const result = await build();
		for ( const p of result.placements ) {
			expect( p.bottom ).toBeGreaterThanOrEqual( 0.2 - 1e-6 );
			for ( const [ x, z ] of p.footprint ) {
				expect( x > 20 && x < 80 && z > 20 && z < 60 ).toBe( false );
				expect( Math.hypot( x - 50, z - 20 ) ).toBeGreaterThan( 3.5 );
			}
		}
		result.dispose();
	} );
	it( 'requires complete land support across material seams and rejects a narrow missing strip', async () => {
		const atlas = world(); atlas.parcels = []; atlas.streets.planting = [ { edgeId: 'e', kind: 'tree', position: [ 0, 0 ] } ];
		atlas.volumetric.ground = [ { polygon: rect( - 10, - 10, 10, 20 ), surface: 'sidewalk', top: 0.32 }, { polygon: rect( 0, - 10, 10, 20 ), surface: 'sidewalk', top: 0.32 } ];
		const joined = await build( atlas ); expect( joined.counts.tree ).toBe( 1 ); expect( joined.placements[ 0 ].bottom ).toBeCloseTo( 0.32 ); joined.dispose();
		atlas.volumetric.ground[ 1 ].polygon = rect( 0.02, - 10, 10, 20 );
		const hole = await build( atlas ); expect( hole.counts.total ).toBe( 0 ); expect( hole.colliders.size ).toBe( 0 ); hole.dispose();
	} );
	it( 'respects full walk width, vertical separation and reserved station land', async () => {
		const atlas = world(); atlas.parcels = []; atlas.streets.planting = [ { edgeId: 'e', kind: 'tree', position: [ 0, 0 ] } ];
		const edge = { id: 'walk', width: 8, path3: [ [ - 20, 0.2, 2 ], [ 20, 0.2, 2 ] ] };
		const blocked = await build( atlas, { edges: [ edge ] } ); expect( blocked.counts.total ).toBe( 0 ); blocked.dispose();
		edge.path3.forEach( p => { p[ 1 ] = - 5; } );
		const above = await build( atlas, { edges: [ edge ] } ); expect( above.counts.tree ).toBe( 1 ); above.dispose();
		const fixture = await build( atlas, { edges: [] }, { obstacles: [ { footprint: rect( - 0.2, - 0.2, 0.4, 0.4 ), bottom: 0.2, top: 4 } ] } );
		expect( fixture.counts.total ).toBe( 0 ); fixture.dispose();
		atlas.transit.subwayStations = [ { shafts: [], entranceBays: [ { footprint: rect( - 1, - 1, 2, 2 ) } ] } ];
		const reserved = await build( atlas ); expect( reserved.counts.total ).toBe( 0 ); reserved.dispose();
	} );
	it( 'places metre-sized containers only on service land and keeps denied arrangements whole', async () => {
		const atlas = world( 'container-yard' );
		const result = await build( atlas );
		const containers = result.placements.filter( p => p.kind === 'container' ); expect( containers.length ).toBeGreaterThan( 0 );
		for ( const item of containers ) {
			const lengths = item.footprint.map( ( p, i, ring ) => Math.hypot( p[ 0 ] - ring[ ( i + 1 ) % 4 ][ 0 ], p[ 1 ] - ring[ ( i + 1 ) % 4 ][ 1 ] ) );
			expect( Math.min( ...lengths ) ).toBeGreaterThan( 2.44 ); expect( Math.max( ...lengths ) ).toBeGreaterThan( 6.06 );
		}
		result.dispose(); atlas.volumetric.ground[ 0 ].surface = 'sidewalk';
		const pavement = await build( atlas ); expect( pavement.counts.container ).toBe( 0 ); pavement.dispose();
	} );
	it( 'names failed assets and skips unsupported planting kinds', async () => {
		await expect( new Dressing( world(), { edges: [] }, factory, { loadAsset: async () => { throw new Error( 'not installed' ); } } ).build() ).rejects.toMatchObject( { code: 'E_PROP_ASSET', message: expect.stringContaining( '/models/street-props/' ) } );
		const atlas = world(); atlas.parcels = []; atlas.streets.planting[ 0 ].kind = 'unknown'; atlas.streets.planting.splice( 1 );
		const result = await build( atlas ); expect( result.counts.total ).toBe( 0 ); result.dispose();
	} );
	it( 'keeps three guardrail infills inside authored quarter-turn repeats with matching visible collision', async () => {
		const atlas = world( 'guardrail-review' ); atlas.parcels = [];
		atlas.streets.planting = [ { edgeId: 'e', kind: 'tree', position: [ 1, 0 ] } ];
		const empty = await build( atlas ); expect( empty.counts.guardrail ).toBe( 0 ); expect( empty.counts.tree ).toBe( 1 ); empty.dispose();
		const definition = { id: 'street-rail', parts: [
			{ role: 'guardrail', polygon: rect( 0, - 0.07, 0.09, 0.14 ), bottom: 0.2, top: 1.2 },
			{ role: 'guardrail', polygon: rect( 1.91, - 0.07, 0.09, 0.14 ), bottom: 0.2, top: 1.2 },
			{ role: 'guardrail', polygon: rect( 0, - 0.03, 2, 0.06 ), bottom: 1.12, top: 1.2 },
			{ role: 'guardrail', polygon: rect( 0, - 0.03, 2, 0.06 ), bottom: 0.6, top: 0.66 }
		] };
		const records = Array.from( { length: 12 }, ( _, i ) => ( { moduleId: definition.id, blockId: `b${i}`, origin: [ i * 10, 0 ], turn: i % 4, count: 3, step: 2, finish: 'authored' } ) );
		atlas.streets.construction = { modules: { version: '1.0.0', definitions: [ definition ], placements: records } };
		const result = await build( atlas );
		expect( result.counts.guardrail ).toBe( 36 ); expect( result.counts.tree ).toBe( 0 );
		expect( new Set( result.placements.map( item => item.model.split( ':' ).at( - 1 ) ) ) ).toEqual( new Set( [ 'open', 'braced', 'slatted' ] ) );
		const localBounds = new THREE.Box3( new THREE.Vector3( 0, 0.2, - 0.07 ), new THREE.Vector3( 2, 1.2, 0.07 ) );
		for ( let i = 0; i < records.length; i ++ ) {
			const record = records[ i ];
			for ( let repeat = 0; repeat < record.count; repeat ++ ) {
				const item = result.placements.find( value => value.id === `rail:${i}:${repeat}` );
				const expected = new THREE.Matrix4().makeRotationY( - record.turn * Math.PI / 2 );
				const offset = new THREE.Vector3( repeat * record.step, 0, 0 ).applyMatrix4( expected );
				expected.setPosition( record.origin[ 0 ] + offset.x, 0, record.origin[ 1 ] + offset.z );
				item.matrix.elements.forEach( ( value, index ) => expect( value ).toBeCloseTo( expected.elements[ index ], 10 ) );
				expect( item.bottom ).toBeCloseTo( 0.2 ); expect( item.top ).toBeCloseTo( 1.2 );
				for ( const point of item.footprint ) {
					const local = new THREE.Vector3( point[ 0 ], 0.2, point[ 1 ] ).applyMatrix4( expected.clone().invert() );
					expect( local.x ).toBeGreaterThanOrEqual( - 1e-6 ); expect( local.x ).toBeLessThanOrEqual( 2 + 1e-6 );
					expect( Math.abs( local.z ) ).toBeLessThanOrEqual( 0.07 + 1e-6 );
				}
			}
		}
		const rendered = [], byStyle = new Map();
		for ( const mesh of result.group.children ) {
			const positions = mesh.geometry.attributes.position, vertices = [];
			for ( let i = 0; i < positions.count; i ++ ) {
				const vertex = new THREE.Vector3().fromBufferAttribute( positions, i );
				expect( localBounds.distanceToPoint( vertex ) ).toBeLessThan( 1e-6 ); vertices.push( vertex );
			}
			for ( const part of definition.parts ) for ( const [ x, z ] of part.polygon ) for ( const y of [ part.bottom, part.top ] ) {
				expect( vertices.some( point => point.distanceTo( new THREE.Vector3( x, y, z ) ) < 1e-6 ) ).toBe( true );
			}
			const style = mesh.name.split( ':' )[ 3 ];
			byStyle.set( style, JSON.stringify( Array.from( positions.array ) ) );
			for ( let i = 0; i < mesh.count; i ++ ) { const matrix = new THREE.Matrix4(); mesh.getMatrixAt( i, matrix ); rendered.push( ...triangles( positions, matrix ) ); }
		}
		expect( new Set( byStyle.values() ).size ).toBe( 3 );
		const collision = result.colliders.get( 'props' );
		expect( Object.keys( collision.attributes ) ).toEqual( [ 'position' ] );
		expect( triangles( collision.attributes.position ).sort() ).toEqual( rendered.sort() );
		result.dispose();
	} );
	describe( 'catalog arrangements', () => {
		let result;
		beforeAll( async () => {
			const atlas = world( 'plastic-details' );
			atlas.streets.planting = [];
			atlas.parcels = Array.from( { length: 24 }, ( _, i ) => ( { id: `p${i}`, districtId: 'd1', type: 'factory', footprint: rect( 20 + i * 100, 20, 60, 40 ), access: { point: [ 50 + i * 100, 20 ] } } ) );
			atlas.volumetric.ground = [ { polygon: rect( - 80, - 50, 2600, 170 ), surface: 'open', top: 0.2 } ];
			const namedFactory = { build: ( key, variant ) => Object.assign( new THREE.MeshStandardMaterial(), { name: key, userData: { variant } } ) };
			result = await new Dressing( atlas, { edges: [] }, namedFactory, { loadAsset } ).build();
		} );
		afterAll( () => result?.dispose() );
		it( 'places all four deformed plastic variants with solid bounds, fitted wear UVs and bounded material parts', () => {
			const expected = [ 'poly-crushed', 'poly-loose', 'poly-tote', 'poly-transit' ];
			const plastics = result.placements.filter( p => p.model.startsWith( 'poly-' ) );
			expect( [ ...new Set( plastics.map( p => p.model ) ) ].sort() ).toEqual( expected );
			const checked = new Set();
			for ( const item of plastics ) {
				const meshes = result.group.children.filter( mesh => mesh.name.startsWith( `props:${item.model}:` ) );
				const parts = new Set( meshes.map( mesh => mesh.name.split( ':' ).at( - 1 ) ) );
				expect( parts.size ).toBe( 3 );
				for ( const mesh of meshes ) {
					if ( ! checked.has( mesh.geometry ) ) {
						checked.add( mesh.geometry );
						const normal = mesh.geometry.attributes.normal;
						expect( Array.from( { length: normal.count }, ( _, i ) => Math.abs( Math.hypot( normal.getX( i ), normal.getY( i ), normal.getZ( i ) ) - 1 ) ).every( error => error < 1e-4 ) ).toBe( true );
						if ( mesh.material.name === 'cyberpunk/prop-polymer-face/poor' ) {
							const uv = mesh.geometry.attributes.uv.array;
							expect( Math.min( ...uv ) ).toBe( 0 ); expect( Math.max( ...uv ) ).toBe( 1 );
						}
					}
					const box = mesh.geometry.boundingBox.clone().applyMatrix4( item.matrix );
					expect( box.min.y ).toBeGreaterThanOrEqual( item.bottom - 1e-6 ); expect( box.max.y ).toBeLessThanOrEqual( item.top + 1e-6 );
				}
			}
			const body = result.group.children.find( mesh => mesh.name.startsWith( 'props:poly-crushed:' ) ).geometry;
			const p = body.attributes.position;
			const front = Array.from( { length: p.count }, ( _, i ) => [ p.getX( i ), p.getY( i ), p.getZ( i ) ] ).filter( p => p[ 2 ] > 0.12 && p[ 1 ] > 0.08 );
			expect( Math.max( ...front.map( p => p[ 2 ] ) ) - Math.min( ...front.map( p => p[ 2 ] ) ) ).toBeGreaterThan( 0.035 );
		} );
		it( 'places every ornament and shares three distinct finishes while preserving exact panel artwork', () => {
			const ornaments = result.placements.filter( item => item.kind === 'ornament' );
			expect( [ ...new Set( ornaments.map( item => item.model ) ) ].sort() ).toEqual( [ 'bench-repaired', 'memorial-shrine', 'pump-cabinet', 'relay-cabinet' ] );
			const finishes = catalog.finishes.map( finish => finish.id );
			expect( new Set( finishes ).size ).toBe( 3 );
			for ( const item of result.placements ) {
				const spec = catalog.models.find( model => model.id === item.model );
				expect( spec.asset && ! spec.cargo ? item.finish === 'original' : finishes.includes( item.finish ) ).toBe( true );
			}
			const appearances = finishes.map( finish => result.group.children.filter( mesh => mesh.name.startsWith( `props:poly-transit:${finish}:` ) ) );
			const bodies = appearances.map( meshes => meshes.find( mesh => mesh.material.name === 'cyberpunk/prop-polymer/poor' ) );
			const panels = appearances.map( meshes => meshes.find( mesh => mesh.material.name === 'cyberpunk/prop-polymer-face/poor' ) );
			expect( bodies.every( Boolean ) && panels.every( Boolean ) ).toBe( true );
			expect( new Set( bodies.map( mesh => JSON.stringify( Array.from( mesh.geometry.attributes.uv.array ) ) ) ).size ).toBe( 3 );
			expect( new Set( bodies.map( mesh => JSON.stringify( Array.from( mesh.geometry.attributes.color.array ) ) ) ).size ).toBe( 3 );
			for ( const panel of panels ) expect( panel.geometry.attributes.uv.array ).toEqual( panels[ 0 ].geometry.attributes.uv.array );
			expect( new Set( panels.map( mesh => mesh.material.userData.variant ) ) ).toEqual( new Set( [ 'scored', 'abraded' ] ) );
			for ( const body of bodies ) {
				const matching = result.group.children.filter( mesh => mesh.geometry === body.geometry );
				expect( matching.every( mesh => mesh.material === body.material ) ).toBe( true );
			}
			expect( new Set( result.group.children.map( mesh => mesh.geometry ) ).size ).toBeLessThan( result.group.children.length );
		} );
		it( 'varies repeated arrangements while every raised item rests fully on a lower member', () => {
			const groups = Map.groupBy( result.placements, item => item.arrangement );
			const signatures = new Map();
			let raised = 0, angled = 0;
			for ( const [ id, items ] of groups ) {
				const recipe = id.split( ':' ).at( - 1 );
				const inverse = items[ 0 ].matrix.clone().invert();
				const signature = items.map( item => inverse.clone().multiply( item.matrix ).elements.map( value => Number( value.toFixed( 4 ) ) ) );
				if ( ! signatures.has( recipe ) ) signatures.set( recipe, new Set() );
				signatures.get( recipe ).add( JSON.stringify( signature ) );
				for ( const item of items ) {
					const yaw = Math.atan2( item.matrix.elements[ 8 ], item.matrix.elements[ 10 ] );
					if ( Math.abs( Math.sin( yaw * 4 ) ) > 0.02 ) angled ++;
					if ( item.bottom <= 0.200001 ) continue;
					raised ++;
					const supports = items.filter( other => other !== item && Math.abs( other.top - item.bottom ) < 1e-5 );
					expect( supports.some( support => item.footprint.every( point => contains( support.footprint, point ) ) ) ).toBe( true );
				}
			}
			expect( raised ).toBeGreaterThan( 0 ); expect( angled ).toBeGreaterThan( 0 );
			for ( const recipe of [ 'parcel-delivery', 'refuse-pocket', 'pallet-delivery' ] ) expect( signatures.get( recipe )?.size ).toBeGreaterThan( 1 );
		} );
	} );
	it( 'releases imported and generated resources once while retaining factory materials, including failed loads', async () => {
		const resources = [], borrowed = new THREE.MeshStandardMaterial();
		const retained = vi.spyOn( borrowed, 'dispose' );
		const trackedLoad = async () => {
			const gltf = await loadAsset();
			const image = { close: vi.fn() }, texture = new THREE.Texture( image );
			resources.push( vi.spyOn( texture, 'dispose' ), image.close );
			gltf.scene.traverse( mesh => {
				if ( ! mesh.isMesh ) return;
				mesh.material.map = texture;
				resources.push( vi.spyOn( mesh.geometry, 'dispose' ), vi.spyOn( mesh.material, 'dispose' ) );
			} );
			return gltf;
		};
		const result = await new Dressing( world(), { edges: [] }, { build: () => borrowed }, { loadAsset: trackedLoad } ).build();
		for ( const geometry of new Set( result.group.children.map( mesh => mesh.geometry ) ) ) resources.push( vi.spyOn( geometry, 'dispose' ) );
		for ( const material of new Set( result.group.children.map( mesh => mesh.material ).filter( value => value !== borrowed ) ) ) resources.push( vi.spyOn( material, 'dispose' ) );
		for ( const geometry of result.colliders.values() ) resources.push( vi.spyOn( geometry, 'dispose' ) );
		result.dispose(); result.dispose();
		for ( const dispose of resources ) expect( dispose ).toHaveBeenCalledTimes( 1 );
		expect( retained ).not.toHaveBeenCalled();
		resources.length = 0;
		const malformedLoad = async () => { const gltf = await trackedLoad(); gltf.scene.scale.y = 0; return gltf; };
		await expect( new Dressing( world(), { edges: [] }, factory, { loadAsset: malformedLoad } ).build() ).rejects.toMatchObject( { code: 'E_PROP_ASSET' } );
		for ( const dispose of resources ) expect( dispose ).toHaveBeenCalledTimes( 1 );
		borrowed.dispose();
	} );
} );
