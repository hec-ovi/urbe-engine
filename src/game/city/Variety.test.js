import { describe, expect, it } from 'vitest';
import { bucketFor, splitBucket, variantFor } from './Variety.js';

const entry = { variants: [
	{ id: '1' }, { id: '2' },
	{ id: 'panel-ochre', class: 'pattern' }, { id: 'panel-slate', class: 'pattern' }, { id: 'panel-bone', class: 'pattern' }
] };

describe( 'variantFor', () => {

	it( 'picks a pattern variant by parcel, the same every time, spread across parcels', () => {

		const picks = new Set();
		for ( let i = 0; i < 40; i ++ ) picks.add( variantFor( entry, `p${i}` ) );
		expect( [ ...picks ].every( ( id ) => id.startsWith( 'panel-' ) ) ).toBe( true );
		expect( picks.size ).toBe( 3 );
		expect( variantFor( entry, 'p7' ) ).toBe( variantFor( entry, 'p7' ) );
		expect( variantFor( { variants: [ { id: 'only' } ] }, 'p1' ) ).toBe( 'only' );
		expect( variantFor( null, 'p1' ) ).toBeNull();
		const lowPicks = new Set();
		for ( let i = 0; i < 40; i ++ ) lowPicks.add( variantFor( entry, `p${i}`, 2 ) );
		expect( lowPicks ).toEqual( new Set( [ 'panel-ochre', 'panel-slate' ] ) );
		expect( splitBucket( bucketFor( 'cyberpunk/wall/rich', 'panel-slate' ) ) ).toEqual( { key: 'cyberpunk/wall/rich', variantId: 'panel-slate' } );
		expect( splitBucket( bucketFor( 'cyberpunk/roof/rich', null ) ) ).toEqual( { key: 'cyberpunk/roof/rich', variantId: undefined } );

	} );

} );
