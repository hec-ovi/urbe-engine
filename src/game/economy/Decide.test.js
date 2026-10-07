import { describe, expect, it } from 'vitest';
import { acceptsCredits, acceptsThing, bribe, buysThing, isOfficial, paysCredits, sells } from './Decide.js';
import { draw } from './Carry.js';

describe( 'deciding a transfer without a model', () => {

	it( 'has a hostile person refuse everything', () => {

		expect( acceptsThing( 'hostile', { kind: 'goods', story: true } ) ).toBe( false );
		expect( acceptsCredits( 'hostile', { amount: 50, means: 'short' } ) ).toBe( false );
		expect( bribe( 'hostile', { amount: 500, means: 'short', seed: 'x' } ).taken ).toBe( false );
		expect( paysCredits( 'hostile', { amount: 1, carried: 100, means: 'well-off' } ) ).toBe( false );
		expect( buysThing( 'hostile', { price: 1, carried: 100, till: true } ) ).toBe( false );
		expect( sells( 'hostile' ) ).toBe( false );

	} );

	it( 'takes things and credits by disposition and means', () => {

		expect( acceptsThing( 'friendly', { kind: 'access-card' } ) ).toBe( true );
		expect( acceptsThing( 'neutral', { kind: 'effect' } ) ).toBe( true );
		expect( acceptsThing( 'neutral', { kind: 'access-card' } ) ).toBe( false );
		expect( acceptsThing( 'neutral', { kind: 'access-card', theirs: true } ) ).toBe( true );
		expect( acceptsThing( 'wary', { kind: 'effect' } ) ).toBe( false );
		expect( acceptsThing( 'wary', { kind: 'goods' } ) ).toBe( true );
		expect( acceptsThing( 'wary', { kind: 'story', story: true } ) ).toBe( true );
		expect( acceptsCredits( 'neutral', { amount: 50 } ) ).toBe( true );
		expect( acceptsCredits( 'wary', { amount: 20, means: 'comfortable' } ) ).toBe( false );
		expect( acceptsCredits( 'wary', { amount: 5, means: 'comfortable' } ) ).toBe( true );
		expect( acceptsCredits( 'wary', { amount: 20, means: 'short' } ) ).toBe( true );
		expect( paysCredits( 'friendly', { amount: 5, carried: 30, means: 'getting-by' } ) ).toBe( true );
		expect( paysCredits( 'friendly', { amount: 6, carried: 30, means: 'getting-by' } ) ).toBe( false );
		expect( paysCredits( 'friendly', { amount: 5, carried: 4, means: 'getting-by' } ) ).toBe( false );
		expect( paysCredits( 'neutral', { amount: 7, carried: 100, means: 'comfortable' } ) ).toBe( true );
		expect( paysCredits( 'neutral', { amount: 8, carried: 100, means: 'comfortable' } ) ).toBe( false );
		expect( paysCredits( 'wary', { amount: 1, carried: 100, means: 'well-off' } ) ).toBe( false );
		expect( buysThing( 'wary', { price: 3, carried: 100, till: true } ) ).toBe( true );
		expect( buysThing( 'wary', { price: 3, carried: 100 } ) ).toBe( false );
		expect( buysThing( 'neutral', { price: 30, carried: 20 } ) ).toBe( false );
		expect( buysThing( 'neutral', { price: 20, carried: 20 } ) ).toBe( true );

	} );

	it( 'decides a bribe by fixed odds and a fixed seed', () => {

		const seeds = Array.from( { length: 400 }, ( _, n ) => `k1|${n}` );
		const odds = ( disposition, amount, means ) => seeds.filter( ( seed ) => bribe( disposition, { amount, means, seed } ).taken ).length / seeds.length;
		expect( odds( 'friendly', 5, 'getting-by' ) ).toBeCloseTo( 0.5, 1 );
		expect( odds( 'wary', 5, 'getting-by' ) ).toBeCloseTo( 0.15, 1 );
		expect( odds( 'wary', 20, 'short' ) ).toBeCloseTo( 0.45, 1 );
		for ( const seed of seeds.slice( 0, 30 ) ) {

			expect( bribe( 'neutral', { amount: 10, means: 'comfortable', seed } ) ).toEqual( { taken: draw( seed, 'bribe' ) < 0.35 } );
			expect( acceptsCredits( 'neutral', { amount: 10, means: 'comfortable', official: true, seed } ) ).toBe( draw( seed, 'bribe' ) < 0.35 );

		}

	} );

	it( 'knows an official by category, or by a desk or guard post at a station, a compound or offices', () => {

		expect( isOfficial( { job: { role: 'cook' } }, 'authority', 'restaurant' ) ).toBe( true );
		expect( isOfficial( { job: { role: 'security' } }, 'worker', 'police' ) ).toBe( true );
		expect( isOfficial( { job: { role: 'clerk' } }, 'worker', 'offices' ) ).toBe( true );
		expect( isOfficial( { job: { role: 'clerk' } }, 'vendor', 'commerce' ) ).toBe( false );
		expect( isOfficial( { job: { role: 'cleaner' } }, 'worker', 'police' ) ).toBe( false );
		expect( isOfficial( {}, 'resident', null ) ).toBe( false );

	} );

} );
