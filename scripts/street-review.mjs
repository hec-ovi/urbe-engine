/** A street material review world: a small real city whose streets carry
 * every finish the street materials bind, and fixed spots to look at each.
 *
 * Plan the city (an Atlas blueprint with industrial, poor, mid, rich and
 * high_rich districts, a highway, parking bays and avenue medians, so its
 * streets come in every kind and finish), assemble it with a few poor and
 * rich buildings, then write the review spots:
 *
 *   node --import tsx scripts/street-review.mjs plan <blueprint.json>
 *   npm run assemble-city -- --blueprint <blueprint.json> --out out/reviews/<name> --interiors 0 --parcel <ids the plan printed>
 *   node --import tsx scripts/street-review.mjs shots <world under out/> <shots.json>
 *
 * The shots file is play-probe's look scenario input: one entry per finish,
 * `{ name, at, target, wait, read }`, `at` the feet on walkable ground in
 * world metres, `target` the point of the finish the crosshair aims at.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const engineRoot = fileURLToPath( new URL( '..', import.meta.url ) );
const outDir = join( engineRoot, 'out' );
const [ command, ...args ] = process.argv.slice( 2 );

/** What the review city must hold so its streets carry every kind and finish. */
const NEEDED = Object.freeze( {
	tiers: [ 'poor', 'mid', 'rich', 'high_rich' ],
	kinds: [ 'industrial' ],
	styles: [ 'luxury', 'ordinary', 'industrial' ],
	finishes: [ 'luxury-blue', 'luxury-red', 'industrial-yellow', 'ordinary' ]
} );
const SIZE = 900;

if ( command === 'plan' && args.length === 1 ) await plan( resolve( args[ 0 ] ) );
else if ( command === 'shots' && args.length === 2 ) await shots( args[ 0 ], resolve( args[ 1 ] ) );
else throw new Error( 'Usage: street-review.mjs plan <blueprint.json> | shots <world under out/> <shots.json>' );

/** The first seed of the review series whose city holds everything NEEDED, written whole, with the parcels to build. */
async function plan( file ) {

	const { generateCity } = await import( '../../atlas/src/index.ts' );
	for ( let attempt = 1; attempt <= 40; attempt ++ ) {

		const seed = `street-review-${attempt}`;
		const city = generateCity( { seed, size: { width: SIZE, depth: SIZE }, districtCount: [ 5, 6 ],
			tierWeights: { poor: 1, mid: 1, rich: 1, high_rich: 1 } } );
		const missing = lacking( city );
		if ( missing.length ) {

			console.log( `${seed}: lacks ${missing.join( ', ' )}` );
			continue;

		}
		await writeFile( file, JSON.stringify( city ) );
		const facades = facadeParcels( city );
		console.log( JSON.stringify( { seed, file, districts: city.districts.map( ( d ) => `${d.id} ${d.kind} ${d.tier}` ), facades }, null, 2 ) );
		console.log( `--parcel ${facades.map( ( entry ) => entry.parcelId ).join( ',' )}` );
		return;

	}
	throw new Error( 'No seed of the review series holds every street finish' );

}

function lacking( city ) {

	const missing = [];
	const tiers = new Set( city.districts.map( ( d ) => d.tier ) ), kinds = new Set( city.districts.map( ( d ) => d.kind ) );
	for ( const tier of NEEDED.tiers ) if ( ! tiers.has( tier ) ) missing.push( `a ${tier} district` );
	for ( const kind of NEEDED.kinds ) if ( ! kinds.has( kind ) ) missing.push( `an ${kind} district` );
	const styles = new Set( city.streets.edges.filter( ( e ) => e.class !== 'highway' ).map( ( e ) => e.districtStyle ) );
	for ( const style of NEEDED.styles ) if ( ! styles.has( style ) ) missing.push( `${style} streets` );
	const reservations = city.streets.construction?.reservations;
	const finishes = new Set( ( reservations?.owners ?? [] ).filter( ( o ) => o.kind === 'block' ).map( ( o ) => o.finish ) );
	for ( const finish of NEEDED.finishes ) if ( ! finishes.has( finish ) ) missing.push( `${finish} blocks` );
	if ( ! city.streets.edges.some( ( e ) => e.class === 'highway' ) ) missing.push( 'a highway' );
	if ( ! ( reservations?.parking ?? [] ).length ) missing.push( 'parking bays' );
	if ( ! ( city.streets.construction?.medians ?? [] ).length ) missing.push( 'avenue medians' );
	return missing;

}

/** Three poor buildings, homes among them, and two rich ones, each in its own district where it can, the closest to their district's middle. */
function facadeParcels( city ) {

	const picked = [];
	for ( const tiers of [ [ 'poor' ], [ 'poor' ], [ 'poor' ], [ 'rich', 'high_rich' ], [ 'rich', 'high_rich' ] ] ) {

		const used = new Set( picked.map( ( entry ) => entry.districtId ) );
		// The third poor building is a home, so the poor facades include housing and not only shops and works.
		const home = tiers[ 0 ] === 'poor' && picked.length === 2;
		const candidates = city.parcels.filter( ( p ) => tiers.includes( p.tier ) && p.envelope && p.footprint && ! p.landmark
			&& ( ! home || p.type === 'residential' ) && ! picked.some( ( entry ) => entry.parcelId === p.id ) );
		const scored = candidates.map( ( p ) => {

			const district = city.districts.find( ( d ) => d.id === districtOf( city, p ) );
			const [ cx, cz ] = middle( p.footprint ), [ dx, dz ] = middle( district.boundary );
			return { p, district, score: ( used.has( district.id ) ? 1e6 : 0 ) + Math.hypot( cx - dx, cz - dz ) };

		} ).sort( ( a, b ) => a.score - b.score || a.p.id.localeCompare( b.p.id, undefined, { numeric: true } ) );
		if ( ! scored.length ) continue;
		const { p, district } = scored[ 0 ];
		picked.push( { parcelId: p.id, type: p.type, tier: p.tier, districtId: district.id, at: middle( p.footprint ) } );

	}
	return picked;

}

function districtOf( city, parcel ) {

	const block = city.blocks.find( ( b ) => b.parcelIds.includes( parcel.id ) );
	return block?.districtId ?? city.districts[ 0 ].id;

}

/**
 * One spot per street finish the world's streets carry: the placement of a
 * piece drawn with that surface nearest the city's middle, the point of it to
 * aim at, and a walkable spot a few metres off to stand on, on the sidewalk
 * beside a road or on the walk itself. Facades and the highway deck come from
 * the buildings and the plan.
 */
async function shots( world, file ) {

	const worldDir = resolve( outDir, world );
	if ( relative( outDir, worldDir ).startsWith( '..' ) ) throw new Error( 'The world must be under out/' );
	const manifest = JSON.parse( await readFile( join( worldDir, 'manifest.json' ), 'utf8' ) );
	const city = JSON.parse( await readFile( join( worldDir, 'blueprint.json' ), 'utf8' ) );
	const kit = JSON.parse( await readFile( join( outDir, 'shared', manifest.streets.sharedKit, 'kit.json' ), 'utf8' ) );
	const { placements } = JSON.parse( await readFile( join( worldDir, 'streets', 'placements.json' ), 'utf8' ) );
	const pieces = new Map( kit.pieces.map( ( piece ) => [ piece.id, piece ] ) );
	const centre = [ ( city.meta.bounds.min[ 0 ] + city.meta.bounds.max[ 0 ] ) / 2, ( city.meta.bounds.min[ 1 ] + city.meta.bounds.max[ 1 ] ) / 2 ];
	const nearest = ( test ) => placements.filter( ( p ) => test( p, pieces.get( p.piece ) ) )
		.sort( ( a, b ) => Math.hypot( a.position[ 0 ] - centre[ 0 ], a.position[ 2 ] - centre[ 1 ] ) - Math.hypot( b.position[ 0 ] - centre[ 0 ], b.position[ 2 ] - centre[ 1 ] ) )[ 0 ] ?? null;
	const local = ( p, [ x, z ], y = 0 ) => {

		const s = p.scale ?? [ 1, 1, 1 ], c = Math.cos( p.rotationY ), n = Math.sin( p.rotationY );
		const lx = x * s[ 0 ], lz = z * s[ 2 ];
		return [ round( p.position[ 0 ] + lx * c + lz * n ), round( p.position[ 1 ] + y ), round( p.position[ 2 ] - lx * n + lz * c ) ];

	};
	const list = [];
	// Each spot reads back where the player's feet stand, so a report shows they stood on the walk the spot names.
	const add = ( name, finish, at, target, read = 'urbe.automation.footing()' ) => list.push( { name, finish, at, target, wait: 5, ...( read ? { read } : {} ) } );
	const has = ( surface ) => ( p, piece ) => piece?.surfaces.includes( surface );

	// Sidewalk finishes: an 8 m kerb walk in each block finish, looked at along the walk from its start.
	for ( const [ name, finish, surface ] of [ [ 'grey-slabs', 'luxury-blue', 'district-panel-blue' ], [ 'red-slabs', 'luxury-red', 'district-panel-red' ],
		[ 'pale-broom-concrete', 'ordinary', 'ordinary' ], [ 'yellow-industrial-kerb', 'industrial-yellow', 'district-curb-yellow' ] ] ) {

		const p = nearest( ( q, piece ) => q.piece === `kerb/${finish}/walk` && piece?.surfaces.includes( surface ) );
		if ( p ) add( name, surface, local( p, [ 0.5, 3.2 ], 0.2 ), local( p, [ 5, 2.6 ], 0.2 ) );

	}
	// Carriageways: worn asphalt on an ordinary road core and grey hex on a luxury one, seen from the walk beside them.
	for ( const [ name, zone, surface ] of [ [ 'used-asphalt', 'ordinary', 'asphalt' ], [ 'grey-hex-road', 'luxury', 'district-hex' ] ] ) {

		const p = nearest( ( q, piece ) => piece?.variant === 'core' && piece.zone === zone && piece.surfaces.includes( surface ) );
		if ( p ) {

			// Aimed at the middle of the near lanes, clear of any median island.
			const half = profileWidth( kit, pieces.get( p.piece ) ) / 2;
			add( name, surface, local( p, [ 2, half + 3 ], 0.2 ), local( p, [ 5, half / 2 ] ) );

		}

	}
	// Junction hexes: grey at a luxury junction, orange at an industrial one, aimed at the centre from a corner.
	for ( const [ name, surface ] of [ [ 'grey-hex-junction', 'district-junction-blue' ], [ 'orange-hex-junction', 'district-junction-yellow' ] ] ) {

		const p = nearest( has( surface ) );
		if ( p ) add( name, surface, cornerOf( p, pieces.get( p.piece ), local ), local( p, [ 0, 0 ] ) );

	}
	// The court under the highway deck, seen from its kerb, and the deck above it.
	const court = nearest( ( q, piece ) => piece?.variant === 'under' );
	if ( court ) {

		const half = profileWidth( kit, pieces.get( court.piece ) ) / 2;
		add( 'orange-hex-court-under-highway', 'hex-orange', local( court, [ 2, half + 2.5 ], 0.2 ), local( court, [ 6, 0 ] ) );
		add( 'highway-deck-from-below', 'highway', local( court, [ -2, half + 2.5 ], 0.2 ), local( court, [ 4, 0 ], 7.5 ) );

	}
	// Drains: the district inlet's flush grate and its slotted tread cover, from the walk beside them.
	const drain = nearest( ( q ) => q.piece === 'overlay/drain/0.7m' );
	if ( drain ) {

		add( 'drain-grate', 'drainGrate', local( drain, [ -2.5, 3.2 ], 0.2 ), local( drain, [ 0, 0.25 ] ) );
		add( 'drain-cover', 'drainCover', local( drain, [ 2.5, 3.6 ], 0.2 ), local( drain, [ 0, 1.7 ], 0.2 ) );

	}
	// A kerb access cassette: its perforated mesh in a steel frame, from the walk beside it.
	const access = nearest( ( q ) => q.piece.startsWith( 'prop/access/' ) );
	if ( access ) add( 'crossing-mesh-and-frame', 'perforated', local( access, [ 3, 3.6 ], 0.2 ), local( access, [ 6, 0.3 ], 0.1 ) );
	// Paint: a zebra crossing's stripe tiles and a lane line, from the kerb.
	const stripe = nearest( ( q ) => q.piece.startsWith( 'overlay/stripe/' ) );
	if ( stripe ) add( 'crossing-stripes', 'whitePaint', local( stripe, [ 1.35, -6 ], 0.2 ), local( stripe, [ 1.35, 0.25 ] ) );
	const parking = nearest( ( q ) => q.piece.endsWith( '/parking-slot' ) );
	if ( parking ) add( 'parking-bay', 'parking slot', local( parking, [ 3, 4 ], 0.2 ), local( parking, [ 3, 1 ] ) );
	// Facades: each built poor and rich building, its street front aimed at from the far sidewalk of its street.
	for ( const parcel of city.parcels.filter( ( q ) => manifest.sources?.[ q.id ] && manifest.sources[ q.id ] !== 'empty' ) ) {

		if ( ! [ 'poor', 'rich', 'high_rich' ].includes( parcel.tier ) || ! parcel.footprint ) continue;
		const edge = city.streets.edges.find( ( e ) => e.id === parcel.access?.edgeId );
		if ( ! edge ) continue;
		const access = parcel.access.point, road = nearestOnPath( edge.path, access );
		// The footprint side nearest the street, aimed at its middle a storey and a half up.
		const sides = parcel.footprint.map( ( a, i ) => { const b = parcel.footprint[ ( i + 1 ) % parcel.footprint.length ]; return [ ( a[ 0 ] + b[ 0 ] ) / 2, ( a[ 1 ] + b[ 1 ] ) / 2 ]; } );
		const front = sides.sort( ( a, b ) => Math.hypot( a[ 0 ] - road[ 0 ], a[ 1 ] - road[ 1 ] ) - Math.hypot( b[ 0 ] - road[ 0 ], b[ 1 ] - road[ 1 ] ) )[ 0 ];
		const out = [ road[ 0 ] - front[ 0 ], road[ 1 ] - front[ 1 ] ], length = Math.hypot( ...out ) || 1, across = edge.width / 2 + 2.8;
		const stand = [ road[ 0 ] + out[ 0 ] / length * across, road[ 1 ] + out[ 1 ] / length * across ];
		add( `${parcel.tier === 'poor' ? 'poor' : 'rich'}-facade-${parcel.id}`, `${parcel.type} ${parcel.tier}`,
			[ round( stand[ 0 ] ), 0.2, round( stand[ 1 ] ) ], [ round( front[ 0 ] ), 6, round( front[ 1 ] ) ] );

	}
	await writeFile( file, `${JSON.stringify( list, null, 2 )}\n` );
	console.log( `${list.length} review spots in ${file}: ${list.map( ( entry ) => entry.name ).join( ', ' )}` );

}

/** A corner of a junction centre piece, off its carriageway on the walk. */
function cornerOf( p, piece, local ) {

	const xs = piece.footprint.flat().map( ( q ) => q[ 0 ] ), zs = piece.footprint.flat().map( ( q ) => q[ 1 ] );
	return local( p, [ Math.max( ...xs ) + 2.5, Math.max( ...zs ) + 2.5 ], 0.2 );

}

/** The point of a polyline nearest `point`. */
function nearestOnPath( path, point ) {

	let best = path[ 0 ], distance = Infinity;
	for ( let i = 1; i < path.length; i ++ ) {

		const [ a, b ] = [ path[ i - 1 ], path[ i ] ], d = [ b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ], square = d[ 0 ] ** 2 + d[ 1 ] ** 2 || 1;
		const t = Math.max( 0, Math.min( 1, ( ( point[ 0 ] - a[ 0 ] ) * d[ 0 ] + ( point[ 1 ] - a[ 1 ] ) * d[ 1 ] ) / square ) );
		const q = [ a[ 0 ] + d[ 0 ] * t, a[ 1 ] + d[ 1 ] * t ], away = Math.hypot( q[ 0 ] - point[ 0 ], q[ 1 ] - point[ 1 ] );
		if ( away < distance ) { best = q; distance = away; }

	}
	return best;

}

function profileWidth( kit, piece ) {

	return kit.profiles.find( ( profile ) => profile.id === piece?.profileId )?.width ?? 7;

}

function middle( ring ) {

	return [ 0, 1 ].map( ( axis ) => ring.reduce( ( sum, point ) => sum + point[ axis ], 0 ) / ring.length );

}

function round( value ) {

	return Math.round( value * 100 ) / 100;

}
