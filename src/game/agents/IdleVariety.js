import { CLIP } from './CharacterAssets.js';
import { FRAMES } from './VatBaker.js';

/** Who a standing person is by their type, whatever the game calls it. */
const GUARDS = /secur|guard|police|patrol|watch|soldier|military|authority|officer|bouncer/i;
const CLERKS = /vendor|barista|clerk|cashier|waiter|waitress|cook|bartender|shop|seller|sales|reception|concierge|host/i;
const WORKERS = /worker|corporate|corpo|clinic|medic|nurse|doctor|techn|mechanic|engineer|analyst|office|staff|transit|driver|maint|janitor|porter|labou?r/i;

/**
 * How each kind of person stands or sits still: the loops their idle rests
 * on, the fidgets they break it with and how long they rest between them, in
 * seconds, all from the crowd's baked clips (CharacterCatalog.CROWD_CLIPS).
 * A guard scans the room and rubs their neck, some of them all the time; a
 * clerk and a worker reach for things at their post; somebody passing the
 * time looks about and sips a drink; a seated guest shifts, rests a hand on
 * their head, nods along or drinks.
 */
export const IDLE_STYLES = {
	guard: {
		bases: [ [ CLIP.IDLE, 3 ], [ CLIP.LOOK_AROUND, 1 ] ],
		fidgets: [ [ CLIP.LOOK_AROUND, 5 ], [ CLIP.DRINK, 1 ] ],
		gap: [ 3, 10 ]
	},
	clerk: {
		bases: [ [ CLIP.IDLE, 1 ] ],
		fidgets: [ [ CLIP.INTERACT, 4 ], [ CLIP.LOOK_AROUND, 2 ], [ CLIP.DRINK, 1 ] ],
		gap: [ 3, 9 ]
	},
	worker: {
		bases: [ [ CLIP.IDLE, 1 ] ],
		fidgets: [ [ CLIP.INTERACT, 3 ], [ CLIP.LOOK_AROUND, 2 ], [ CLIP.DRINK, 2 ] ],
		gap: [ 4, 12 ]
	},
	relaxed: {
		bases: [ [ CLIP.IDLE, 1 ] ],
		fidgets: [ [ CLIP.LOOK_AROUND, 3 ], [ CLIP.DRINK, 2 ] ],
		gap: [ 5, 15 ]
	},
	seated: {
		bases: [ [ CLIP.SIT, 1 ] ],
		fidgets: [ [ CLIP.SIT_FIDGET, 3 ], [ CLIP.SIT_DRINK, 3 ], [ CLIP.SIT_NOD, 2 ] ],
		gap: [ 4, 12 ]
	}
};

/** The slowest and fastest anybody plays their idle, as a share of the clip's own pace. */
const SLOWEST = 0.86;
const FASTEST = 1.14;
/** How much more or less often than their style a person fidgets. */
const CALMEST = 1.5;
const RESTLESS = 0.7;

/**
 * Which style a person rests in: seated when they sit, else by their type (a
 * guard, a clerk or a worker), else a worker while on duty, else relaxed.
 */
export function idleRole( { type = '', activity = null, seated = false } = {} ) {

	if ( seated ) return 'seated';
	if ( GUARDS.test( type ?? '' ) ) return 'guard';
	if ( CLERKS.test( type ?? '' ) ) return 'clerk';
	if ( WORKERS.test( type ?? '' ) || activity === 'working' ) return 'worker';
	return 'relaxed';

}

/**
 * One person's way of resting, which their seed decides for their role: the
 * loop they rest on, the fidgets they have, their pace and how restless they
 * are. The same seed and role give the same style.
 *
 * @returns `{ role, base, fidgets: [[clip, weight]], gap: [least, most], speed }`
 */
export function idleStyle( role, seed ) {

	const style = IDLE_STYLES[ role ] ?? IDLE_STYLES.relaxed;
	const random = mulberry( ( seed ^ salt( role ) ) >>> 0 );
	const base = weighted( style.bases, random() );
	const temper = RESTLESS + ( CALMEST - RESTLESS ) * random();
	return {
		role,
		base,
		fidgets: style.fidgets.filter( ( [ clip ] ) => clip !== base ),
		gap: [ style.gap[ 0 ] * temper, style.gap[ 1 ] * temper ],
		speed: SLOWEST + ( FASTEST - SLOWEST ) * random()
	};

}

/**
 * Moves one resting person on by `delta` seconds: their style's loop, and
 * now and then one of its fidgets played through once, at their own pace.
 * A fidget starts where the loop comes back round and hands back to it where
 * it ends, both of which stand in the library's neutral pose, so the baked
 * body never jumps. Writes `member.shown` (the baked clip drawn) and
 * `member.frame` (0 to FRAMES through it); the posture is `member.clip`
 * (CLIP.IDLE or CLIP.SIT), which it only reads. Nothing is allocated past a
 * person's first step in a posture.
 *
 * @param durations each baked clip's length in seconds
 */
export function stepIdle( member, delta, durations ) {

	const seated = member.clip === CLIP.SIT;
	let state = member.idle;
	if ( ! state || state.type !== member.type || state.activity !== member.activity || state.seated !== seated ) {

		state = member.idle = restState( member, seated );
		member.shown = state.style.base;

	}
	const { style } = state;
	const shown = member.shown ?? style.base;
	member.frame = ( member.frame ?? 0 ) + ( delta / ( durations[ shown ] || 1 ) ) * FRAMES * style.speed;
	if ( shown === style.base ) state.wait -= delta;
	if ( member.frame < FRAMES ) return shown;
	member.frame %= FRAMES;
	if ( shown !== style.base ) {

		member.shown = style.base;
		state.wait = between( style.gap, state.random() );

	} else if ( state.wait <= 0 && style.fidgets.length ) member.shown = weighted( style.fidgets, state.random() );
	return member.shown;

}

/** A person's first step in a posture: their style, and a first rest of up to their longest, so a room does not fidget at once. */
function restState( member, seated ) {

	const seed = member.appearanceSeed ?? 0;
	const style = idleStyle( idleRole( { type: member.type, activity: member.activity, seated } ), seed );
	const random = mulberry( ( seed * 2654435761 ) >>> 0 );
	return { type: member.type, activity: member.activity, seated, style, random, wait: style.gap[ 1 ] * random() };

}

function between( [ least, most ], value ) {

	return least + ( most - least ) * value;

}

/** The entry `value` (0 to 1) lands on, each taking its weight's share. */
function weighted( entries, value ) {

	let total = 0;
	for ( const [ , weight ] of entries ) total += weight;
	let left = value * total;
	for ( const [ clip, weight ] of entries ) {

		left -= weight;
		if ( left < 0 ) return clip;

	}
	return entries[ entries.length - 1 ][ 0 ];

}

function salt( role ) {

	let h = 2166136261;
	for ( let i = 0; i < role.length; i ++ ) h = Math.imul( h ^ role.charCodeAt( i ), 16777619 );
	return h >>> 0;

}

function mulberry( seed ) {

	let state = seed >>> 0;
	return () => {

		state = ( state + 0x6d2b79f5 ) >>> 0;
		let t = state;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}
