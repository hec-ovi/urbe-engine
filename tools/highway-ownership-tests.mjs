import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildHighwayModel, highwayFrameAt, HIGHWAY_FACE_FLAGS } from '../src/game/ground/HighwayModel.js';

const baseline = JSON.parse( readFileSync( new URL( './fixtures/highway-render-baseline.json', import.meta.url ), 'utf8' ) );
const hash = array => createHash( 'sha256' ).update( Buffer.from( array.buffer, array.byteOffset, array.byteLength ) ).digest( 'hex' );
const near = ( a, b, epsilon = 0.001 ) => assert.ok( Math.abs( a - b ) < epsilon, a + ' differs from ' + b );
const smooth = ( a, b, x ) => { const t = Math.max( 0, Math.min( 1, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); };

test( 'ownership metadata leaves every pre-existing render stream, triangle and slot unchanged', () => {
	for ( const fixture of baseline.cases ) {
		const model = buildHighwayModel( fixture.source );
		assert.deepEqual( model.parts.map( p => p.slot ), fixture.renderStreams.map( p => p.slot ) );
		for ( let i = 0; i < model.parts.length; i ++ ) {
			const geometry = model.parts[ i ].geometry, before = fixture.renderStreams[ i ];
			assert.equal( geometry.getAttribute( 'position' ).count, before.vertices );
			assert.equal( geometry.index, null );
			for ( const channel of [ 'position', 'normal', 'uv' ] ) assert.equal( hash( geometry.getAttribute( channel ).array ), before.hashes[ channel ], fixture.name + '/' + before.slot + '/' + channel );
		}
		model.dispose();
	}
} );

test( 'owner ranges form a complete triangle-aligned partition and use source indices', () => {
	const fixture = baseline.cases[ 0 ], model = buildHighwayModel( fixture.source );
	let metadataBytes = 0, vertices = 0, ranges = 0;
	for ( const part of model.parts ) {
		const geometry = part.geometry, count = geometry.getAttribute( 'position' ).count;
		const ownership = geometry.userData.highwayContent.ownership;
		assert.equal( ownership.version, 1 );
		const source = geometry.getAttribute( ownership.sourceAttribute ), face = geometry.getAttribute( ownership.faceAttribute );
		assert.equal( source.itemSize, 2 ); assert.equal( source.count, count );
		assert.ok( source.array instanceof Float32Array );
		assert.equal( face.itemSize, 1 ); assert.equal( face.count, count );
		assert.ok( face.array instanceof Uint8Array ); assert.equal( face.normalized, false );
		let next = 0;
		for ( const range of ownership.ownerRanges ) {
			assert.equal( range.start, next );
			assert.equal( range.start % 3, 0 ); assert.equal( range.count % 3, 0 );
			assert.ok( range.count > 0 && range.support >= - 1 && range.support < fixture.source.supports.length );
			next += range.count;
			if ( range.support >= 0 ) {
				const owner = ownership.supportTable[ range.support ], original = fixture.source.supports[ range.support ];
				assert.equal( owner.index, range.support );
				assert.equal( owner.bottom, original.bottom );
				assert.equal( owner.top, original.top );
			}
		}
		assert.equal( next, count );
		if ( [ 'roadway', 'deck-concrete', 'barrier-concrete' ].includes( part.slot ) ) assert.ok( ownership.ownerRanges.every( r => r.support === - 1 ) );
		vertices += count; ranges += ownership.ownerRanges.length;
		metadataBytes += source.array.byteLength + face.array.byteLength;
	}
	assert.equal( metadataBytes, vertices * 9 );
	assert.equal( model.statistics.ownershipBytes, metadataBytes );
	assert.equal( model.statistics.ownerRanges, ranges );
	model.dispose();
} );

test( 'two pier base elevations retain independent bottom/top and the same local wear extent', () => {
	const fixture = baseline.cases[ 0 ], model = buildHighwayModel( fixture.source );
	const geometry = model.parts.find( p => p.slot === 'pier-concrete' ).geometry;
	const position = geometry.getAttribute( 'position' ), ownership = geometry.userData.highwayContent.ownership;
	assert.deepEqual( ownership.supportTable.map( p => p.bottom ), [ 1.5, - 2 ] );
	assert.equal( ownership.ownerRanges.length, 2 );
	for ( const range of ownership.ownerRanges ) {
		const support = ownership.supportTable[ range.support ];
		let min = Infinity, max = - Infinity;
		for ( let i = range.start; i < range.start + range.count; i ++ ) {
			min = Math.min( min, position.getY( i ) ); max = Math.max( max, position.getY( i ) );
		}
		near( min, support.bottom ); near( max, support.top );
		// Consumer example: use the owner's bottom, not zero or a repeated UV band.
		for ( const [ offset, expected ] of [ [ 0, 1 ], [ .08, 1 ], [ .365, .5 ], [ .65, 0 ], [ 2, 0 ] ] ) {
			const worldY = support.bottom + offset;
			near( 1 - smooth( .08, .65, worldY - support.bottom ), expected, 1e-9 );
		}
	}
	model.dispose();
} );

test( 'ramp and bend stations follow construction frames, not swept texture distance', () => {
	const fixture = baseline.cases[ 1 ], model = buildHighwayModel( fixture.source );
	const frames = new Map();
	let differentFromUv = 0, rampVertices = 0, bendVertices = 0;
	for ( const part of model.parts ) {
		const p = part.geometry.getAttribute( 'position' ), uv = part.geometry.getAttribute( 'uv' );
		const coordinates = part.geometry.getAttribute( '_highway_source' );
		for ( let i = 0; i < p.count; i ++ ) {
			const station = coordinates.getX( i ), deckTop = coordinates.getY( i );
			assert.ok( Number.isFinite( station ) && Number.isFinite( deckTop ) );
			if ( ! frames.has( station ) ) frames.set( station, highwayFrameAt( fixture.source, station ) );
			const f = frames.get( station );
			near( deckTop, f.y );
			const dx = p.getX( i ) - f.x, dz = p.getZ( i ) - f.z;
			const lateral = ( dx * f.offset[ 0 ] + dz * f.offset[ 1 ] ) / ( f.offset[ 0 ] ** 2 + f.offset[ 1 ] ** 2 );
			near( p.getX( i ), f.x + f.offset[ 0 ] * lateral, .003 );
			near( p.getZ( i ), f.z + f.offset[ 1 ] * lateral, .003 );
			if ( part.slot === 'roadway' ) near( station, uv.getY( i ) );
			if ( part.slot === 'soffit-concrete' && Math.abs( station - uv.getX( i ) ) > .1 ) differentFromUv ++;
			if ( station > 1 && station < 59 ) { near( deckTop, station * 8 / 60 ); rampVertices ++; }
			if ( station > 80 && station < 117 ) bendVertices ++;
		}
	}
	assert.ok( differentFromUv > 0 && rampVertices > 0 && bendVertices > 0 );
	model.dispose();
} );

test( 'actual barrier caps, chamfers and road sides carry stable triangle face tags', () => {
	const source = baseline.cases[ 0 ].source, model = buildHighwayModel( source );
	const barrier = model.parts.find( p => p.slot === 'barrier-concrete' ).geometry;
	const flags = barrier.getAttribute( '_highway_face' ), normal = barrier.getAttribute( 'normal' ), positions = barrier.getAttribute( 'position' );
	let caps = 0, bevels = 0, roadSides = 0;
	for ( let i = 0; i < flags.count; i += 3 ) {
		const flag = flags.getX( i );
		assert.equal( flag, flags.getX( i + 1 ) ); assert.equal( flag, flags.getX( i + 2 ) );
		assert.equal( flag & ~31, 0 );
		if ( flag & HIGHWAY_FACE_FLAGS.CAP ) { caps ++; near( positions.getY( i ), 9.1 ); assert.ok( normal.getY( i ) > .99 ); }
		if ( flag & HIGHWAY_FACE_FLAGS.CHAMFER ) bevels ++;
		if ( flag & HIGHWAY_FACE_FLAGS.ROAD_SIDE ) { roadSides ++; assert.ok( normal.getZ( i ) * positions.getZ( i ) < 0 ); }
	}
	assert.ok( caps > 0 && bevels > 0 && roadSides > 0 );
	const soffit = model.parts.find( p => p.slot === 'soffit-concrete' ).geometry.getAttribute( '_highway_face' );
	assert.ok( Array.from( soffit.array ).some( flag => flag & HIGHWAY_FACE_FLAGS.DRIP ) );
	model.dispose();
} );

test( 'ownerless geometry uses an explicit sentinel and empty support table', () => {
	const source = structuredClone( baseline.cases[ 0 ].source ); source.supports = [];
	const model = buildHighwayModel( source );
	for ( const part of model.parts ) {
		const metadata = part.geometry.userData.highwayContent.ownership;
		assert.deepEqual( metadata.supportTable, [] );
		assert.ok( metadata.ownerRanges.every( range => range.support === - 1 ) );
	}
	model.dispose();
} );

test( 'GLB exports preserve source coordinates, raw face bytes and owner tables', async () => {
	const { Group, Mesh, MeshStandardMaterial } = await import( 'three' );
	const { GLTFExporter } = await import( 'three/addons/exporters/GLTFExporter.js' );
	globalThis.FileReader ??= class {
		readAsArrayBuffer( blob ) { blob.arrayBuffer().then( buffer => { this.result = buffer; this.onloadend?.(); } ); }
	};
	const model = buildHighwayModel( baseline.cases[ 0 ].source ), group = new Group(), material = new MeshStandardMaterial();
	for ( const part of model.parts ) group.add( new Mesh( part.geometry, material ) );
	const bytes = Buffer.from( await new GLTFExporter().parseAsync( group, { binary: true } ) );
	const json = JSON.parse( bytes.subarray( 20, 20 + bytes.readUInt32LE( 12 ) ).toString().trim() );
	const primitives = json.meshes.flatMap( mesh => mesh.primitives );
	assert.equal( primitives.length, model.parts.length );
	for ( const primitive of primitives ) {
		const source = json.accessors[ primitive.attributes._HIGHWAY_SOURCE ], face = json.accessors[ primitive.attributes._HIGHWAY_FACE ];
		assert.equal( source.type, 'VEC2' ); assert.equal( source.componentType, 5126 );
		assert.equal( face.type, 'SCALAR' ); assert.equal( face.componentType, 5121 ); assert.equal( face.normalized ?? false, false );
		const owner = primitive.extras.highwayContent.ownership;
		assert.equal( owner.version, 1 );
		assert.equal( owner.pathLength, 100 ); assert.equal( owner.closedRoute, false );
		assert.equal( owner.ownerRanges.reduce( ( n, r ) => n + r.count, 0 ), source.count );
		assert.deepEqual( owner.supportTable.map( support => support.bottom ), [ 1.5, - 2 ] );
	}
	model.dispose(); material.dispose();
} );
