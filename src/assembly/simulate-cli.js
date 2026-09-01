/**
 * npm run simulate -- --time <minutes> [--district <id>] [--blueprint <path>] [--interiors <dir>]
 * Boots the world simulation over the real inputs: the atlas blueprint (the
 * committed urbe sample by default), connections networks, and the npc.json of
 * every assembled building under the interiors dir (out/ by default;
 * simulation synthesizes roles for every other parcel). Prints population
 * stats, a crowd slice for the scope, three instantiated NPC lives, latency
 * measurements and a conservation check.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { runConnections } from './connectionsRunner.js';
import { runCreateSimulation } from './simulationRunner.js';

const ATLAS_SAMPLE = fileURLToPath( new URL( '../../../atlas/samples/city-urbe.json', import.meta.url ) );
const OUT_DIR = fileURLToPath( new URL( '../../out/', import.meta.url ) );
const MIDDAY = 780; // Monday 13:00, minutes since epoch

function parseArgs( argv ) {

	const args = { blueprint: ATLAS_SAMPLE, interiors: OUT_DIR };

	for ( let i = 0; i < argv.length; i += 2 ) {

		if ( argv[ i ] === '--time' ) args.time = parseInt( argv[ i + 1 ], 10 );
		else if ( argv[ i ] === '--district' ) args.district = argv[ i + 1 ];
		else if ( argv[ i ] === '--blueprint' ) args.blueprint = argv[ i + 1 ];
		else if ( argv[ i ] === '--interiors' ) args.interiors = argv[ i + 1 ];
		else return null;

	}

	return Number.isInteger( args.time ) ? args : null;

}

/** parcelId -> NpcSupport from every assembled building under the dir. */
function loadInteriors( dir ) {

	const interiors = {};

	if ( ! existsSync( dir ) ) return interiors;

	for ( const name of readdirSync( dir ).sort() ) {

		const npcPath = join( dir, name, 'interior', 'npc.json' );

		if ( existsSync( npcPath ) ) interiors[ name ] = JSON.parse( readFileSync( npcPath, 'utf8' ) );

	}

	return interiors;

}

function timed( label, fn ) {

	const t0 = performance.now();
	const value = fn();
	const ms = ( performance.now() - t0 ).toFixed( 1 );
	console.log( `[${label}: ${ms} ms]` );

	return value;

}

const args = parseArgs( process.argv.slice( 2 ) );

if ( ! args ) {

	console.error( 'usage: npm run simulate -- --time <minutes> [--district <id>] [--blueprint <path>] [--interiors <dir>]' );
	process.exit( 2 );

}

const blueprint = JSON.parse( readFileSync( resolve( args.blueprint ), 'utf8' ) );
const networks = ( await runConnections( blueprint, { seed: blueprint.meta.seed } ) ).networks;
const interiors = loadInteriors( resolve( args.interiors ) );
console.log( `inputs: atlas ${blueprint.meta.version} seed ${blueprint.meta.seed}, networks, interiors for ${Object.keys( interiors ).length} parcels` );

const sim = timed( 'createSimulation', () =>
	runCreateSimulation( { seed: blueprint.meta.seed, blueprint, networks, interiors } ) );
const simulation = await sim;

// population stats
const stats = simulation.populationStats();
console.log( '\npopulationStats:' );
console.log( `  population ${stats.population}, households ${stats.households}, employed ${stats.employed}, unemployed ${stats.unemployed}` );
console.log( `  types: ${Object.entries( stats.typeCounts ).map( ( [ t, n ] ) => `${t}=${n}` ).join( ' ' )}` );
console.log( `  districts: ${stats.perDistrict.length}` );

if ( args.district ) {

	const district = stats.perDistrict.find( ( d ) => d.districtId === args.district );
	console.log( `  ${args.district}: ${JSON.stringify( district )}` );

}

// crowd latency at city scope
for ( const [ label, t ] of [ [ '08:00', 480 ], [ '13:00', 780 ], [ '03:00', 180 ] ] ) {

	timed( `crowd city ${label}`, () => simulation.crowd( t, { kind: 'city' } ) );

}

// the scoped slice
const scope = args.district ? { kind: 'district', id: args.district } : { kind: 'city' };
const slice = simulation.crowd( args.time, scope );
console.log( `\ncrowd(${args.time}, ${JSON.stringify( scope )}): ${slice.groups.length} groups, ${slice.agents.length} agents` );

for ( const group of slice.groups.slice( 0, 8 ) ) {

	console.log( `  ${group.type} ${group.activity}: ${group.count}` );

}

for ( const agent of slice.agents.slice( 0, 3 ) ) {

	console.log( `  agent ${agent.crowdId} ${agent.type} ${agent.activity} @ ${agent.place.kind}:${agent.place.id}` );

}

// three lives, the first from the slice's sampled agents
const agent = slice.agents[ 0 ];

if ( ! agent ) {

	console.error( 'no crowd agents in this slice; pick another time or scope' );
	process.exit( 1 );

}

console.log( `  handle agent: ${agent.crowdId} ${agent.type} ${agent.activity} @ ${agent.place.kind}:${agent.place.id}` );

const life = ( label, npc ) => {

	console.log( `\n=== ${label}: ${npc.name.given} ${npc.name.family} (${npc.npcId}) ===` );
	console.log( JSON.stringify( npc, null, 1 ) );

};

const fromCrowd = timed( 'instantiate(crowd handle)', () =>
	simulation.instantiate( { crowdId: agent.crowdId, timeMin: args.time } ) );
life( 'crowd handle', fromCrowd );

const coffeeShop = blueprint.parcels.find( ( p ) => p.type === 'coffee_shop' );

try {

	const vendor = timed( 'getNPCVendor(coffee midday)', () =>
		simulation.getNPCVendor( { parcelId: coffeeShop.id, timeMin: MIDDAY } ) );
	life( `coffee vendor at ${coffeeShop.id}, 13:00`, vendor );

} catch ( error ) {

	console.log( `\nvendor query failed at ${coffeeShop.id}: ${error.code}: ${error.message}` );

}

const commonType = Object.entries( stats.typeCounts ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ][ 0 ];
const reserved = timed( 'reserveNPC', () =>
	simulation.reserveNPC( { name: { given: 'Vesna', family: 'Okonkwo' }, type: commonType } ) );
life( `reserved ${commonType}`, reserved );

// conservation: the same slice after instantiations, twice
const again = simulation.crowd( args.time, scope );
const thrice = simulation.crowd( args.time, scope );
const stable = JSON.stringify( again ) === JSON.stringify( thrice );
const preserved = JSON.stringify( slice ) === JSON.stringify( again );
const statsAfter = simulation.populationStats();
const statsStable = JSON.stringify( stats ) === JSON.stringify( statsAfter );
console.log( `\nconservation: repeat slice identical ${stable}, pre-instantiation slice preserved ${preserved}, populationStats unchanged ${statsStable}` );
