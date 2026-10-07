/**
 * What a person carries, worked out the same way every time from who they
 * are: their id, age, household, home tier, post and the cards their scopes
 * give them. Nothing here is saved; a person's holdings are saved only once
 * something changes (Holdings).
 */

/** Home tiers, poorest first, as a score toward a person's means. */
const TIER_SCORE = Object.freeze( { poor: 0, mid: 1, rich: 2, high_rich: 3 } );
/** A household's means, from the score: nothing or less is short. */
export const MEANS = Object.freeze( [ 'short', 'getting-by', 'comfortable', 'well-off' ] );
/** The credits a person has on them by their means, and a child's pocket money: `[lo, hi]`, whole credits. */
const CREDITS = Object.freeze( {
	short: [ 2, 18 ], 'getting-by': [ 10, 45 ], comfortable: [ 30, 120 ], 'well-off': [ 80, 300 ],
	child: [ 0, 6 ], youth: [ 0, 15 ]
} );
/** The most things a person has on them. */
const MAX_THINGS = 7;
/** What a post has a person carry to work: `[name, worth]`. */
const KIT = Object.freeze( {
	clerk: [ 'a rubber stamp in a tin', 4 ],
	office_worker: [ 'a fountain pen and a pocket diary', 6 ],
	executive: [ 'a leather card case', 20 ],
	receptionist: [ 'a pad of visitor slips', 1 ],
	security: [ 'a torch', 5 ],
	cleaner: [ 'work gloves', 2 ],
	waiter: [ 'an order pad', 1 ],
	cook: [ 'a folding knife', 6 ],
	barista: [ 'a bar towel', 1 ],
	vendor: [ 'a receipt book', 1 ],
	driver: [ 'a timetable card', 1 ]
} );
/** Security at a police station or a compound carries a warrant notebook instead of a torch. */
const WARRANT = Object.freeze( [ 'a warrant notebook', 5 ] );
const WARRANT_PLACES = new Set( [ 'police', 'military' ] );
/** The posts that keep files, who carry a pen drive more often. */
const DESK_ROLES = new Set( [ 'clerk', 'office_worker', 'executive' ] );
/**
 * A personal effect drawn for someone with no child or partner to carry a
 * picture or a note of: `{ name, worth, sort, adult?, means? }`, `means` the
 * households that carry it.
 */
const EFFECTS = Object.freeze( [
	{ name: 'a ration book', worth: 3, sort: 'papers' },
	{ name: 'a pack of cigarettes', worth: 5, sort: 'goods', adult: true },
	{ name: 'a paperback with its cover torn off', worth: 2, sort: 'document' },
	{ name: 'a comb', worth: 1, sort: 'goods' },
	{ name: 'a lighter', worth: 3, sort: 'goods' },
	{ name: 'a folded Bulletin', worth: 1, sort: 'papers' },
	{ name: 'a pawn ticket', worth: 4, sort: 'papers', means: [ 'short' ] },
	{ name: 'a pocket watch', worth: 15, sort: 'goods', means: [ 'comfortable', 'well-off' ] }
] );
/** The slots a hand in a pocket can come out with: the things kept loose about a person. */
export const POCKET_SLOTS = Object.freeze( [ 'phone', 'pen-drive', 'flask', 'effect' ] );

/**
 * A stable number in [0, 1) for a person and one choice about them: FNV-1a
 * of `npcId|slot`, the formula of Quests `LifeHistory`, so slot `roots` is
 * the same draw their life history makes for where they grew up.
 */
export function draw( npcId, slot ) {

	let hash = 2166136261;
	for ( const char of `${npcId}|${slot}` ) hash = Math.imul( hash ^ char.charCodeAt( 0 ), 16777619 );
	return ( hash >>> 0 ) / 4294967296;

}

/**
 * A household's means by its home's tier: one step down for an adult with
 * no post (in a building or on transit), and for a poor household with a
 * child; one up for an executive.
 */
export function meansOf( npc, { tier = 'mid' } = {} ) {

	let score = TIER_SCORE[ tier ] ?? TIER_SCORE.mid;
	const adult = ( npc?.age ?? 30 ) >= 18;
	if ( adult && ! npc?.job && ! npc?.transitJob ) score -= 1;
	if ( tier === 'poor' && ( npc?.family ?? [] ).some( ( member ) => member.relation === 'child' ) ) score -= 1;
	if ( npc?.job?.role === 'executive' ) score += 1;
	return MEANS[ Math.max( 0, Math.min( MEANS.length - 1, score ) ) ];

}

/**
 * What a person has on them: `{ credits, means, things }`, each thing
 * `{ slot, kind, name, worth, giftable, sort, label? }` in the order told:
 * a card per scope (given as a copy, gone only when lifted), a phone from
 * twelve, residence papers from sixteen, the kit of their post, one
 * personal effect, and now and then a flask and a pen drive; at most
 * MAX_THINGS. `name` is the thing as the person tells it, `label` as
 * somebody else would, when the two differ.
 * @param npc the simulation's person
 * @param options.tier their home's wealth tier
 * @param options.scopes their access scopes (Access `scopesOf`), home first
 * @param options.describe `(scope) => { label }`, Access `describeScope`
 * @param options.jobType the parcel type of their workplace, for the kit
 */
export function carryOf( npc, { tier = 'mid', scopes = [], describe = () => null, jobType = null } = {} ) {

	const id = npc.npcId;
	const age = Number.isFinite( npc.age ) ? npc.age : 30;
	const means = meansOf( npc, { tier } );
	const [ lo, hi ] = CREDITS[ age < 14 ? 'child' : age < 18 ? 'youth' : means ];
	const credits = lo + Math.floor( draw( id, 'carry:credits' ) * ( hi - lo + 1 ) );
	const things = [];
	const add = ( thing ) => { if ( things.length < MAX_THINGS ) things.push( { giftable: true, ...thing } ); };
	for ( const scope of scopes ) add( { slot: `card:${scope}`, kind: 'access-card', name: describe( scope )?.label ?? 'a key card', worth: 0, sort: 'access card' } );
	if ( age >= 12 ) {

		const phone = means === 'short' ? [ 'an old phone with a cracked screen', 10 ] : means === 'well-off' ? [ 'a good phone', 90 ] : [ 'a phone', 30 ];
		add( { slot: 'phone', kind: 'phone', name: phone[ 0 ], worth: phone[ 1 ], giftable: false, sort: 'phone' } );

	}
	if ( age >= 16 ) add( { slot: 'papers', kind: 'papers', name: 'your residence papers, stamped', label: 'residence papers', worth: 0, giftable: false, sort: 'papers' } );
	const role = npc.job?.role ?? npc.transitJob?.role ?? null;
	const kit = role === 'security' && WARRANT_PLACES.has( jobType ) ? WARRANT : KIT[ role ];
	if ( kit ) add( { slot: 'kit', kind: 'kit', name: kit[ 0 ], worth: kit[ 1 ], sort: 'tool' } );
	add( effectOf( npc, { age, means } ) );
	if ( age >= 18 && draw( id, 'carry:flask' ) < 0.15 ) add( { slot: 'flask', kind: 'flask', name: 'a hip flask of schnapps', worth: 6, sort: 'flask' } );
	if ( draw( id, 'carry:pen-drive' ) < ( DESK_ROLES.has( role ) ? 0.15 : 0.06 ) ) add( { slot: 'pen-drive', kind: 'pen-drive', name: 'a pen drive with no label', worth: 8, sort: 'pen drive' } );
	return { credits, means, things };

}

/**
 * The one personal effect a person carries: a photo of their child, else a
 * note from their partner, else a letter from where they grew up when they
 * grew up away (their life history's own draw), else one drawn from EFFECTS.
 */
function effectOf( npc, { age, means } ) {

	const id = npc.npcId;
	const given = npc.name?.given ?? 'them';
	const child = ( npc.family ?? [] ).find( ( member ) => member.relation === 'child' );
	if ( child ) return { slot: 'effect', kind: 'effect', name: `a photo of ${child.name?.given ?? 'their child'}`, worth: 1, sort: 'photo' };
	const partner = ( npc.family ?? [] ).find( ( member ) => member.relation === 'partner' );
	if ( partner ) return { slot: 'effect', kind: 'effect', name: `a note from ${partner.name?.given ?? 'their partner'}`, worth: 1, sort: 'papers' };
	if ( age >= 18 && draw( id, 'roots' ) >= 0.7 ) {

		return { slot: 'effect', kind: 'effect', name: 'a letter from where you grew up', label: `a letter from where ${given} grew up`, worth: 1, sort: 'papers' };

	}
	const choices = EFFECTS.filter( ( effect ) => ( ! effect.adult || age >= 18 ) && ( ! effect.means || effect.means.includes( means ) ) );
	const effect = choices[ Math.floor( draw( id, 'carry:effect' ) * choices.length ) ];
	return { slot: 'effect', kind: 'effect', name: effect.name, worth: effect.worth, sort: effect.sort };

}
