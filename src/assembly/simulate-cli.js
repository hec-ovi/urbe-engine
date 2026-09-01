/**
 * npm run simulate -- --time <minutes> [--district <id>]
 * Boots the world simulation over the real inputs: atlas sample blueprint,
 * connections networks, and the npc.json of every assembled building in out/
 * (simulation synthesizes roles for every other parcel). Prints population
 * stats, a crowd slice for the scope, three instantiated NPC lives, latency
 * measurements and a conservation check.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runConnections } from './connectionsRunner.js';
import { runCreateSimulation } from './simulationRunner.js';

const ATLAS_SAMPLE = new URL( '../../../atlas/samples/city-urbe.json', import.meta.url );
const OUT_DIR = fileURLToPath( new URL( '../../out/', import.meta.url ) );
const MIDDAY = 780; // Monday 13:00, minutes since epoch

function parseArgs( argv ) {

	const args = {};

	for ( let i = 0; i < argv.length; i += 2 ) {

		if ( argv[ i ] === '--time' ) args.time = parseInt( argv[ i + 1 ], 10 );
		else if ( argv[ i ] === '--district' ) args.district = argv[ i + 1 ];
		else return null;

	}

	return Number.isInteger( args.time ) ? args : null;

}

/** parcelId -> NpcSupport from every assembled building under out/. */
function loadInteriors() {

	const interiors = {};

	if ( ! existsSync( OUT_DIR ) ) return interiors;

	for ( const name of readdirSync( OUT_DIR ).sort() ) {

		const npcPath = join( OUT_DIR, name, 'interior', 'npc.json' );

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

	console.error( 'usage: npm run simulate -- --time <minutes> [--district <id>]' );
	process.exit( 2 );

}

const blueprint = JSON.parse( readFileSync( ATLAS_SAMPLE, 'utf8' ) );
const networks = ( await runConnections( blueprint, { seed: blueprint.meta.seed } ) ).networks;
const interiors = loadInteriors();
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

// three lives; agents only materialize on edge scopes, so walk the graph for a handle
let agent = slice.agents[ 0 ] ?? null;
let agentSlice = slice;

for ( const edge of networks.walk.edges ) {

	if ( agent ) break;

	agentSlice = simulation.crowd( args.time, { kind: 'edge', id: edge.id } );
	agent = agentSlice.agents[ 0 ] ?? null;

}

if ( ! agent ) {

	console.error( 'no crowd agents found on any walk edge at this time' );
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
const vendor = timed( 'getNPCVendor(coffee midday)', () =>
	simulation.getNPCVendor( { parcelId: coffeeShop.id, timeMin: MIDDAY } ) );
life( `coffee vendor at ${coffeeShop.id}, 13:00`, vendor );

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
