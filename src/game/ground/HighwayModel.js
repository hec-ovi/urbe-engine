import { Box3, BufferGeometry, Float32BufferAttribute, ShapeUtils, Uint8BufferAttribute, Vector2 } from 'three/webgpu';

/**
 * Authored highway mesh content. Atlas owns route, levels, carriageway width,
 * structural depth, barrier reservations and support footprints. This module
 * neither changes those records nor publishes physics/ground replacements.
 *
 * Metres, Y up, Atlas world coordinates. Each returned part is one material
 * slot and one BufferGeometry. Caller owns/disposes these geometries.
 */
export const HIGHWAY_CONTENT_VERSION = '1.0.0';
export const HIGHWAY_MATERIAL_SLOTS = Object.freeze( [
	'roadway', 'deck-concrete', 'soffit-concrete', 'pier-concrete',
	'barrier-concrete', 'bearing-steel', 'joint-rubber'
] );
export const HIGHWAY_OWNERSHIP_VERSION = 1;
export const HIGHWAY_FACE_FLAGS = Object.freeze( { CAP: 1, CHAMFER: 2, DRIP: 4, END: 8, ROAD_SIDE: 16 } );
const EPS = 1e-7, MITRE_LIMIT = 2.5;

export function buildHighwayModel( structure ) {

	const route = routeOf( structure );
	const writer = new MeshWriter( route );
	const detail = { bearings: [], omittedBearings: [], joints: [], diaphragms: [], supports: [] };
	const depth = structure.deckThickness;
	const seatDepth = Math.min( 0.12, depth * 0.16 );
	const bearingSites = [];
	const jointStations = [];

	for ( let i = 0; i < structure.supports.length; i ++ ) {

		const support = structure.supports[ i ];
		validateSupport( support, i );
		const station = route.stationOf( support.position ?? centerOf( support.footprint ) );
		const ring = cleanRing( support.footprint );
		const levels = ring.map( ( point ) => route.at( route.stationOf( point ) ).y - depth );
		const soffit = route.at( station ).y - depth;
		const flat = Math.max( ...levels ) - Math.min( ...levels ) < 0.002;
		const joined = Math.abs( soffit - support.top ) < 0.003;
		const halfSeat = Math.max( ...ring.map( ( point ) => Math.abs( route.stationOf( point ) - station ) ) ) * 0.72 + 0.025;
		const feasible = flat && joined && station > halfSeat + 0.05 && station < route.length - halfSeat - 0.05;
		const record = { support: i, station, footprint: ring, bottom: support.bottom, top: support.top };
		detail.supports.push( record );
		writer.supports[ i ] = { index: i, bottom: support.bottom, top: support.top, station };
		writer.owner = i;
		pier( writer, ring, support.bottom, support.top, i );
		if ( feasible ) {

			bearingSites.push( { station, half: halfSeat } );
			const steel = Math.min( 0.018, seatDepth * 0.18 );
			const bearingRing = scaleRing( ring, 0.7 );
			loft( writer, 'bearing-steel', [ { ring: bearingRing, y: support.top }, { ring: bearingRing, y: support.top + steel } ] );
			loft( writer, 'joint-rubber', [
				{ ring: scaleRing( ring, 0.64 ), y: support.top + steel },
				{ ring: scaleRing( ring, 0.64 ), y: support.top + seatDepth - steel }
			] );
			loft( writer, 'bearing-steel', [
				{ ring: bearingRing, y: support.top + seatDepth - steel },
				{ ring: bearingRing, y: support.top + seatDepth }
			] );
			detail.bearings.push( { support: i, station, bottom: support.top, top: support.top + seatDepth,
				footprint: bearingRing, interpretation: 'authored bearing seat; no close reference establishes the hardware' } );

		} else {

			detail.omittedBearings.push( { support: i, reason: ! flat ? 'sloped-soffit-no-extra-clearance'
				: ! joined ? 'support-top-does-not-meet-flat-soffit' : 'terminal-seat-does-not-fit' } );

		}
		// A joint belongs to a support, not to every arbitrary mesh subdivision.
		if ( station > 0.5 && station < route.length - 0.5 ) jointStations.push( station );

	}
	writer.owner = - 1;
	const joints = unique( jointStations );
	const stations = unique( [ ...route.knots,
		...bearingSites.flatMap( ( site ) => [ site.station - site.half, site.station + site.half ] ),
		...joints.flatMap( ( station ) => [ station - 0.025, station + 0.025 ] ) ] );
	const sections = stations.map( ( distance ) => route.at( distance ) );

	let previousProfile = null;
	for ( let i = 0; i < sections.length - 1; i ++ ) {

		const a = sections[ i ], b = sections[ i + 1 ], mid = ( a.distance + b.distance ) / 2;
		const raised = bearingSites.some( ( site ) => Math.abs( mid - site.station ) < site.half - EPS ) ? seatDepth + Math.min( 0.005, depth * 0.01 ) : 0;
		const seal = joints.some( ( station ) => Math.abs( mid - station ) < 0.025 + EPS );
		const profile = deckSection( structure.width, depth, raised );
		if ( previousProfile ) sectionStep( writer, previousProfile, profile, a );
		previousProfile = profile;
		sweep( writer, profile, a, b, ( edge ) => {

			if ( edge === 0 ) return seal ? 'joint-rubber' : 'roadway';
			if ( seal ) return 'joint-rubber';
			const p = profile[ edge ], q = profile[ ( edge + 1 ) % profile.length ];
			return Math.min( Math.abs( p[ 0 ] ), Math.abs( q[ 0 ] ) ) > structure.width / 2 - 0.08
				? 'deck-concrete' : 'soffit-concrete';

		}, { roadWidth: structure.width, startCap: i === 0, endCap: i === sections.length - 2, capSlot: 'deck-concrete',
			extraFlags: ( p, q ) => ( Math.abs( p[ 1 ] + depth * 0.22 ) < EPS && Math.abs( q[ 1 ] + depth * 0.25 ) < EPS )
				|| ( Math.abs( q[ 1 ] + depth * 0.22 ) < EPS && Math.abs( p[ 1 ] + depth * 0.25 ) < EPS ) ? HIGHWAY_FACE_FLAGS.DRIP : 0 } );

	}
	for ( const station of joints ) detail.joints.push( { station, width: 0.05, top: route.at( station ).y } );

	// A cross-head is part of the deck envelope, never a wider pier at grade.
	for ( let i = 0; i < structure.supports.length; i ++ ) {

		const station = detail.supports[ i ].station;
		if ( station < 0.6 || station > route.length - 0.6 ) continue;
		const site = bearingSites.find( ( item ) => Math.abs( item.station - station ) < EPS );
		const supportHalf = Math.max( ...detail.supports[ i ].footprint.map( ( point ) => Math.abs( route.stationOf( point ) - station ) ) );
		const halfLength = site ? Math.max( 0.1, site.half - 0.02 ) : Math.max( 0.1, supportHalf );
		const half = structure.width / 2;
		const upper = - depth * 0.23, lower = - depth + ( site ? seatDepth : 0 ), bevel = Math.min( 0.035, depth * 0.06 );
		const p = [ [ - half, upper ], [ half, upper ], [ half, lower + bevel ], [ half - bevel, lower ],
			[ - half + bevel, lower ], [ - half, lower + bevel ] ];
		const a = route.at( station - halfLength ), b = route.at( station + halfLength );
		writer.owner = i;
		sweep( writer, p, a, b, () => 'soffit-concrete', { caps: true, capSlot: 'soffit-concrete' } );
		writer.owner = - 1;
		detail.diaphragms.push( { support: i, station, length: halfLength * 2, depthFraction: - lower / depth } );

	}
	for ( const side of [ 'left', 'right' ] ) {

		const spec = structure.barriers?.[ side ];
		if ( ! spec ) continue;
		validateBarrier( spec, side );
		barrier( writer, route, structure.width, spec, side, joints );

	}
	const result = writer.finish();
	return {
		version: HIGHWAY_CONTENT_VERSION, parts: result.parts, bounds: result.bounds,
		statistics: { ...result.statistics, structures: 1, supports: detail.supports.length,
			bearings: detail.bearings.length, joints: detail.joints.length, diaphragms: detail.diaphragms.length },
		detail,
		source: { edgeIds: [ ...( structure.edgeIds ?? [] ) ], width: structure.width, deckThickness: depth,
			path: structure.path.map( ( point ) => [ ...point ] ), elevationProfile: structure.elevationProfile.map( ( point ) => ( { ...point } ) ),
			barriers: structure.barriers ? structuredClone( structure.barriers ) : null },
		dispose() { result.parts.forEach( ( part ) => part.geometry.dispose() ); }
	};

}

/** Useful for bounds/adapter checks; this reads the source, it does not alter it. */
export function highwayFrameAt( structure, distance ) {

	return routeOf( structure ).at( distance );

}

function deckSection( width, depth, bearingLift ) {

	const half = width / 2;
	const wing = Math.min( 0.24, width * 0.035 );
	const box = width * 0.285;
	const foot = width * 0.225;
	const bevel = Math.min( 0.035, depth * 0.045, width * 0.008 );
	const y = ( fraction ) => - depth * fraction;
	const low = y( 1 ) + bearingLift;
	// One calm box-girder profile: slab, drip kerf, cantilever, inclined webs
	// and a chamfered lower flange. No beam extends below the authored depth.
	const right = [
		[ half, y( 0.19 ) ], [ half - bevel, y( 0.25 ) ],
		[ half - wing, y( 0.25 ) ], [ half - wing - bevel, y( 0.22 ) ],
		[ half - wing - bevel * 2, y( 0.25 ) ], [ box, y( 0.25 ) ],
		[ box - bevel, y( 0.34 ) ], [ foot + bevel, low + depth * 0.075 ],
		[ foot, low ]
	];
	return [ [ - half, 0 ], [ half, 0 ], ...right,
		...right.slice().reverse().map( ( point ) => [ - point[ 0 ], point[ 1 ] ] ) ];

}

function barrier( writer, route, roadWidth, spec, side, joints ) {

	const direction = side === 'left' ? 1 : - 1;
	const width = spec.width, height = spec.height, half = roadWidth / 2;
	const bevel = Math.min( 0.018, width * 0.08, height * 0.03 );
	// These parapets occupy Atlas's declared strip outside the carriageway.
	// A battered inner face and chamfered cap catch light without widening it.
	let profile = [
		[ half, 0 ], [ half + width, 0 ], [ half + width, height - bevel ],
		[ half + width - bevel, height ], [ half + width * 0.46, height ],
		[ half + width * 0.39, height - bevel ], [ half + width * 0.25, height * 0.38 ],
		[ half, height * 0.2 ]
	];
	if ( signedArea( profile ) > 0 ) profile.reverse();
	if ( direction < 0 ) profile = profile.map( ( point ) => [ - point[ 0 ], point[ 1 ] ] ).reverse();
	const casts = [];
	for ( let s = 6; s < route.length - 0.08; s += 6 ) casts.push( s );
	const seals = unique( [ ...joints, ...casts ] );
	const stations = unique( [ ...route.knots, ...seals.flatMap( ( s ) => [ s - 0.006, s + 0.006 ] ) ] );
	for ( let i = 1; i < stations.length; i ++ ) {

		const a = route.at( stations[ i - 1 ] ), b = route.at( stations[ i ] );
		const mid = ( a.distance + b.distance ) / 2;
		const seal = seals.some( ( s ) => Math.abs( s - mid ) < 0.006 + EPS );
		sweep( writer, profile, a, b, () => seal ? 'joint-rubber' : 'barrier-concrete',
			{ startCap: i === 1, endCap: i === stations.length - 1, capSlot: seal ? 'joint-rubber' : 'barrier-concrete',
				extraFlags: ( p, q ) => - ( q[ 1 ] - p[ 1 ] ) * direction < - EPS ? HIGHWAY_FACE_FLAGS.ROAD_SIDE : 0 } );

	}

}

function pier( writer, footprint, bottom, top ) {

	const height = top - bottom;
	const ring = chamferRing( footprint, Math.min( 0.06, height * 0.06 ) );
	if ( height < 0.5 ) {

		loft( writer, 'pier-concrete', [ { ring, y: bottom }, { ring, y: top } ], { cornerBevels: true } );
		return;

	}
	const foot = Math.min( 0.22, height * 0.15 ), cap = Math.min( 0.48, height * 0.25 );
	const bevel = Math.min( 0.04, height * 0.025 );
	loft( writer, 'pier-concrete', [
		{ ring: scaleRing( ring, 0.97 ), y: bottom },
		{ ring, y: bottom + bevel },
		{ ring, y: bottom + foot },
		{ ring: scaleRing( ring, 0.94 ), y: bottom + foot + bevel },
		{ ring: scaleRing( ring, 0.94 ), y: top - cap },
		{ ring, y: top - bevel },
		{ ring: scaleRing( ring, 0.985 ), y: top }
	], { cornerBevels: true } );

}

function sweep( writer, profile, a, b, slotFor, { caps = false, startCap = caps, endCap = caps, capSlot = 'deck-concrete', roadWidth = null, extraFlags = () => 0 } = {} ) {

	const metricA = sectionRun( profile, a ), metricB = sectionRun( profile, b );
	const point = ( frame, p ) => [ frame.x + frame.offset[ 0 ] * p[ 0 ], frame.y + p[ 1 ],
		frame.z + frame.offset[ 1 ] * p[ 0 ] ];
	for ( let i = 0; i < profile.length; i ++ ) {

		const next = ( i + 1 ) % profile.length;
		const p = profile[ i ], q = profile[ next ];
		const pa = point( a, p ), qa = point( a, q ), pb = point( b, p ), qb = point( b, q );
		const slot = slotFor( i );
		const top = i === 0 && roadWidth !== null;
		const uv = top ? [
			[ roadWidth / 2 - p[ 0 ], a.distance ], [ roadWidth / 2 - q[ 0 ], a.distance ],
			[ roadWidth / 2 - p[ 0 ], b.distance ], [ roadWidth / 2 - q[ 0 ], b.distance ]
		] : [ [ a.surfaceDistance( p[ 0 ] ), metricA[ i ] ], [ a.surfaceDistance( q[ 0 ] ), metricA[ i + 1 ] ],
			[ b.surfaceDistance( p[ 0 ] ), metricB[ i ] ], [ b.surfaceDistance( q[ 0 ] ), metricB[ i + 1 ] ] ];
		const lateral = - ( q[ 1 ] - p[ 1 ] ), up = q[ 0 ] - p[ 0 ];
		const expected = [ ( a.offset[ 0 ] + b.offset[ 0 ] ) * lateral, up * 2,
			( a.offset[ 1 ] + b.offset[ 1 ] ) * lateral ];
		const flags = sectionFaceFlags( profile, i ) | extraFlags( p, q );
		writer.quad( slot, [ pa, qa, pb, qb ], uv, expected,
			[ [ a.distance, a.y ], [ a.distance, a.y ], [ b.distance, b.y ], [ b.distance, b.y ] ], flags );

	}
	if ( startCap || endCap ) {

		const triangles = ShapeUtils.triangulateShape( profile.map( ( p ) => new Vector2( ...p ) ), [] );
		for ( const frame of [ ...( startCap ? [ a ] : [] ), ...( endCap ? [ b ] : [] ) ] ) {

			const sign = frame === a ? - 1 : 1;
			const expected = [ frame.tangent[ 0 ] * sign, 0, frame.tangent[ 1 ] * sign ];
			for ( const tri of triangles ) writer.triangle( capSlot, tri.map( ( i ) => point( frame, profile[ i ] ) ),
				tri.map( ( i ) => [ profile[ i ][ 0 ] * Math.hypot( ...frame.offset ), profile[ i ][ 1 ] ] ), expected,
				tri.map( () => [ frame.distance, frame.y ] ), HIGHWAY_FACE_FLAGS.END );

		}

	}

}

function sectionStep( writer, before, after, frame ) {

	const rise = after.reduce( ( sum, p, i ) => sum + p[ 1 ] - before[ i ][ 1 ], 0 );
	if ( Math.abs( rise ) < EPS ) return;
	const point = ( p ) => [ frame.x + frame.offset[ 0 ] * p[ 0 ], frame.y + p[ 1 ], frame.z + frame.offset[ 1 ] * p[ 0 ] ];
	const expected = [ frame.tangent[ 0 ] * Math.sign( rise ), 0, frame.tangent[ 1 ] * Math.sign( rise ) ];
	for ( let i = 0; i < before.length; i ++ ) {

		const j = ( i + 1 ) % before.length;
		writer.quad( 'soffit-concrete', [ point( before[ i ] ), point( before[ j ] ), point( after[ i ] ), point( after[ j ] ) ],
			[ before[ i ], before[ j ], after[ i ], after[ j ] ].map( ( p ) => [ p[ 0 ] * Math.hypot( ...frame.offset ), p[ 1 ] ] ), expected,
			Array.from( { length: 4 }, () => [ frame.distance, frame.y ] ), HIGHWAY_FACE_FLAGS.END );

	}

}

function loft( writer, slot, levels, { cornerBevels = false } = {} ) {

	for ( let k = 1; k < levels.length; k ++ ) {

		const a = levels[ k - 1 ], b = levels[ k ];
		const runA = profileRun( a.ring ), runB = profileRun( b.ring );
		for ( let i = 0; i < a.ring.length; i ++ ) {

			const j = ( i + 1 ) % a.ring.length;
			const p = a.ring[ i ], q = a.ring[ j ], r = b.ring[ i ], s = b.ring[ j ];
			writer.quad( slot, [ [ p[ 0 ], a.y, p[ 1 ] ], [ q[ 0 ], a.y, q[ 1 ] ],
				[ r[ 0 ], b.y, r[ 1 ] ], [ s[ 0 ], b.y, s[ 1 ] ] ],
			[ [ runA[ i ], a.y ], [ runA[ i + 1 ], a.y ], [ runB[ i ], b.y ], [ runB[ i + 1 ], b.y ] ],
			[ q[ 1 ] - p[ 1 ], 0, p[ 0 ] - q[ 0 ] ], null,
			( cornerBevels && i % 2 === 0 ) || ( b.y - a.y < 0.08 && Math.hypot( ...subtract( p, r ) ) > EPS )
				? HIGHWAY_FACE_FLAGS.CHAMFER : 0 );

		}

	}
	for ( const level of [ levels[ 0 ], levels.at( - 1 ) ] ) {

		const triangles = ShapeUtils.triangulateShape( level.ring.map( ( p ) => new Vector2( ...p ) ), [] );
		for ( const tri of triangles ) writer.triangle( slot,
			tri.map( ( i ) => [ level.ring[ i ][ 0 ], level.y, level.ring[ i ][ 1 ] ] ),
			tri.map( ( i ) => [ ...level.ring[ i ] ] ), [ 0, level === levels[ 0 ] ? - 1 : 1, 0 ], null,
			level === levels[ 0 ] ? 0 : HIGHWAY_FACE_FLAGS.CAP );

	}

}

function sectionFaceFlags( profile, edge ) {
	const p = profile[ edge ], q = profile[ ( edge + 1 ) % profile.length ];
	const highest = Math.max( ...profile.map( point => point[ 1 ] ) );
	let flags = Math.abs( p[ 1 ] - highest ) < EPS && Math.abs( q[ 1 ] - highest ) < EPS ? HIGHWAY_FACE_FLAGS.CAP : 0;
	const dx = Math.abs( p[ 0 ] - q[ 0 ] ), dy = Math.abs( p[ 1 ] - q[ 1 ] );
	if ( dx > EPS && dy > EPS && Math.hypot( dx, dy ) < 0.16 ) flags |= HIGHWAY_FACE_FLAGS.CHAMFER;
	return flags;
}

class MeshWriter {

	constructor( route ) {
		this.slots = new Map();
		this.route = route;
		this.owner = - 1;
		this.supports = [];
		this.sourceCoordinates = new Map();
	}

	sourceAt( point ) {
		const key = point[ 0 ] + ',' + point[ 2 ];
		let coordinates = this.sourceCoordinates.get( key );
		if ( ! coordinates ) {
			const station = this.route.stationOf( [ point[ 0 ], point[ 2 ] ] );
			coordinates = [ station, this.route.at( station ).y ];
			this.sourceCoordinates.set( key, coordinates );
		}
		return coordinates;
	}

	quad( slot, points, uvs, expected, coordinates = null, flags = 0 ) {

		this.triangle( slot, [ points[ 0 ], points[ 1 ], points[ 2 ] ], [ uvs[ 0 ], uvs[ 1 ], uvs[ 2 ] ], expected, coordinates && [ coordinates[ 0 ], coordinates[ 1 ], coordinates[ 2 ] ], flags );
		this.triangle( slot, [ points[ 1 ], points[ 3 ], points[ 2 ] ], [ uvs[ 1 ], uvs[ 3 ], uvs[ 2 ] ], expected, coordinates && [ coordinates[ 1 ], coordinates[ 3 ], coordinates[ 2 ] ], flags );

	}

	triangle( slot, points, uv, expected, sourceCoordinates = null, flags = 0 ) {

		let normal = cross( subtract( points[ 1 ], points[ 0 ] ), subtract( points[ 2 ], points[ 0 ] ) );
		const length = Math.hypot( ...normal );
		if ( length < 1e-10 ) return;
		const coordinates = sourceCoordinates ?? points.map( point => this.sourceAt( point ) );
		if ( dot( normal, expected ) < 0 ) {

			[ points[ 1 ], points[ 2 ] ] = [ points[ 2 ], points[ 1 ] ];
			[ uv[ 1 ], uv[ 2 ] ] = [ uv[ 2 ], uv[ 1 ] ];
			[ coordinates[ 1 ], coordinates[ 2 ] ] = [ coordinates[ 2 ], coordinates[ 1 ] ];
			normal = normal.map( ( value ) => - value );

		}
		normal = normal.map( ( value ) => value / length );
		let target = this.slots.get( slot );
		if ( ! target ) this.slots.set( slot, target = { position: [], normal: [], uv: [], _highway_source: [], _highway_face: [], ownerRanges: [] } );
		const start = target.position.length / 3, previous = target.ownerRanges.at( - 1 );
		if ( previous && previous.support === this.owner && previous.start + previous.count === start ) previous.count += 3;
		else target.ownerRanges.push( { start, count: 3, support: this.owner } );
		for ( let i = 0; i < 3; i ++ ) {

			target.position.push( ...points[ i ] );
			target.normal.push( ...normal );
			target.uv.push( ...uv[ i ] );
			target._highway_source.push( ...coordinates[ i ] );
			target._highway_face.push( flags );

		}

	}

	finish() {

		const parts = [], bounds = new Box3();
		let triangles = 0, bytes = 0, ownershipBytes = 0, ownerRanges = 0;
		for ( const slot of HIGHWAY_MATERIAL_SLOTS ) {

			const stream = this.slots.get( slot );
			if ( ! stream?.position.length ) continue;
			const geometry = new BufferGeometry();
			for ( const [ name, size ] of Object.entries( { position: 3, normal: 3, uv: 2, _highway_source: 2, _highway_face: 1 } ) ) {

				const attribute = name === '_highway_face' ? new Uint8BufferAttribute( stream[ name ], size, false )
					: new Float32BufferAttribute( stream[ name ], size );
				geometry.setAttribute( name, attribute );
				bytes += attribute.array.byteLength;
				if ( name.startsWith( '_highway_' ) ) ownershipBytes += attribute.array.byteLength;

			}
			geometry.computeBoundingBox();
			geometry.computeBoundingSphere();
			geometry.name = 'highway-content:' + slot;
			geometry.userData.highwayContent = {
				version: HIGHWAY_CONTENT_VERSION, slot, uvUnits: 'meters', collision: 'consumer-owned',
				ownership: {
					version: HIGHWAY_OWNERSHIP_VERSION, pathLength: this.route.length, closedRoute: this.route.closed, sourceAttribute: '_highway_source', faceAttribute: '_highway_face',
					ownerRanges: stream.ownerRanges.map( range => ( { ...range } ) ),
					supportTable: this.supports.map( support => ( { ...support } ) )
				}
			};
			ownerRanges += stream.ownerRanges.length;
			bounds.union( geometry.boundingBox );
			triangles += geometry.getAttribute( 'position' ).count / 3;
			parts.push( { slot, geometry } );

		}
		return { parts, bounds, statistics: { triangles, vertexBytes: bytes, ownershipBytes, ownerRanges, materialParts: parts.length } };

	}

}

function routeOf( structure ) {

	if ( ! structure || ! Array.isArray( structure.path ) || structure.path.length < 2
		|| ! structure.path.every( point2 ) ) fail( 'path must contain finite [x,z] points' );
	if ( ! Number.isFinite( structure.width ) || structure.width < 2 ) fail( 'width must be at least 2 m' );
	if ( ! Number.isFinite( structure.deckThickness ) || structure.deckThickness <= 0 ) fail( 'deckThickness must be positive' );
	if ( ! Array.isArray( structure.supports ) ) fail( 'supports must be an array' );
	const path = structure.path, run = [ 0 ];
	for ( let i = 1; i < path.length; i ++ ) {

		const length = Math.hypot( ...subtract( path[ i ], path[ i - 1 ] ) );
		if ( length < EPS ) fail( 'path has a zero-length segment' );
		run.push( run.at( - 1 ) + length );

	}
	const length = run.at( - 1 ), profile = structure.elevationProfile;
	if ( ! Array.isArray( profile ) || profile.length < 2 ) fail( 'elevationProfile is incomplete' );
	profile.forEach( ( p, i ) => {

		if ( ! Number.isFinite( p.distance ) || ! Number.isFinite( p.level )
			|| ( i && p.distance <= profile[ i - 1 ].distance ) ) fail( 'elevationProfile must be finite and increasing' );

	} );
	if ( Math.abs( profile[ 0 ].distance ) > EPS || Math.abs( profile.at( - 1 ).distance - length ) > 1e-5 ) fail( 'elevationProfile must cover complete path' );
	const metricRun = [ 0 ];
	for ( let i = 1; i < profile.length; i ++ ) metricRun.push( metricRun.at( - 1 )
		+ Math.hypot( profile[ i ].distance - profile[ i - 1 ].distance, profile[ i ].level - profile[ i - 1 ].level ) );
	const closed = Math.hypot( ...subtract( path[ 0 ], path.at( - 1 ) ) ) < EPS;
	const knots = unique( [ ...run, ...profile.map( ( p ) => p.distance ) ] );
	const offsets = path.map( ( p, i ) => {
		const before = i ? normalize2( subtract( p, path[ i - 1 ] ) )
			: closed ? normalize2( subtract( path.at( - 1 ), path.at( - 2 ) ) ) : normalize2( subtract( path[ 1 ], p ) );
		const after = i < path.length - 1 ? normalize2( subtract( path[ i + 1 ], p ) )
			: closed ? normalize2( subtract( path[ 1 ], path[ 0 ] ) ) : before;
		const na = [ - before[ 1 ], before[ 0 ] ], nb = [ - after[ 1 ], after[ 0 ] ];
		const sum = [ na[ 0 ] + nb[ 0 ], na[ 1 ] + nb[ 1 ] ];
		const axis = Math.hypot( ...sum ) > EPS ? normalize2( sum ) : nb;
		const cosine = Math.max( 1 / MITRE_LIMIT, dot( axis, nb ) );
		return axis.map( ( v ) => v / cosine );
	} );
	const at = ( distance ) => {
		const d = Math.max( 0, Math.min( length, distance ) );
		let segment = 1;
		while ( segment < run.length - 1 && run[ segment ] < d - EPS ) segment ++;
		const pa = path[ segment - 1 ], pb = path[ segment ];
		const t = ( d - run[ segment - 1 ] ) / ( run[ segment ] - run[ segment - 1 ] );
		let tangent = normalize2( subtract( pb, pa ) );
		if ( Math.abs( d - run[ segment ] ) < EPS && segment < path.length - 1 ) tangent = normalize2( subtract( path[ segment + 1 ], pb ) );
		if ( closed && ( d < EPS || length - d < EPS ) ) tangent = normalize2( subtract( path[ 1 ], path[ 0 ] ) );
		// Interpolate the two authored miter sections. Replacing a miter with a
		// perpendicular frame at every nearby joint would fold the inner edge.
		const offset = offsets[ segment - 1 ].map( ( value, axis ) => value + ( offsets[ segment ][ axis ] - value ) * t );
		let k = 1;
		while ( k < profile.length - 1 && profile[ k ].distance < d ) k ++;
		const a = profile[ k - 1 ], b = profile[ k ];
		const f = ( d - a.distance ) / ( b.distance - a.distance );
		return {
			distance: d, x: pa[ 0 ] + ( pb[ 0 ] - pa[ 0 ] ) * t,
			y: a.level + ( b.level - a.level ) * f, z: pa[ 1 ] + ( pb[ 1 ] - pa[ 1 ] ) * t,
			offset, tangent, surfaceDistance: ( lateral ) => offsetMetric( d, lateral ),
			metric: metricRun[ k - 1 ] + ( metricRun[ k ] - metricRun[ k - 1 ] ) * f
		};

	};
	const metricCache = new Map();
	const offsetMetric = ( distance, lateral ) => {
		let cached = metricCache.get( lateral );
		if ( ! cached ) {
			const points = knots.map( ( station ) => {
				const f = at( station );
				return [ f.x + f.offset[ 0 ] * lateral, f.y, f.z + f.offset[ 1 ] * lateral ];
			} );
			const run = [ 0 ];
			for ( let i = 1; i < points.length; i ++ ) run.push( run.at( - 1 ) + Math.hypot( ...subtract( points[ i ], points[ i - 1 ] ) ) );
			metricCache.set( lateral, cached = { points, run } );
		}
		let k = 1;
		while ( k < knots.length - 1 && knots[ k ] < distance ) k ++;
		const frame = at( distance );
		const point = [ frame.x + frame.offset[ 0 ] * lateral, frame.y, frame.z + frame.offset[ 1 ] * lateral ];
		return cached.run[ k - 1 ] + Math.hypot( ...subtract( point, cached.points[ k - 1 ] ) );
	};
	const stationOf = ( point ) => {
		let best = Infinity, station = 0;
		for ( let i = 1; i < path.length; i ++ ) {
			const delta = subtract( path[ i ], path[ i - 1 ] ), span = run[ i ] - run[ i - 1 ];
			const shift = subtract( offsets[ i ], offsets[ i - 1 ] );
			let t = Math.max( 0, Math.min( 1, dot( subtract( point, path[ i - 1 ] ), delta ) / ( span * span ) ) );
			let lateral = 0;
			// Invert the same interpolated section used by the mesh. A simple
			// perpendicular projection misplaces a bearing beside a bend.
			for ( let turn = 0; turn < 8; turn ++ ) {
				const side = offsets[ i - 1 ].map( ( v, axis ) => v + shift[ axis ] * t );
				const along = delta.map( ( v, axis ) => v + shift[ axis ] * lateral );
				const error = point.map( ( v, axis ) => v - path[ i - 1 ][ axis ] - delta[ axis ] * t - side[ axis ] * lateral );
				const determinant = along[ 0 ] * side[ 1 ] - along[ 1 ] * side[ 0 ];
				if ( Math.abs( determinant ) < EPS || Math.hypot( ...error ) < 1e-9 ) break;
				t += ( error[ 0 ] * side[ 1 ] - error[ 1 ] * side[ 0 ] ) / determinant;
				lateral += ( along[ 0 ] * error[ 1 ] - along[ 1 ] * error[ 0 ] ) / determinant;
			}
			t = Math.max( 0, Math.min( 1, t ) );
			const side = offsets[ i - 1 ].map( ( v, axis ) => v + shift[ axis ] * t );
			const center = path[ i - 1 ].map( ( v, axis ) => v + delta[ axis ] * t );
			lateral = Math.max( - structure.width / 2, Math.min( structure.width / 2,
				dot( subtract( point, center ), side ) / dot( side, side ) ) );
			const gap = Math.hypot( ...point.map( ( v, axis ) => v - center[ axis ] - side[ axis ] * lateral ) );
			if ( gap < best - 1e-9 ) { best = gap; station = run[ i - 1 ] + span * t; }
		}
		return station;
	};

	return { at, stationOf, length, knots, closed };

}

function cleanRing( ring ) {

	const result = ring.map( ( p ) => [ ...p ] );
	if ( result.length > 3 && Math.hypot( ...subtract( result[ 0 ], result.at( - 1 ) ) ) < EPS ) result.pop();
	if ( signedArea( result ) < 0 ) result.reverse();
	return result;

}

function chamferRing( ring, amount ) {

	const out = [];
	for ( let i = 0; i < ring.length; i ++ ) {

		const p = ring[ i ], previous = ring[ ( i + ring.length - 1 ) % ring.length ], next = ring[ ( i + 1 ) % ring.length ];
		for ( const q of [ previous, next ] ) {

			const delta = subtract( q, p ), length = Math.hypot( ...delta );
			const t = Math.min( amount / length, 0.12 );
			out.push( [ p[ 0 ] + delta[ 0 ] * t, p[ 1 ] + delta[ 1 ] * t ] );

		}

	}
	return out;

}

function scaleRing( ring, factor ) {

	const center = centerOf( ring );
	return ring.map( ( point ) => point.map( ( value, axis ) => center[ axis ] + ( value - center[ axis ] ) * factor ) );

}

function centerOf( ring ) {

	return [ 0, 1 ].map( ( axis ) => ring.reduce( ( sum, point ) => sum + point[ axis ], 0 ) / ring.length );

}

function sectionRun( profile, frame ) {
	const out = [ 0 ];
	for ( let i = 0; i < profile.length; i ++ ) {
		const p = profile[ i ], q = profile[ ( i + 1 ) % profile.length ];
		out.push( out.at( - 1 ) + Math.hypot( ( q[ 0 ] - p[ 0 ] ) * frame.offset[ 0 ],
			q[ 1 ] - p[ 1 ], ( q[ 0 ] - p[ 0 ] ) * frame.offset[ 1 ] ) );
	}
	return out;
}

function profileRun( ring ) {

	const result = [ 0 ];
	for ( let i = 0; i < ring.length; i ++ ) result.push( result.at( - 1 ) + Math.hypot( ...subtract( ring[ ( i + 1 ) % ring.length ], ring[ i ] ) ) );
	return result;

}

function signedArea( ring ) {

	return ring.reduce( ( sum, p, i ) => { const q = ring[ ( i + 1 ) % ring.length ]; return sum + p[ 0 ] * q[ 1 ] - q[ 0 ] * p[ 1 ]; }, 0 ) / 2;

}

function validateSupport( support, index ) {

	if ( ! Array.isArray( support?.footprint ) || support.footprint.length < 3 || ! support.footprint.every( point2 )
		|| Math.abs( signedArea( support.footprint ) ) < EPS ) fail( 'invalid support footprint at ' + index );
	if ( ! Number.isFinite( support.bottom ) || ! Number.isFinite( support.top ) || support.top <= support.bottom ) fail( 'invalid support levels at ' + index );
	if ( support.position !== undefined && ! point2( support.position ) ) fail( 'invalid support position at ' + index );
	const ring = cleanRing( support.footprint );
	if ( ring.some( ( p, i ) => Math.hypot( ...subtract( p, ring[ ( i + 1 ) % ring.length ] ) ) < EPS ) ) fail( 'support has a repeated adjacent point at ' + index );
	// Atlas publishes convex square reservations. Concave artist choices must
	// not silently gain geometry outside their footprint through scaling.
	let sign = 0;
	for ( let i = 0; i < ring.length; i ++ ) {

		const a = subtract( ring[ ( i + 1 ) % ring.length ], ring[ i ] );
		const b = subtract( ring[ ( i + 2 ) % ring.length ], ring[ ( i + 1 ) % ring.length ] );
		const turn = a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ];
		if ( Math.abs( turn ) > EPS && sign && Math.sign( turn ) !== sign ) fail( 'support footprint must be convex at ' + index );
		if ( Math.abs( turn ) > EPS ) sign = Math.sign( turn );

	}

}

function validateBarrier( spec, side ) {

	if ( ! Number.isFinite( spec.width ) || spec.width <= 0 || ! Number.isFinite( spec.height ) || spec.height <= 0 ) fail( 'invalid ' + side + ' barrier' );

}
function point2( point ) { return Array.isArray( point ) && point.length === 2 && point.every( Number.isFinite ); }
function unique( values ) { return [ ...values ].sort( ( a, b ) => a - b ).filter( ( x, i, sorted ) => ! i || x - sorted[ i - 1 ] > EPS ); }
function normalize2( v ) { const length = Math.hypot( ...v ); return v.map( ( x ) => x / length ); }
function subtract( a, b ) { return a.map( ( value, i ) => value - b[ i ] ); }
function cross( a, b ) { return [ a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ] ]; }
function dot( a, b ) { return a.reduce( ( total, x, i ) => total + x * b[ i ], 0 ); }
function fail( reason ) { const error = new Error( 'E_HIGHWAY_CONTENT: ' + reason ); error.code = 'E_HIGHWAY_CONTENT'; throw error; }
