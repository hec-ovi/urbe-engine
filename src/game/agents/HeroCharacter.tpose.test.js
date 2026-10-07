import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { HeroCharacter } from './HeroCharacter.js';
import { CROWD_CLIP_NAMES, LAYERED_CLIPS } from './CharacterCatalog.js';
import { Warmup } from '../look/Warmup.js';
import { animation, heroRigs, outfit, rootTurn } from './HeroCharacter.test-fixtures.js';

/**
 * The Source bodies' rest pose is the T-pose. Here every clip holds the test
 * rig's root turned POSED radians, and its rest pose is unturned: a rig drawn
 * at any blend of clips is turned POSED, and one drawn at its rest pose, or
 * partly at it, is turned less.
 */
const POSED = 0.7;
const NAMES = [ ...CROWD_CLIP_NAMES.filter( ( name ) => ! LAYERED_CLIPS[ name ] ), 'Sprint_Enter', 'Crouch_Enter' ];
const posedLibrary = () => animation( Object.fromEntries( NAMES.map( ( name ) => [ name, [ POSED, POSED ] ] ) ) );

/** Every rig a frame would draw: the roots in the group showing, each with how far its root is turned. */
function drawn( hero ) {

	const roots = [];
	for ( const root of hero.group.children ) if ( root.visible ) roots.push( { name: root.name, turn: rootTurn( root ) } );
	return roots;

}

const resting = ( hero ) => drawn( hero ).filter( ( { turn } ) => Math.abs( turn - POSED ) > 1e-4 );

/** A renderer double whose link of a rig's programs finishes when the test says so, as a real one's spans frames. */
function linkingRenderer() {

	const pending = [];
	return {
		pending,
		compileAsync: () => new Promise( ( resolve ) => pending.push( resolve ) ),
		getMRT: () => null,
		setMRT() {},
		getRenderTarget: () => null,
		setRenderTarget() {}
	};

}

const person = ( index, extra = {} ) => ( {
	id: `p${index}`, npcId: `n${index}`, gender: 'male', variant: 0, appearanceSeed: index, clip: 1, frame: 8, hero: false, presence: 1,
	position: new THREE.Vector3( index, 0, 2 ), heading: 0, look: outfit(), ...extra
} );

describe( 'a rig reaches no frame in its rest pose, the pack\'s T-pose', () => {

	for ( const [ who, start ] of [
		[ 'a close person', ( hero, someone ) => hero.near( [ someone ] ) ],
		[ 'a talked-to person', ( hero, someone ) => hero.show( someone, [ { clipName: 'Idle_Talking_Loop', loop: true } ] ) ]
	] ) it( `joins the scene posed when ${who}'s rig is built, never while the warm-up links its programs`, async () => {

		const renderer = linkingRenderer();
		const warmup = new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() );
		const hero = new HeroCharacter( heroRigs( { animation: posedLibrary(), warmup } ) );
		const someone = person( 1 );
		start( hero, someone );
		await expect.poll( () => renderer.pending.length ).toBe( 1 );
		// The game's frames go on while the programs link: the crowd body shows them, and no rig.
		hero.update( 1 / 60 );
		expect( drawn( hero ) ).toEqual( [] );
		expect( someone.hero ).toBe( false );

		renderer.pending.forEach( ( resolve ) => resolve() );
		await expect.poll( () => someone.hero ).toBe( true );
		// Before any update, the rig in the scene already stands in the crowd's clip.
		expect( drawn( hero ) ).toEqual( [ { name: expect.stringMatching( /^(close|focused)-regular-male$/ ), turn: expect.closeTo( POSED, 6 ) } ] );
		hero.update( 1 / 60 );
		expect( resting( hero ) ).toEqual( [] );

	} );

} );

describe( 'whatever the game asks of the rigs, in any order, a frame draws none of them at rest', () => {

	const SEGMENTS = [
		[ { clipName: 'Idle_Talking_Loop', loop: true } ],
		[ { clipName: 'Sitting_Talking_Loop', loop: true } ],
		[ { clipName: 'Idle_Loop', loop: true, blendMs: 0 } ],
		[ { clipName: 'Sprint_Enter', loop: false, blendMs: 0 }, { clipName: 'Sprint_Loop', loop: true, blendMs: 80 } ],
		[ { clipName: 'Crouch_Enter', loop: false }, { clipName: 'Crouch_Idle_Loop', loop: true } ],
		[ { clipName: 'Drink', loop: false }, { clipName: 'Idle_Loop', loop: true } ],
		[ { clipName: 'Walk_Loop', loop: true } ]
	];
	const DELTAS = [ 0, 1 / 60, 1 / 30, 0.1, 0.3 ];

	for ( const seed of [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 ] ) it( `run ${seed}${seed % 2 ? ', each rig\'s programs linking over frames' : ''}`, async () => {

		let state = seed * 2654435761 >>> 0;
		const random = () => ( ( state = ( Math.imul( state ^ ( state >>> 15 ), 2246822519 ) + 0x6d2b79f5 ) >>> 0 ) / 4294967296 );
		const pick = ( list ) => list[ Math.floor( random() * list.length ) ];
		// Half the runs link each rig's programs over frames, as the game's warm-up does.
		const renderer = seed % 2 ? linkingRenderer() : null;
		const warmup = renderer ? new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() ) : null;
		const hero = new HeroCharacter( heroRigs( { animation: posedLibrary(), warmup } ) );
		const people = [ 1, 2, 3 ].map( ( index ) => person( index, { clip: 1, frame: index * 5 } ) );
		const seen = [];
		for ( let step = 0; step < 400; step ++ ) {

			const roll = random();
			const someone = pick( people );
			if ( roll < 0.15 ) hero.near( people.filter( () => random() < 0.6 ) );
			else if ( roll < 0.25 ) hero.show( someone, pick( SEGMENTS ) ).catch( () => {} );
			else if ( roll < 0.3 ) hero.play( pick( SEGMENTS ) );
			else if ( roll < 0.34 ) hero.hide();
			else if ( roll < 0.42 ) {

				someone.clip = Math.floor( random() * CROWD_CLIP_NAMES.length );
				someone.shown = random() < 0.5 ? undefined : Math.floor( random() * CROWD_CLIP_NAMES.length );
				someone.frame = random() * 32;

			} else if ( roll < 0.5 ) someone.position.x += random() < 0.5 ? 0 : 0.05 + random() * 0.2;
			else if ( roll < 0.53 ) someone.look = outfit( 'male', { outfit: { pants: pick( [ 'pants-shorts', 'pants-cargo' ] ) } } );
			if ( renderer && random() < 0.4 ) renderer.pending.splice( 0 ).forEach( ( resolve ) => resolve() );
			if ( random() < 0.3 ) await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
			hero.update( pick( DELTAS ) );
			for ( const rig of resting( hero ) ) seen.push( { step, ...rig } );

		}
		// The first few, if any: which rig, at which step, how far turned.
		expect( seen.slice( 0, 5 ) ).toEqual( [] );

	} );

} );
