import { describe, expect, it } from 'vitest';
import { CLIP } from './CharacterAssets.js';
import { CROWD_CLIPS } from './CharacterCatalog.js';
import { IDLE_STYLES, idleRole, idleStyle, stepIdle } from './IdleVariety.js';
import { FRAMES } from './VatBaker.js';

/** Every baked clip lasts two seconds, so a play-through is a known number of steps. */
const DURATIONS = CROWD_CLIPS.map( () => 2 );
const STEP = 1 / 30;

/** A person resting in a posture, stepped for `seconds`: each step's clip and frame. */
function rest( { type = 'quest_resident', activity = 'leisure', clip = CLIP.IDLE, appearanceSeed = 1, frame = 0 } = {}, seconds = 60 ) {

	const member = { type, activity, clip, appearanceSeed, frame };
	const steps = [];
	for ( let t = 0; t < seconds; t += STEP ) {

		const shown = stepIdle( member, STEP, DURATIONS );
		steps.push( { shown, frame: member.frame } );

	}
	return { member, steps };

}

describe( 'idle variety', () => {

	it( 'rests each kind of person as their role does: guards, clerks, workers, passers-by and whoever sits', () => {

		expect( [ 'quest_security', 'security_guard', 'police_officer', 'soldier' ].map( ( type ) => idleRole( { type } ) ) ).toEqual( Array( 4 ).fill( 'guard' ) );
		expect( [ 'quest_vendor', 'barista', 'waiter', 'shop_clerk' ].map( ( type ) => idleRole( { type, activity: 'working' } ) ) ).toEqual( Array( 4 ).fill( 'clerk' ) );
		expect( [ 'quest_clinician', 'quest_corporate', 'office_worker', 'medic_staff', 'quest_transit' ].map( ( type ) => idleRole( { type } ) ) ).toEqual( Array( 5 ).fill( 'worker' ) );
		// Somebody on duty of a type it cannot place works; a guest or a passer-by relaxes.
		expect( idleRole( { type: 'quest_resident', activity: 'working' } ) ).toBe( 'worker' );
		expect( idleRole( { type: 'quest_resident', activity: 'leisure' } ) ).toBe( 'relaxed' );
		expect( idleRole( { type: 'street_wanderer' } ) ).toBe( 'relaxed' );
		expect( idleRole( { type: 'quest_security', seated: true } ) ).toBe( 'seated' );
		expect( idleRole() ).toBe( 'relaxed' );

	} );

	it( 'gives the same person the same style every time, from their role\'s own clips', () => {

		for ( const role of Object.keys( IDLE_STYLES ) ) {

			for ( let seed = 0; seed < 50; seed ++ ) {

				const style = idleStyle( role, seed * 7919 );
				expect( idleStyle( role, seed * 7919 ) ).toEqual( style );
				expect( IDLE_STYLES[ role ].bases.map( ( [ clip ] ) => clip ) ).toContain( style.base );
				for ( const [ clip ] of style.fidgets ) {

					expect( IDLE_STYLES[ role ].fidgets.map( ( [ fidget ] ) => fidget ) ).toContain( clip );
					expect( clip ).not.toBe( style.base );

				}
				expect( style.speed ).toBeGreaterThanOrEqual( 0.86 );
				expect( style.speed ).toBeLessThanOrEqual( 1.14 );
				expect( style.gap[ 0 ] ).toBeLessThan( style.gap[ 1 ] );

			}

		}
		// A seated person only ever shows seated clips; a standing one never does.
		const seated = new Set( [ CLIP.SIT, CLIP.SIT_FIDGET, CLIP.SIT_NOD, CLIP.SIT_DRINK ] );
		for ( const [ clip ] of [ ...IDLE_STYLES.seated.bases, ...IDLE_STYLES.seated.fidgets ] ) expect( seated.has( clip ) ).toBe( true );
		for ( const role of [ 'guard', 'clerk', 'worker', 'relaxed' ] ) {

			for ( const [ clip ] of [ ...IDLE_STYLES[ role ].bases, ...IDLE_STYLES[ role ].fidgets ] ) expect( seated.has( clip ) ).toBe( false );

		}

	} );

	it( 'varies across people: their pace, their rest, and for guards whether they scan all the time', () => {

		const styles = Array.from( { length: 200 }, ( _, seed ) => idleStyle( 'guard', seed * 104729 + 3 ) );
		expect( new Set( styles.map( ( style ) => style.speed.toFixed( 4 ) ) ).size ).toBeGreaterThan( 150 );
		expect( new Set( styles.map( ( style ) => style.gap[ 1 ].toFixed( 3 ) ) ).size ).toBeGreaterThan( 150 );
		const scanning = styles.filter( ( style ) => style.base === CLIP.LOOK_AROUND ).length;
		expect( scanning ).toBeGreaterThan( 20 );
		expect( scanning ).toBeLessThan( 100 );
		// One seed stands differently in different roles.
		expect( idleStyle( 'guard', 5 ) ).not.toEqual( idleStyle( 'clerk', 5 ) );

	} );

	it( 'breaks the rest with the role\'s fidgets now and then, each played through once from where the loop comes round', () => {

		const { steps } = rest( { type: 'quest_security', appearanceSeed: 11 }, 120 );
		const style = idleStyle( 'guard', 11 );
		const fidgets = steps.filter( ( step ) => step.shown !== style.base );
		expect( fidgets.length ).toBeGreaterThan( 0 );
		expect( steps.filter( ( step ) => step.shown === style.base ).length ).toBeGreaterThan( fidgets.length );
		for ( let i = 1; i < steps.length; i ++ ) {

			const [ before, after ] = [ steps[ i - 1 ], steps[ i ] ];
			if ( before.shown === after.shown ) continue;
			// A change of clip happens only where one play-through ends and the next starts.
			expect( after.frame ).toBeLessThan( FRAMES * 0.1 );
			expect( before.frame ).toBeGreaterThan( FRAMES * 0.9 );
			// Every fidget hands back to the rest, never straight to another fidget.
			expect( before.shown === style.base || after.shown === style.base ).toBe( true );
			if ( after.shown !== style.base ) expect( style.fidgets.map( ( [ clip ] ) => clip ) ).toContain( after.shown );

		}

	} );

	it( 'keeps nobody in step: two people start together and drift apart; the same person steps the same way twice', () => {

		const first = rest( { type: 'quest_clinician', activity: 'working', appearanceSeed: 101 } );
		const second = rest( { type: 'quest_clinician', activity: 'working', appearanceSeed: 202 } );
		const apart = first.steps.filter( ( step, i ) => step.shown !== second.steps[ i ].shown || Math.abs( step.frame - second.steps[ i ].frame ) > 1 );
		expect( apart.length ).toBeGreaterThan( first.steps.length * 0.8 );
		expect( rest( { type: 'quest_clinician', activity: 'working', appearanceSeed: 101 } ).steps ).toEqual( first.steps );

	} );

	it( 'sits in seated clips only, and starts over in the new posture\'s style when the posture changes', () => {

		const { member, steps } = rest( { clip: CLIP.SIT, appearanceSeed: 42 }, 90 );
		const seated = new Set( [ CLIP.SIT, CLIP.SIT_FIDGET, CLIP.SIT_NOD, CLIP.SIT_DRINK ] );
		expect( steps.every( ( step ) => seated.has( step.shown ) ) ).toBe( true );
		expect( new Set( steps.map( ( step ) => step.shown ) ).size ).toBeGreaterThan( 1 );
		const state = member.idle;
		stepIdle( member, STEP, DURATIONS );
		// Resting on keeps its state: nothing new is made per step.
		expect( member.idle ).toBe( state );
		member.clip = CLIP.IDLE;
		expect( seated.has( stepIdle( member, STEP, DURATIONS ) ) ).toBe( false );
		expect( member.idle.style.role ).toBe( 'relaxed' );

	} );

} );
