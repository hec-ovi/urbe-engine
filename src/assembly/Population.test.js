import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countedPopulation } from './Population.js';

describe( 'countedPopulation', () => {

	let dir = null;
	afterEach( () => { if ( dir ) rmSync( dir, { recursive: true, force: true } ); dir = null; } );

	const interior = ( id, capacity ) => {

		mkdirSync( join( dir, id, 'interior' ), { recursive: true } );
		writeFileSync( join( dir, id, 'interior', 'npc.json' ), JSON.stringify( { buildingId: id, anchors: [], roles: [], routines: [], nav: {}, ...( capacity ? { capacity } : {} ) } ) );

	};

	it( 'counts the residents from the dwellings\' sleepers and the jobs from the posts and their shifts', () => {

		dir = mkdtempSync( join( tmpdir(), 'population-' ) );
		interior( 'p1', { dwellings: [
			{ id: 'floor:1/f1-home-1', floor: 1, unit: 'f1-home-1', beds: 1, sleepers: 2 },
			{ id: 'floor:1/f1-home-2', floor: 1, unit: 'f1-home-2', beds: 2, sleepers: 3 }
		], posts: [ { role: 'receptionist', floor: 0, roleId: 'r', posts: 1, shifts: [ 'day', 'evening' ] } ] } );
		interior( 'p2', { dwellings: [], posts: [ { role: 'barista', floor: 0, roleId: 'b', posts: 2, shifts: [ 'day' ] } ] } );
		interior( 'p3', null );
		expect( countedPopulation( dir, [ 'p1', 'p2', 'p3', 'p4' ] ) ).toEqual( {
			interiors: 2, dwellings: 2, beds: 3, residents: 5, posts: 3, jobs: 4
		} );

	} );

} );
