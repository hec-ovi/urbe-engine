import { expect, it } from 'vitest';
import { GameClock } from './GameClock.js';
import { storyStartMinute } from './StoryStart.js';

it( 'advances a schedule projection inside an integer minute', () => {
	const clock = new GameClock( { startHour: 8 } );
	const project = time => ( time - 480 ) * 80;
	const positions = [ project( clock.exactMin ) ];
	for ( let i = 0; i < 10; i ++ ) { clock.advance( 0.5 ); positions.push( project( clock.exactMin ) ); }
	expect( clock.timeMin ).toBe( 480 );
	for ( let i = 1; i < positions.length; i ++ ) {
		expect( positions[ i ] ).toBeGreaterThan( positions[ i - 1 ] );
		expect( positions[ i ] - positions[ i - 1 ] ).toBeLessThan( 0.7 );
	}
} );

it( 'opens the story while its actual client is working and its appointment is available', () => {
	const runtime = { cast: { client: 'npc1' }, activeSteps: () => [ { stepId: 'meet', target: { kind: 'talk', roleId: 'client' } } ],
		stepPlacementAvailability: ( id, minute ) => ( { available: minute % 1440 >= 600 && minute % 1440 < 900 } ) };
	const sim = { continuityAt: ( id, minute ) => ( { behavior: { activity: minute % 1440 >= 630 && minute % 1440 < 1000 ? 'working' : 'resting' } } ) };
	expect( storyStartMinute( { entries: [ { runtime, side: false } ] }, sim, 1260 ) ).toBe( 630 );
	expect( storyStartMinute( { entries: [] }, sim, 1260 ) ).toBe( 1260 );
} );
