import { CROWD_MODELS } from '../agents/CharacterCatalog.js';
import { PERSON_RADIUS } from '../physics/ImpactWorld.js';
import { STEP_HEIGHT } from '../physics/PlayerBody.js';
import { CHEST } from '../player/Interactor.js';

/** How far from a person the player stands to talk: well inside the talk range. */
const FACE_DISTANCE = 1.3;
/** Feet land this far above the measured ground, as a spawn does, so the capsule never starts inside it. */
const FOOTING = 0.05;
/** A person's look, by the names the crowd bakes and the focused body is dressed with; the eyebrows wear the hair tint. */
const LOOK_FIELDS = [ 'skin', 'shirt', 'trousers', 'hair', 'eyebrows', 'sleeve', 'hem' ];
/** Walk edges a player may be stood on, and how far apart the spots tried along them are. */
const PAVEMENT = 'sidewalk';
const PAVEMENT_STEP = 1;
/** A trailing player keeps to the path this far behind the person, and is moved up once this much further back. */
const TRAIL_BEHIND = 2.5;
const TRAIL_SLACK = 1.5;
/** A leader's path is kept as points at least this far apart. */
const TRAIL_STEP = 0.5;
/**
 * Where ground is looked for around a point: the point, then a hand's width
 * each way, since a ray down the seam between two ground cuboids meets neither.
 */
const GROUND_PROBES = [ [ 0, 0 ], [ 0.15, 0 ], [ - 0.15, 0 ], [ 0, 0.15 ], [ 0, - 0.15 ] ];

/**
 * A driver's hands in a read-only preview (`?mode=game&out=...&automation`).
 * It acts only through the player's own paths: placing the body, the E and R
 * presses, the chat line and the chat's action buttons. It reads the
 * companion and continuity to report what they do. Every answer is plain JSON.
 */
export class AutomationProbe {

	constructor( game ) {

		this.game = game;
		// A headless browser grants no pointer lock. The probe holds it, so the
		// prompt, the free body and the unpaused view are the player's own.
		game.input.locked = true;

	}

	/** The session now: renderer, player, clock, crowd, aim, conversation and chat. */
	state() {

		const { stats, body, controller, clock, crowd, interactor } = this.game;

		return {
			backend: stats.backend, tier: stats.tier, drawCalls: stats.drawCalls, fps: round( 1000 / stats.frameMs, 0 ),
			feet: point( body.feet ), yaw: round( controller.yaw ), pitch: round( controller.pitch ),
			clock: clock.label, timeMin: round( clock.timeMin ),
			crowd: crowd.members.size,
			target: targetOf( interactor.target ),
			conversation: this.#conversation(),
			chat: this.#chat()
		};

	}

	/** Crowd members within `radius` metres, nearest first. */
	people( { radius = 90, limit = 8 } = {} ) {

		const feet = this.game.body.feet;

		return this.game.crowd.within( feet, radius )
			.filter( ( member ) => ! member.retiring && ! member.hero )
			.sort( ( left, right ) => left.position.distanceToSquared( feet ) - right.position.distanceToSquared( feet ) )
			.slice( 0, limit )
			.map( ( member ) => personOf( member, feet ) );

	}

	/**
	 * Stands the player beside crowd member `id`, in front of them when the
	 * ground allows, aimed at the chest; settles with what E reaches then.
	 * `placed` is false when no spot around them has ground at their level
	 * and a clear line to them.
	 */
	async approach( id ) {

		const member = this.game.crowd.members.get( id );
		if ( ! member ) throw new Error( `no crowd member ${id}` );
		const { position } = member;
		const spot = this.#spotBeside( member );
		const placed = Boolean( spot ) && this.game.placePlayer( spot, { x: position.x, y: position.y + CHEST, z: position.z } );
		await frames( 2 );

		return { placed, person: personOf( member, this.game.body.feet ), target: targetOf( this.game.interactor.target ) };

	}

	/** Presses E (`interact`) or R (`secondary-interact`); settles after the tick that took it. */
	async press( action = 'interact' ) {

		this.game.pressAction( action );
		await frames( 2 );

		return { target: targetOf( this.game.interactor.target ), conversation: this.#conversation() };

	}

	/**
	 * Opens a conversation with crowd member `id`, or with the nearest people
	 * in turn: approach, then E. Null when nobody answered.
	 */
	async converse( id = null, { attempts = 3 } = {} ) {

		const ids = id ? [ id ] : this.people().map( ( person ) => person.id );

		for ( const candidate of ids ) {

			for ( let attempt = 0; attempt < attempts && this.game.crowd.members.has( candidate ); attempt ++ ) {

				const { placed, target } = await this.approach( candidate );
				if ( ! placed ) break;
				if ( target?.person !== candidate ) continue;
				const { conversation } = await this.press();
				if ( conversation ) return conversation;

			}

		}

		return null;

	}

	/**
	 * One person as the crowd baked them and as the focused body wears them, in
	 * one shape: the open conversation's person, waiting up to `timeoutMs` for
	 * their focused body, or crowd member `id` as they stand now. `hero` is null
	 * when no focused body shows them.
	 */
	async appearance( { id = null, timeoutMs = 20000 } = {} ) {

		const person = id ? this.game.crowd.members.get( id ) : this.game.interactor.conversation?.person;
		if ( ! person ) return null;
		const started = performance.now();
		while ( ! id && ! this.#focused( person ) && performance.now() - started < timeoutMs ) await frames( 1 );

		return { crowd: crowdLook( person ), hero: heroLook( this.#focused( person ) ) };

	}

	/** Leaves the open conversation by the chat's own leave button; settles after two frames. */
	async leave() {

		if ( this.game.interactor.conversation ) this.game.view.dialog.leave.click();
		await frames( 2 );

		return { conversation: this.#conversation() };

	}

	/** Says one line in the open conversation; settles once its reply or failure shows. */
	async say( text ) {

		const before = this.#chat().lines.length;
		const started = performance.now();
		await this.game.sayLine( text );
		const chat = this.#chat();
		const added = chat.lines.slice( before );

		return {
			ms: round( performance.now() - started, 0 ),
			reply: added.findLast( ( line ) => line.from === 'npc' )?.text ?? null,
			added, status: chat.status, error: chat.error
		};

	}

	/**
	 * What the game's own NPC voice has done this session (NpcVoice.report):
	 * `{ enabled, status, queued, requested, started, played, bytes, cached,
	 * failed, error }`, once `started` lines have begun to play and `played`
	 * have played to their end, one more line has failed, Voice is found
	 * unavailable or `timeoutMs` has passed. Null without the game's own voice.
	 */
	async voice( { started = 0, played = 0, timeoutMs = 60000 } = {} ) {

		const voice = this.game.voice;
		if ( ! voice ) return null;
		const { failed } = voice.report();
		const settled = ( report ) => report.started >= started && report.played >= played ||
			report.failed > failed || ! [ 'ok', 'unknown' ].includes( report.status );
		const begun = performance.now();
		while ( ! settled( voice.report() ) && performance.now() - begun < timeoutMs ) await frames( 1 );

		return voice.report();

	}

	/**
	 * Clicks the chat action with id `id` (an offer id), as the player would;
	 * settles after two frames with whether it was there, the conversation and
	 * the chat.
	 */
	async act( id ) {

		const button = [ ...this.game.view.dialog.actions.children ].find( ( action ) => action.dataset.action === id );
		button?.click();
		await frames( 2 );

		return { clicked: Boolean( button ), conversation: this.#conversation(), chat: this.#chat() };

	}

	/**
	 * What the open conversation's person offers now, in the chat's order:
	 * `{ offerId, kind, label, available, reason, destination, distance }`,
	 * `destination` `{ name, relation }` and `distance` the straight metres
	 * from the person to it for a lead. Empty without a person to ask.
	 */
	offers() {

		const { companion, npcContinuity, interactor, clock, playerPlaces } = this.game;
		const npcId = interactor.conversation?.npcId;
		if ( ! npcId || ! interactor.conversation.instance ) return [];
		const from = npcContinuity.actor( npcId )?.position ?? null;

		return companion.offers( { npcId, timeMin: clock.timeMin, playerPlaces } ).map( ( offer ) => {

			const where = offer.destination && this.#placeAt( offer.destination.place );
			return {
				offerId: offer.offerId, kind: offer.kind, label: offer.label, available: offer.available, reason: offer.reason ?? null,
				destination: offer.destination ? { name: offer.destination.name, relation: offer.destination.relation } : null,
				distance: where && from ? round( flat( from, where ), 1 ) : null
			};

		} );

	}

	/**
	 * The person walking with the player, or null: `{ npcId, kind, phase,
	 * mode, walk, distance, position, destination }`. `phase` is the
	 * companion's, `mode` and `walk` the continuity's control mode and phase,
	 * `distance` metres from the player's feet and `destination`, for a lead,
	 * `{ name, relation, distance }` with the straight metres from the person.
	 */
	companion() {

		const active = this.game.companion.active;
		if ( ! active ) return null;
		const body = this.game.npcContinuity.companion;
		const at = body?.npcId === active.npcId ? body.position : null;
		const where = active.destination && this.#placeAt( active.destination.place );

		return {
			npcId: active.npcId, kind: active.kind, phase: active.phase,
			mode: at ? body.mode : null, walk: at ? body.phase : null,
			distance: at ? round( spread( this.game.body.feet.toArray(), at ), 2 ) : null,
			position: at ? at.map( ( value ) => round( value, 2 ) ) : null,
			destination: active.destination ? {
				name: active.destination.name, relation: active.destination.relation,
				distance: where && at ? round( flat( at, where ), 1 ) : null
			} : null
		};

	}

	/**
	 * One person as continuity holds them: `{ npcId, id, mode, visible,
	 * position, distance }`, `id` their crowd member, or null when continuity
	 * does not hold them.
	 */
	person( npcId ) {

		const actor = this.game.npcContinuity.actor( npcId );
		if ( ! actor ) return null;

		return {
			npcId, id: this.game.crowd.memberForNpc( npcId )?.id ?? null, mode: actor.mode, visible: actor.visible,
			position: actor.position.map( ( value ) => round( value, 2 ) ),
			distance: round( spread( this.game.body.feet.toArray(), actor.position ), 2 )
		};

	}

	/**
	 * Stands the player on the pavement of the walk graph between `min` and
	 * `max` metres from person `npcId`, a spot a metre apart along its
	 * sidewalks nearest the middle of that band first, aimed at their chest.
	 * After two frames: `{ placed, distance }`.
	 */
	async standAway( npcId, { min = 12, max = 20 } = {} ) {

		const at = this.game.npcContinuity.actor( npcId )?.position;
		if ( ! at ) return { placed: false, distance: null };
		const routes = this.game.npcContinuity.routes;
		const middle = ( min + max ) / 2;
		const spots = [];
		for ( const edge of routes.edges.values() ) {

			if ( edge.kind !== PAVEMENT ) continue;
			for ( let along = 0; along <= edge.length; along += PAVEMENT_STEP ) {

				const { x, y, z } = routes.pointAt( edge, along, 1 );
				const distance = flat( [ x, y, z ], at );
				if ( distance >= min && distance <= max ) spots.push( { x, y, z, off: Math.abs( distance - middle ) } );

			}

		}
		spots.sort( ( a, b ) => a.off - b.off || a.x - b.x || a.z - b.z );
		for ( const { x, y, z } of spots ) {

			const ground = this.#ground( x, y, z );
			if ( ground === null || ! this.game.placePlayer( { x, y: ground + FOOTING, z }, { x: at[ 0 ], y: at[ 1 ] + CHEST, z: at[ 2 ] } ) ) continue;
			await frames( 2 );
			return { placed: true, distance: round( spread( this.game.body.feet.toArray(), at ), 2 ) };

		}

		return { placed: false, distance: null };

	}

	/**
	 * Walks the player behind the companion `npcId` along the path it has
	 * walked, TRAIL_BEHIND metres back, until a conversation opens, the
	 * companion ends or `timeoutMs` passes; each move is `placePlayer`.
	 * Samples `companion()` once a second, with `ms` since the start.
	 * `{ samples, conversation, companion, ms }`.
	 */
	async trail( npcId, { timeoutMs = 360000 } = {} ) {

		const path = [];
		const samples = [];
		const started = performance.now();
		let sampled = - Infinity;
		while ( performance.now() - started < timeoutMs ) {

			await frames( 1 );
			const body = this.game.npcContinuity.companion;
			if ( this.game.interactor.conversation || this.game.companion.active?.npcId !== npcId || body?.npcId !== npcId ) break;
			const at = body.position;
			if ( ! path.length || spread( path.at( - 1 ), at ) >= TRAIL_STEP ) path.push( at );
			const spot = spread( this.game.body.feet.toArray(), at ) > TRAIL_BEHIND + TRAIL_SLACK ? behind( path, TRAIL_BEHIND ) : null;
			const ground = spot ? this.#ground( ...spot ) : null;
			if ( ground !== null ) this.game.placePlayer( { x: spot[ 0 ], y: ground + FOOTING, z: spot[ 2 ] }, { x: at[ 0 ], y: at[ 1 ] + CHEST, z: at[ 2 ] } );
			if ( performance.now() - sampled >= 1000 ) {

				sampled = performance.now();
				samples.push( { ms: round( sampled - started, 0 ), ...this.companion() } );

			}

		}

		return { samples, conversation: this.#conversation(), companion: this.companion(), ms: round( performance.now() - started, 0 ) };

	}

	/** The height of the ground under a point near `y`, within a step of it, or null. */
	#ground( x, y, z ) {

		for ( const [ dx, dz ] of GROUND_PROBES ) {

			const drop = this.#ray( { x: x + dx, y: y + CHEST, z: z + dz }, { x: 0, y: - 1, z: 0 }, CHEST + STEP_HEIGHT );
			if ( drop !== null ) return y + CHEST - drop;

		}

		return null;

	}

	/** Where a companion stops at a place, as `[x, y, z]`, or null. */
	#placeAt( place ) {

		return this.game.companion.places.positions.get( `${place.kind}:${place.id}` ) ?? null;

	}

	/**
	 * Feet for talking to `member`: FACE_DISTANCE away, trying their front first
	 * and then around them, on ground within a step of theirs with nothing
	 * solid between that spot and their body at chest height. Null when no such
	 * spot exists.
	 */
	#spotBeside( member ) {

		const { position, heading = 0 } = member;

		for ( const turn of [ 0, 1, - 1, 2, - 2, 3, - 3, 4 ] ) {

			const angle = heading + turn * Math.PI / 4;
			const x = position.x + Math.sin( angle ) * FACE_DISTANCE;
			const z = position.z + Math.cos( angle ) * FACE_DISTANCE;
			const drop = this.#ray( { x, y: position.y + CHEST, z }, { x: 0, y: - 1, z: 0 }, CHEST + STEP_HEIGHT );
			if ( drop === null || drop < CHEST - STEP_HEIGHT ) continue;
			const ground = position.y + CHEST - drop;
			const reach = Math.hypot( FACE_DISTANCE, position.y - ground );
			const toChest = { x: ( position.x - x ) / reach, y: ( position.y - ground ) / reach, z: ( position.z - z ) / reach };
			if ( this.#ray( { x, y: ground + CHEST, z }, toChest, reach - PERSON_RADIUS ) !== null ) continue;

			return { x, y: ground + FOOTING, z };

		}

		return null;

	}

	/** Metres along a unit ray to the first solid the player does not own, or null; people are sensors and never stop it. */
	#ray( origin, direction, length ) {

		const { physics, body } = this.game;
		const hit = physics.world.castRay(
			new physics.rapier.Ray( origin, direction ), length, true,
			physics.rapier.QueryFilterFlags?.EXCLUDE_SENSORS, undefined, body.collider
		);

		return hit ? hit.timeOfImpact : null;

	}

	#focused( person ) {

		const active = this.game.hero.active;
		const same = active?.person === person || Boolean( person.npcId && active?.person.npcId === person.npcId );

		return same && active.root.visible ? active : null;

	}

	#conversation() {

		const conversation = this.game.interactor.conversation;
		if ( ! conversation ) return null;

		return {
			npcId: conversation.npcId ?? null,
			name: nameOf( conversation.instance ),
			type: conversation.instance?.type ?? null,
			controlled: Boolean( conversation.controlled ),
			person: conversation.person?.id ?? null
		};

	}

	#chat() {

		const dialog = this.game.view.dialog;

		return {
			open: ! dialog.element.hidden,
			lines: [ ...dialog.transcript.children ].map( ( line ) => ( {
				from: line.className.match( /\bis-(\w+)/ )?.[ 1 ] ?? null,
				name: line.firstElementChild?.textContent ?? '',
				text: line.lastElementChild?.textContent ?? '',
				speaking: line.dataset.speaking ?? null
			} ) ),
			actions: [ ...dialog.actions.children ].map( ( action ) => ( { id: action.dataset.action, label: action.textContent } ) ),
			status: dialog.status.textContent,
			error: dialog.feedback.classList.contains( 'is-error' ),
			sending: dialog.input.disabled
		};

	}

}

function personOf( member, feet ) {

	return {
		id: member.id,
		crowdId: member.crowdId ?? null,
		npcId: member.npcId ?? null,
		name: nameOf( member.instance ),
		type: member.type ?? null,
		gender: member.gender ?? null,
		distance: round( member.position.distanceTo( feet ), 2 ),
		position: point( member.position ),
		look: crowdLook( member )
	};

}

/** The body, hairstyle and colours the mass crowd bakes for one member; its hair draw carries the eyebrows. */
function crowdLook( member ) {

	const model = CROWD_MODELS[ member.variant ];
	const look = member.look ?? {};

	return {
		seed: member.appearanceSeed ?? null,
		body: model?.id ?? null,
		hairStyle: model?.hair ?? null,
		...lookValues( { ...look, eyebrows: look.hair } )
	};

}

/**
 * The focused body's model, hairstyles and the look its meshes actually paint
 * with: the outfit when the body wears the dressed surface, the hair tint when
 * every hairstyle mesh, and the eyebrows, wear the dressed hair. The room
 * lighting may wear a copy of a dressed material; the copy paints with the
 * same colour node. A field the body is not dressed with is null.
 */
function heroLook( active ) {

	if ( ! active ) return null;
	const meshes = [];
	active.root.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
	const dressed = active.root.userData.dressed ?? null;
	const worn = dressed?.look ?? {};
	const outfit = Boolean( dressed ) && meshes.some( ( mesh ) => mesh.material.colorNode === dressed.material.colorNode );
	const tints = new Set( [ ...( dressed?.hairs.values() ?? [] ) ].map( ( material ) => material.colorNode ) );
	const tinted = ( eyebrows ) => {

		const hair = meshes.filter( ( mesh ) => mesh.userData.hair && /eyebrows/i.test( mesh.name ) === eyebrows );
		return hair.length > 0 && hair.every( ( mesh ) => tints.has( mesh.material.colorNode ) ) ? worn.hair.value : null;

	};

	return {
		body: active.descriptor.id,
		hairStyle: active.descriptor.hairs.join( '+' ),
		...lookValues( {
			...Object.fromEntries( LOOK_FIELDS.map( ( field ) => [ field, outfit ? worn[ field ]?.value : null ] ) ),
			hair: tinted( false ),
			eyebrows: tinted( true )
		} )
	};

}

function lookValues( look ) {

	return Object.fromEntries( LOOK_FIELDS.map( ( field ) => {

		const value = look[ field ];

		return [ field, value?.isColor ? `#${value.getHexString()}` : typeof value === 'number' ? round( value ) : null ];

	} ) );

}

function targetOf( target ) {

	return target ? { kind: target.kind, person: target.person?.id ?? null } : null;

}

function nameOf( instance ) {

	return instance?.name ? `${instance.name.given} ${instance.name.family}` : null;

}

/** The point `metres` back along a walked path from its end, or its start when it is shorter. */
function behind( path, metres ) {

	let left = metres;
	for ( let at = path.length - 1; at > 0; at -- ) {

		const step = spread( path[ at ], path[ at - 1 ] );
		if ( step >= left ) {

			const t = left / step;
			return path[ at ].map( ( value, axis ) => value + ( path[ at - 1 ][ axis ] - value ) * t );

		}
		left -= step;

	}

	return path[ 0 ] ?? null;

}

function spread( a, b ) {

	return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] );

}

function flat( a, b ) {

	return Math.hypot( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] );

}

function point( vector ) {

	return [ round( vector.x, 2 ), round( vector.y, 2 ), round( vector.z, 2 ) ];

}

function round( value, digits = 3 ) {

	const scale = 10 ** digits;

	return Math.round( value * scale ) / scale;

}

function frames( count ) {

	return new Promise( ( resolve ) => {

		const next = ( left ) => left ? requestAnimationFrame( () => next( left - 1 ) ) : resolve();
		next( count );

	} );

}
