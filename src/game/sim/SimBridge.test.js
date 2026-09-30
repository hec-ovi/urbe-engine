import { describe, expect, it } from 'vitest';
import { DEFAULT_TYPE_SET, FIXTURE_BLUEPRINT, FIXTURE_HOMES, FIXTURE_INTERIORS, FIXTURE_THEMED_TYPES } from '../../../../simulation/dist/index.js';
import { SimBridge } from './SimBridge.js';

const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );

/**
 * A named world comes with its own people: the naming box's typed set says
 * who lives and works in this city, and the population has to be made of
 * those types, not the library's generic ones.
 */
describe( 'SimBridge', () => {

	it( 'peoples the city with the typed set the world carries', () => {

		const themed = {
			...DEFAULT_TYPE_SET,
			types: DEFAULT_TYPE_SET.types.map( ( type ) =>
				type.type === 'shop_clerk' ? { ...type, type: 'dock_hawker', label: 'dock hawker' } : type )
		};

		const sim = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings, {}, themed );
		const types = Object.keys( sim.simulation.populationStats().typeCounts );

		expect( types ).toContain( 'dock_hawker' );
		expect( types ).not.toContain( 'shop_clerk' );

		const withoutSet = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings );

		expect( Object.keys( withoutSet.simulation.populationStats().typeCounts ) ).toContain( 'shop_clerk' );

	} );

	it( 'keeps an interior waiter in the vendor vocabulary', () => {

		const sim = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings, {}, FIXTURE_THEMED_TYPES );
		const waiter = sim.getNPCVendor( { parcelId: 'p_rest', role: 'waiter', timeMin: 12 * 60 } );
		const type = FIXTURE_THEMED_TYPES.types.find( ( candidate ) => candidate.type === waiter.type );

		expect( waiter.job.role ).toBe( 'waiter' );
		expect( type.category ).toBe( 'vendor' );
		expect( waiter.type ).not.toBe( 'harbour_crane_operator' );

	} );

	it( 'preserves closed simulation errors for continuity control', () => {

		const sim = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings );
		expect( errorCode( () => sim.interrupt( 'missing', 0 ) ) ).toBe( 'E_UNKNOWN_ID' );
		expect( errorCode( () => sim.continuityAt( 'missing', 0 ) ) ).toBe( 'E_UNKNOWN_ID' );

	} );

	it( 'restores the same instantiated identity through the public save boundary', () => {

		const first = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings );
		const vendor = first.getNPCVendor( { parcelId: 'p_cafe', timeMin: 9 * 60 } );
		const save = first.serialize();
		const restored = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings, {}, null, save );

		expect( restored.getNPC( vendor.npcId ) ).toMatchObject( {
			npcId: vendor.npcId,
			appearanceSeed: vendor.appearanceSeed,
			name: vendor.name,
			routine: vendor.routine
		} );
		expect( restored.serialize() ).toEqual( save );

	} );

	it( 'establishes a crowd person in the look their body is drawn in, and keeps it through restore', () => {

		const bridge = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings );
		const TIME = 9 * 60;
		const [ drawn, plain ] = bridge.crowd( TIME, { kind: 'city' }, { maxAgents: 2 } ).agents;
		const person = bridge.instantiate( drawn.crowdId, TIME, 777 );

		expect( person.appearanceSeed ).toBe( 777 );
		expect( bridge.instantiate( drawn.crowdId, TIME, 888 ) ).toBe( person );
		expect( bridge.instantiate( plain.crowdId, TIME ).appearanceSeed ).toBe( plain.appearanceSeed );
		expect( bridge.instantiate( 'c|edge|e0|0|99999', TIME, 5 ) ).toBeNull();

		const restored = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings, {}, null, bridge.serialize() );
		expect( restored.getNPC( person.npcId ).appearanceSeed ).toBe( 777 );

	} );


	it( 'houses the people it establishes in the numbered apartments a furnished building publishes, and keeps the cast\'s names to the cast', () => {

		// The fixture building as Interior publishes it: numbered entrances per floor, rooms by unit, anchors named per floor.
		const { homes, ...support } = FIXTURE_HOMES.p_r0;
		const npc = { ...support, anchors: support.anchors.map( ( anchor ) => ( { ...anchor, room: `floor:${anchor.floor}/${anchor.room}` } ) ) };
		const units = ( floor ) => homes.filter( ( home ) => home.floor === floor ).map( ( home ) => home.id.split( '/' )[ 1 ] );
		const interior = {
			building: { floors: [ 0, 1, 2 ].map( ( index ) => ( {
				index, layout: `l${index}`, elevation: index * 4.5,
				apartmentEntrances: units( index ).map( ( unit ) => ( { unit, number: homes.find( ( home ) => home.id === `floor:${index}/${unit}` ).number, position: [ 0, 0 ] } ) )
			} ) ) },
			layouts: Object.fromEntries( [ 0, 1, 2 ].map( ( index ) => [ `l${index}`, { floor: { rooms: units( index ).flatMap( ( unit ) =>
				[ 'living', 'bedroom', 'bath' ].map( ( room ) => ( { id: `${unit}-${room}`, unit } ) ) ) } } ] ) )
		};
		const housed = new Map( [ ...buildings, [ 'p_r0', { npc, interior } ] ] );
		const sim = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, housed, {}, null, null, { family: [ 'Moss' ], full: [ { given: 'Petra', family: 'Moss' } ] } );
		const worker = sim.getNPCVendor( { parcelId: 'p_cafe', timeMin: 540 } );
		expect( worker.home.parcelId ).toBe( 'p_r0' );
		expect( [ '101', '102', '201', '202' ] ).toContain( worker.home.apartment.number );
		expect( sim.behaviorAt( worker.npcId, 3 * 60 ).interior.at.anchorId ).toMatch( /-bed-[ab]$/ );
		expect( worker.name.family ).not.toBe( 'Moss' );

	} );
} );

function errorCode( run ) {

	try { run(); return null; }
	catch ( error ) { return error.code; }

}
