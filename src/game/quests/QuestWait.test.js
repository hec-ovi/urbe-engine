import { expect, it } from 'vitest';
import { nextQuestWindow } from './QuestWait.js';

it( 'finds a future opening across closing hours, weekends and midnight without changing an open window', () => {
	const work = { days: [ 0, 1, 2, 3, 4, 5 ], startMin: 480, endMin: 960 };
	expect( nextQuestWindow( work, 21 * 60 ) ).toEqual( { timeMin: 1920, label: 'Tue 08:00', minutes: 660 } );
	expect( nextQuestWindow( work, 5 * 1440 + 1000 ) ).toEqual( { timeMin: 7 * 1440 + 480, label: 'Mon 08:00', minutes: 2360 } );
	expect( nextQuestWindow( work, 600 ) ).toBeNull();
	const night = { days: [ 0 ], startMin: 1320, endMin: 120 };
	expect( nextQuestWindow( night, 1450 ) ).toBeNull();
	expect( nextQuestWindow( night, 1600 ) ).toMatchObject( { timeMin: 7 * 1440 + 1320, label: 'Mon 22:00' } );
} );
