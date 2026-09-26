import { describe, expect, it } from 'vitest';
import { evaluate, unknownReferences } from './SceneConditions.js';

const definition = {
	steps: [ { stepId: 'arrive' }, { stepId: 'kill' }, { stepId: 'report' } ],
	flags: [ 'alarm' ],
	roles: [ { roleId: 'victim' }, { roleId: 'giver' } ]
};

function context( state = {}, dead = [] ) {

	return {
		state: { activeStepIds: [ 'arrive' ], completedStepIds: [], flags: [], ...state },
		cast: { victim: 'npc-v', giver: 'npc-g' },
		sim: { getNPC: ( npcId ) => ( { npcId, flags: { dead: dead.includes( npcId ) } } ) }
	};

}

describe( 'scene conditions', () => {

	it( 'reads steps, flags, the cast and the questline\'s start and end', () => {

		const fresh = context();
		expect( evaluate( { kind: 'stepActive', stepId: 'arrive' }, fresh ) ).toBe( true );
		expect( evaluate( { kind: 'stepDone', stepId: 'arrive' }, fresh ) ).toBe( false );
		expect( evaluate( { kind: 'flagSet', flag: 'alarm' }, fresh ) ).toBe( false );
		expect( evaluate( { kind: 'flagNotSet', flag: 'alarm' }, fresh ) ).toBe( true );
		expect( evaluate( { kind: 'roleDead', roleId: 'victim' }, fresh ) ).toBe( false );
		expect( evaluate( { kind: 'questStarted' }, fresh ) ).toBe( false );
		expect( evaluate( { kind: 'questEnded' }, fresh ) ).toBe( false );

		const killed = context( { activeStepIds: [ 'report' ], completedStepIds: [ 'arrive', 'kill' ], flags: [ 'alarm' ] }, [ 'npc-v' ] );
		expect( evaluate( { kind: 'stepDone', stepId: 'kill' }, killed ) ).toBe( true );
		expect( evaluate( { kind: 'flagSet', flag: 'alarm' }, killed ) ).toBe( true );
		expect( evaluate( { kind: 'roleDead', roleId: 'victim' }, killed ) ).toBe( true );
		expect( evaluate( { kind: 'roleDead', roleId: 'giver' }, killed ) ).toBe( false );
		expect( evaluate( { kind: 'questStarted' }, killed ) ).toBe( true );

		const ended = context( { activeStepIds: [], completedStepIds: [ 'arrive', 'kill', 'report' ], endingId: 'done' } );
		expect( evaluate( { kind: 'questEnded' }, ended ) ).toBe( true );
		expect( evaluate( { kind: 'never' }, ended ) ).toBe( false );

	} );

	it( 'combines conditions with all, any and not', () => {

		const killed = context( { completedStepIds: [ 'kill' ] }, [ 'npc-v' ] );
		const both = { all: [ { kind: 'stepDone', stepId: 'kill' }, { kind: 'roleDead', roleId: 'victim' } ] };
		expect( evaluate( both, killed ) ).toBe( true );
		expect( evaluate( both, context( { completedStepIds: [ 'kill' ] } ) ) ).toBe( false );
		expect( evaluate( { any: [ { kind: 'questEnded' }, { kind: 'flagNotSet', flag: 'alarm' } ] }, killed ) ).toBe( true );
		expect( evaluate( { not: { any: [ { kind: 'questEnded' }, { kind: 'never' } ] } }, killed ) ).toBe( true );

	} );

	it( 'names every step, flag and role the questline lacks, however deep', () => {

		expect( unknownReferences( { all: [ { kind: 'stepDone', stepId: 'kill' }, { kind: 'roleDead', roleId: 'victim' } ] }, definition ) ).toEqual( [] );
		expect( unknownReferences( {
			any: [ { kind: 'stepActive', stepId: 'flee' }, { not: { all: [ { kind: 'flagSet', flag: 'riot' }, { kind: 'roleDead', roleId: 'mayor' } ] } } ]
		}, definition ) ).toEqual( [ 'stepId flee', 'flag riot', 'roleId mayor' ] );

	} );

} );
