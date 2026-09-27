import { expect, it } from 'vitest';
import { StreetLampClearance } from './StreetLampClearance.js';
import { streetLampFixture } from './fixtures/street-lamps.js';

it( 'rejects complete pole bases in walking ribbons and crossing landings at grade', () => {
	const { atlas, walk } = streetLampFixture();
	atlas.streets.construction = { junctions: [ { approaches: [ { landings: { left: [ [ 3, 3 ], [ 5, 3 ], [ 5, 5 ], [ 3, 5 ] ] } } ] } ] };
	const clearance = new StreetLampClearance( atlas, walk );
	[ ...clearance.index() ];
	expect( clearance.allowsBase( 4, 4, 0.15 ) ).toBe( false );
	expect( clearance.allowsBase( 2.9, 4, 0.15 ) ).toBe( false );
	const edge = walk.edges[ 0 ];
	const [ x, y, z ] = edge.path3[ 0 ];
	expect( clearance.allowsBase( x + 5, z, 0.15 ) ).toBe( false );
	expect( clearance.allowsBase( 500, 500, 0.15 ) ).toBe( true );
} );
