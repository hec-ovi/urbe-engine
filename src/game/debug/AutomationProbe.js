import { CROWD_MODELS } from '../agents/CharacterCatalog.js';
import { PERSON_RADIUS } from '../physics/ImpactWorld.js';
import { EYE_HEIGHT, STEP_HEIGHT } from '../physics/PlayerBody.js';
import { CHEST } from '../player/Interactor.js';
import { localToWorld } from '../scenery/StagingAssembler.js';
import { targetKey } from '../quests/QuestActions.js';
import { castIds } from '../quests/QuestCast.js';
import { questCompletion } from '../quests/QuestCompletion.js';
import { completionEvent } from '../quests/QuestEvent.js';
import { stepView } from '../quests/QuestStepView.js';
import { nextQuestWindow } from '../quests/QuestWait.js';

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
/** A visited scene is watched from this far inside its frame's edge, aimed this high over its first element. */
const SCENE_INSET = 0.4;
const SCENE_AIM = 0.3;
/** Steps a live system measures, completed through QuestMechanics as those systems do. */
const MECHANICS = new Set( [ 'assassinate', 'rescue', 'escort', 'access', 'hacking', 'sabotage', 'transportation' ] );
/** Steps done with somebody: the player stands before the first person the step names. */
const WITH_SOMEBODY = new Set( [ 'talk', 'listen', 'steal', 'assassinate', 'rescue', 'escort', 'transportation' ] );
/** Steps whose E stands on a mark at the parcel's door; a mission prop is aimed at from beside it. */
const AT_MARK = new Set( [ 'work', 'deliver', 'pickup', 'access', 'hacking', 'sabotage' ] );
/** Why a step may open by itself: the clock, or its person coming where it happens. */
const WAITABLE = new Set( [ 'outside_window', 'off_duty', 'not_present' ] );
/** A mission prop's collider stands at its focus; the line to it stops this short of it. */
const PROP_MARGIN = 0.3;
/** How far from a mission prop the player tries to stand, nearest first: all well inside the pickup reach. */
const PROP_DISTANCES = [ 1, 1.4, 1.9 ];

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

		const active = this.game.companion.active ?? this.#escort();
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

			if ( ! this.#standOn( [ x, y, z ], chestOf( at ) ) ) continue;
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
			if ( this.game.interactor.conversation || this.companion()?.npcId !== npcId || body?.npcId !== npcId ) break;
			const at = body.position;
			if ( ! path.length || spread( path.at( - 1 ), at ) >= TRAIL_STEP ) path.push( at );
			if ( spread( this.game.body.feet.toArray(), at ) > TRAIL_BEHIND + TRAIL_SLACK ) this.#standOn( behind( path, TRAIL_BEHIND ), chestOf( at ) );
			if ( performance.now() - sampled >= 1000 ) {

				sampled = performance.now();
				samples.push( { ms: round( sampled - started, 0 ), ...this.companion() } );

			}

		}

		return { samples, conversation: this.#conversation(), companion: this.companion(), ms: round( performance.now() - started, 0 ) };

	}

	/**
	 * The quest scenes the game knows, in scene id order: `{ sceneId, questId,
	 * purpose, status, failed, place, frame, elements, standing }`. `status`
	 * is dormant, staged or retired and `failed` the code a scene failed with
	 * for the session, else null. While a scene is staged, `place` is where it
	 * resolved, `frame` `{ kind, origin, width, depth }` its measured frame and
	 * `elements` the ids of the bodies, props and decals it lays out; `standing`
	 * is whether they stand around the player now. `evidence` is the status of
	 * the investigation scene that shows its evidence (`staged` once it stands
	 * with it), or null for a scene with none.
	 */
	scenes() {

		const { scenery, investigations } = this.game;

		return scenery.serialize().flatMap( ( { sceneId } ) => {

			const scene = scenery.sceneFor( sceneId );
			const linked = scene?.spec.investigationSceneId;
			const evidence = linked ? investigations?.scenes.get( linked )?.status ?? null : null;
			return scene ? [ { ...sceneOf( sceneId, scene, scenery.renderer ), evidence } ] : [];

		} );

	}

	/**
	 * Stands the player just inside the edge of staged scene `sceneId`, at
	 * the first of its frame's entries with ground under it, aimed at its
	 * first element, and waits up to `timeoutMs` for the scene to stand
	 * around them. While no entry has ground, as on an indoor floor not yet
	 * loaded, the player stands at the parcel's door and it tries again each
	 * frame; the interior stream loads the floors next to the player's.
	 * After two more frames: `{ placed, standing, shown, target, ms }`,
	 * `shown` the ids of the elements drawn and `target` what E reaches.
	 */
	async visitScene( sceneId, { timeoutMs = 20000 } = {} ) {

		const { scenery, companion } = this.game;
		const scene = scenery.sceneFor( sceneId );
		if ( ! scene ) throw new Error( `no scene ${sceneId}` );
		const started = performance.now();
		const waiting = () => performance.now() - started < timeoutMs;
		const location = scene.status === 'staged' && ! scene.failed ? scene.request.location : null;
		let placed = false;
		if ( location ) {

			const door = location.kind === 'interior' ? companion.places.positions.get( `parcel:${scene.assembly.place.parcelId}` ) ?? null : null;
			const aim = scene.assembly.entities[ 0 ]?.transform.position ?? location.origin;
			const target = { x: aim.x, y: aim.y + SCENE_AIM, z: aim.z };
			let atDoor = ! door;
			while ( ! ( placed = this.#standInFrame( location, target ) ) && waiting() ) {

				atDoor ||= this.#standOn( door, target );
				await frames( 1 );

			}
			while ( placed && ! scenery.renderer.isRealized( sceneId ) && waiting() ) await frames( 1 );
			await frames( 2 );

		}
		const visuals = scenery.renderer.visuals( sceneId );

		return {
			placed,
			standing: scenery.renderer.isRealized( sceneId ),
			shown: elementsOf( scene.assembly ).filter( ( entityId ) => visuals.focus( entityId ) ),
			target: targetOf( this.game.interactor.target ),
			ms: round( performance.now() - started, 0 )
		};

	}

	/**
	 * One questline as it stands, the main story unless `questId` names
	 * another: its state and ending, completed steps, flags, items held, every
	 * active step in definition order, the objective with the walk to it from
	 * the player's feet, and its scenes. A questline the cast could not fill
	 * is `blocked` with its reason as `note`. Null when there is none.
	 */
	quest( questId = null ) {

		const { quests, questGameplay, clock } = this.game;
		const entry = this.#questEntry( questId );
		if ( ! entry ) {

			const blocked = quests.blocked.find( ( quest ) => ! questId || quest.id === questId );
			return blocked ? { questId: blocked.id, title: blocked.title, state: 'blocked', note: blocked.reason } : null;

		}
		const { definition, runtime } = entry;
		const { timeMin } = clock;
		const saved = runtime.serialize();
		const ending = runtime.ending();
		const objective = questGameplay.objective( timeMin, definition.id );

		return {
			questId: definition.id, title: definition.title,
			state: quests.view( timeMin ).find( ( quest ) => quest.id === definition.id ).state,
			ending: ending ? { endingId: ending.endingId, title: ending.title } : null,
			completed: [ ...saved.completedStepIds ], flags: [ ...saved.flags ], inventory: [ ...runtime.inventory() ],
			active: activeSteps( entry ).map( ( step ) => this.#stepOf( entry, step, timeMin ) ),
			objective: objective?.questId === definition.id ? {
				stepId: objective.stepId, kind: objective.kind, text: objective.text, venue: objective.venue,
				place: objective.place && this.#placeOf( objective.place ),
				availability: objective.availability, route: this.#route( objective.guidance )
			} : null,
			scenes: this.scenes().filter( ( scene ) => scene.questId === definition.id )
				.map( ( { sceneId, status, failed } ) => ( { sceneId, status, failed } ) )
		};

	}

	/**
	 * Makes active step `stepId` open, as a player would by waiting and going
	 * there: while its hour or its person's hours keep it shut, the clock waits
	 * for the next opening through the journal's own wait (`waitUntil`), and a
	 * step with an appointment (a talk or listen at its parcel, an escort from
	 * one) has the player stand at that door, where the story posts its
	 * people, until they are present or `timeoutMs` passes.
	 * `{ available, reason, waited, ms }`, `waited` `{ from, to, label }` or null.
	 */
	async ready( { questId = null, stepId, timeoutMs = 20000 } = {} ) {

		const { entry, step } = this.#activeStep( questId, stepId );
		const { runtime } = entry;
		const started = performance.now();
		const gate = () => runtime.stepAvailability( stepId, this.game.clock.timeMin );
		const venue = appointmentOf( step.target );
		let now = gate();
		let waited = null;
		const placement = venue && ! now.available && this.game.quests.placement( entry.definition.id, stepId, this.game.clock.timeMin );
		if ( placement && ! placement.available && placement.reason !== 'outside_window' ) now = placement;
		if ( ! now.available && WAITABLE.has( now.reason ) ) {

			const timeMin = this.game.clock.timeMin;
			// The story posts a venue's people whenever the hour its text names
			// is open; anybody else keeps their own hours where the step happens.
			const windows = venue ? [ step.window ].filter( Boolean ) : runtime.windows( stepId ) ?? [];
			const due = placement?.available ? null : windows.map( ( window ) => nextQuestWindow( window, timeMin ) ).filter( Boolean )
				.sort( ( a, b ) => a.timeMin - b.timeMin )[ 0 ];
			if ( due && this.game.waitUntil( due.timeMin ) ) waited = { from: timeMin, to: due.timeMin, label: due.label };
			if ( venue ) {

				await this.visit( { kind: 'parcel', id: venue } );
				while ( ! ( now = gate() ).available && WAITABLE.has( now.reason ) && performance.now() - started < timeoutMs ) await frames( 1 );

			}
			now = gate();

		}

		return { available: now.available, reason: now.reason ?? null, waited, ms: round( performance.now() - started, 0 ) };

	}

	/**
	 * Stands the player at a place `{ kind, id }`: a parcel's door, just
	 * inside where it has one, a station or stop, or the door nearest the
	 * player inside a district, and waits up to `timeoutMs` for the room at a
	 * parcel with an interior. After two frames: `{ placed, places, room }`,
	 * `places` the quest places the player stands in and `room` the parcel of
	 * the room they stand in, or null.
	 */
	async visit( { kind, id }, { timeoutMs = 10000 } = {} ) {

		const door = kind === 'district' ? this.#doorIn( id ) : this.#placeAt( continuityPlace( kind, id ) );
		const placed = Boolean( door ) && this.#standOn( door );
		const started = performance.now();
		if ( placed && kind === 'parcel' && this.#interior( id ) ) {

			while ( this.game.standing?.parcelId !== id && performance.now() - started < timeoutMs ) await frames( 1 );

		}
		await frames( 2 );

		return { placed, places: this.game.playerPlaces ?? [], room: this.game.standing?.parcelId ?? null };

	}

	/**
	 * Stands the player where E does active step `stepId`: before the first
	 * person it names (at its venue, else where continuity has them), beside a
	 * mission prop or on the mark at the parcel's door, at the approach of a
	 * staged scene's evidence aimed at it, or at the place a go or observe step
	 * names. After two frames: `{ placed, place, member, target, offered, ms }`,
	 * `member` the crowd member stood before and `offered` whether E now does
	 * the step: talks to its person, or takes its quest or evidence target.
	 */
	async reach( { questId = null, stepId, timeoutMs = 20000 } = {} ) {

		const { entry, step } = this.#activeStep( questId, stepId );
		const { definition, runtime } = entry;
		const { kind } = step.target;
		const started = performance.now();
		const waiting = () => performance.now() - started < timeoutMs;
		const place = runtime.stepPlace( stepId, this.game.clock.timeMin ) ?? null;
		let key = targetKey( definition.id, stepId );
		let placed = false;
		let member = null;
		const there = place && [ 'parcel', 'station', 'stop', 'district' ].includes( place.kind ) ? await this.visit( place ) : null;

		if ( kind === 'investigation' ) {

			const scene = this.#evidenceScene( definition.id, stepId );
			let evidence = null;
			let shown = null;
			while ( scene && ! shown?.visible && waiting() ) {

				evidence = scene.status === 'staged' ? scene.runtime.targets( { state: scene.state } )
					.find( ( target ) => target.evidenceId === step.target.evidenceId ) : null;
				shown = evidence && scene.visuals.focus( evidence.entityId );
				if ( ! shown?.visible ) await frames( 1 );

			}
			if ( shown?.visible ) {

				key = evidence.targetKey;
				const { x, y, z } = evidence.approachPoint;
				while ( ! ( placed = this.#standOn( [ x, y, z ], shown.position ) ) && waiting() ) await frames( 1 );

			}

		} else if ( WITH_SOMEBODY.has( kind ) ) {

			const npcId = castIds( step.target, runtime )[ 0 ];
			const at = ! there?.placed && this.game.npcContinuity.actor( npcId )?.position;
			if ( at ) this.#standOn( at, chestOf( at ) );
			while ( ! ( member = this.game.crowd.memberForNpc( npcId ) ?? null ) && waiting() ) await frames( 1 );
			if ( member ) placed = ( await this.approach( member.id ) ).placed;

		} else if ( AT_MARK.has( kind ) ) {

			let mark = null;
			while ( ! ( mark = this.game.questGameplay.staticMarks.get( key ) ) && waiting() ) await frames( 1 );
			const focus = mark?.userData.focusPoint;
			if ( ! focus ) placed = Boolean( mark ) && this.#standOn( mark.position.toArray() );
			// A prop is taken from wherever the eye sees it: each spot around it in turn, until E takes it.
			else for ( const spot of this.#spots( { position: mark.position }, focus, PROP_MARGIN, PROP_DISTANCES, EYE_HEIGHT ) ) {

				if ( ! this.game.placePlayer( spot, focus ) ) continue;
				placed = true;
				await frames( 2 );
				if ( targetOf( this.game.interactor.target )?.key === key ) break;

			}

		} else placed = Boolean( there?.placed );

		await frames( 2 );
		const target = targetOf( this.game.interactor.target );

		return {
			placed, place, member: member?.id ?? null, target,
			offered: kind === 'talk' ? Boolean( member ) && target?.person === member.id : target?.key === key,
			ms: round( performance.now() - started, 0 )
		};

	}

	/** Clicks the chat reply that reads `text`, as the player would; settles after two frames. */
	async choose( text ) {

		const button = [ ...this.game.view.dialog.choices.children ]
			.find( ( choice ) => choice.firstElementChild?.textContent === text && ! choice.disabled );
		button?.click();
		await frames( 2 );

		return { clicked: Boolean( button ), conversation: this.#conversation(), chat: this.#chat() };

	}

	/**
	 * Fast-forwards a questline, the main story unless `questId` names
	 * another: completes its active steps one at a time, the first in
	 * definition order or the one `branch` names (a step id or a list), until
	 * `steps` are done (1 without `toStepId`), `toStepId` is active or done,
	 * the story ends, or a step cannot complete. Each step is made ready as
	 * `ready` does, then completed by the event its live host sends, through
	 * the runtime's own gates and effects: an authored talk by its first
	 * committing reply, a measured mechanic through QuestMechanics, anything
	 * else through the session; the game takes the result as it takes a
	 * player's. A scene's evidence state stays as it was.
	 * `{ questId, completed: [{ stepId, kind, ok, reason, waited }], stopped, quest }`,
	 * `stopped` one of `count`, `reached`, `passed`, `ended`, `rejected`.
	 */
	async advance( { questId = null, toStepId = null, steps = null, branch = null, timeoutMs = 20000 } = {} ) {

		const entry = this.#questEntry( questId );
		if ( ! entry ) throw new Error( questId ? `no questline ${questId} in play` : 'no questline in play' );
		const limit = steps ?? ( toStepId ? Infinity : 1 );
		const branches = [ branch ].flat();
		const completed = [];
		let stopped = null;
		while ( ! stopped ) {

			const active = activeSteps( entry );
			if ( entry.runtime.ending() ) stopped = 'ended';
			else if ( toStepId && active.some( ( step ) => step.stepId === toStepId ) ) stopped = 'reached';
			else if ( toStepId && entry.runtime.serialize().completedStepIds.includes( toStepId ) ) stopped = 'passed';
			else if ( completed.length >= limit ) stopped = 'count';
			else {

				const step = active.find( ( candidate ) => branches.includes( candidate.stepId ) ) ?? active[ 0 ];
				completed.push( await this.#complete( entry, step, timeoutMs ) );
				if ( ! completed.at( - 1 ).ok ) stopped = 'rejected';

			}

		}

		return { questId: entry.definition.id, completed, stopped, quest: this.quest( entry.definition.id ) };

	}

	/** Readies one active step and completes it through the event its live host sends; what came of it. */
	async #complete( entry, step, timeoutMs ) {

		const { definition, runtime } = entry;
		const { stepId, target } = step;
		const questId = definition.id;
		const ready = await this.ready( { questId, stepId, timeoutMs } );
		const outcome = { stepId, kind: target.kind, ok: false, reason: ready.reason, waited: ready.waited };
		if ( ! ready.available ) return outcome;
		const { quests, questGameplay } = this.game;
		const timeMin = this.game.clock.timeMin;
		const actorIds = castIds( target, runtime );
		const done = ( changes ) => ( {
			ok: true, progressed: true, message: step.narrative.description,
			completed: changes.map( ( change ) => questCompletion( change, quests.view( timeMin ) ) )
		} );
		let result;
		if ( target.kind === 'talk' && step.dialogue ) {

			const choice = step.dialogue.choices.find( ( candidate ) => candidate.completesStep );
			const chosen = quests.chooseDialogue( questId, stepId, actorIds[ 0 ], choice.id, timeMin );
			result = chosen.change ? done( [ chosen.change ] ) : { ok: false, code: chosen.availability?.reason ?? chosen.reason };

		} else if ( MECHANICS.has( target.kind ) ) {

			result = questGameplay.mechanics.complete( { questId, stepId, timeMin, event: completionEvent( target, actorIds ) } );

		} else {

			const moved = quests.advanceFor( questId, completionEvent( target, actorIds ), timeMin );
			result = moved.length ? done( moved ) : { ok: false, code: 'runtime_rejected' };

		}
		if ( result.ok ) this.game.questActionResult( result );
		await frames( 2 );

		return { ...outcome, ok: result.ok, reason: result.ok ? null : result.code ?? result.message };

	}

	/** The questline `questId` names, else the main story; null when it is not in play. */
	#questEntry( questId ) {

		const { entries } = this.game.quests;
		return questId ? entries.find( ( entry ) => entry.definition.id === questId ) ?? null : entries[ 0 ] ?? null;

	}

	#activeStep( questId, stepId ) {

		const entry = this.#questEntry( questId );
		const step = entry && activeSteps( entry ).find( ( candidate ) => candidate.stepId === stepId );
		if ( ! step ) throw new Error( `no active step ${stepId} in ${entry?.definition.id ?? questId ?? 'the story'}` );

		return { entry, step };

	}

	/** One active step as the journal reads it, with who it names and, for a talk, its replies. */
	#stepOf( { definition, runtime }, step, timeMin ) {

		const view = stepView( { step, runtime, sim: this.game.sim, timeMin } );
		const { target } = step;

		return {
			stepId: step.stepId, kind: target.kind, text: view.text, targetKey: targetKey( definition.id, step.stepId ),
			place: view.place && { ...this.#placeOf( view.place ), name: view.place.name },
			cast: castIds( target, runtime ).map( ( npcId ) => this.#castOf( npcId ) ),
			availability: { available: view.availability.available, reason: view.availability.reason ?? null },
			window: view.window, wait: view.wait ?? null,
			choices: step.dialogue?.choices.map( ( { id, text, completesStep } ) => ( { id, text, completesStep } ) ) ?? null,
			...( target.kind === 'investigation' ? { sceneId: target.sceneId, evidenceId: target.evidenceId } : {} )
		};

	}

	/** One cast person: the story's name for them, whether they are dead and their crowd member now. */
	#castOf( npcId ) {

		const npc = this.game.sim.getNPC( npcId );
		const name = this.game.quests.characterName( npcId ) ?? npc.name;

		return { npcId, name: `${name.given} ${name.family}`, dead: Boolean( npc.flags?.dead ), member: this.game.crowd.memberForNpc( npcId )?.id ?? null };

	}

	/** A place and whether the world has it; a parcel also says whether its interior is open. */
	#placeOf( { kind, id } ) {

		const { locator } = this.game;
		const exists = kind === 'parcel' ? locator.parcelById.has( id )
			: kind === 'district' ? locator.districts.some( ( district ) => district.id === id )
			: Boolean( this.#placeAt( continuityPlace( kind, id ) ) );

		return { kind, id, exists, ...( kind === 'parcel' ? { interior: this.#interior( id ) } : {} ) };

	}

	/** The objective's walk from the player's feet over the walk graph: `{ metres, reason }`. */
	#route( guidance ) {

		if ( ! guidance?.destination ) return { metres: null, reason: guidance?.reason ?? null };
		try {

			const route = this.game.objectiveGuide.router.route( { from: this.game.body.feet.toArray(), destination: guidance.destination } );
			return { metres: round( route.distanceMeters, 0 ), reason: null };

		} catch ( error ) {

			return { metres: null, reason: error.code ?? error.message };

		}

	}

	/** Whether the parcel's interior is open to the player. */
	#interior( parcelId ) {

		const { stream } = this.game;
		return Boolean( stream?.pending.has( parcelId ) || stream?.live.has( parcelId ) );

	}

	/** The door nearest the player among the places inside district `id`, or null. */
	#doorIn( id ) {

		const { locator, body, companion } = this.game;
		let best = null;
		for ( const [ key, position ] of companion.places.positions ) {

			if ( ! key.startsWith( 'parcel:' ) ) continue;
			const [ x, , z ] = position;
			if ( ! locator.refs( x, z ).some( ( place ) => place.kind === 'district' && place.id === id ) ) continue;
			const distance = Math.hypot( x - body.feet.x, z - body.feet.z );
			if ( ! best || distance < best.distance ) best = { position, distance };

		}

		return best?.position ?? null;

	}

	/** The investigation scene whose evidence completes this step, or null. */
	#evidenceScene( questId, stepId ) {

		return [ ...this.game.investigations.scenes.values() ].find( ( scene ) => scene.request.questId === questId
			&& scene.request.questBindings.some( ( binding ) => binding.stepId === stepId ) ) ?? null;

	}

	/** The quest escort under way, as a companion of kind `escort` bound for its step's `to`. */
	#escort() {

		const escort = this.game.questGameplay?.escort?.target;
		if ( ! escort ) return null;
		const { to } = escort.target;
		const place = to.parcelId ? { kind: 'parcel', id: to.parcelId } : { kind: 'stop', id: to.stationId ?? to.stopId };

		return { npcId: escort.actorIds[ 0 ], kind: 'escort', phase: null, destination: { place, name: to.name, relation: 'quest' } };

	}

	/** Stands the player at the first frame entry, moved in from the edge, that has ground under it; whether one had. */
	#standInFrame( location, target ) {

		for ( const { position } of location.entries ) {

			const reach = Math.hypot( position.x, position.z );
			const inward = reach > SCENE_INSET ? 1 - SCENE_INSET / reach : 0;
			const spot = localToWorld( location, { x: position.x * inward, z: position.z * inward } );
			if ( this.#standOn( [ spot.x, location.origin.y, spot.z ], target ) ) return true;

		}

		return false;

	}

	/** Stands the player on the ground within a step of `[x, y, z]`, aimed at `target`; whether there was ground. */
	#standOn( [ x, y, z ], target ) {

		const ground = this.#ground( x, y, z );
		return ground !== null && this.game.placePlayer( { x, y: ground + FOOTING, z }, target );

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

		const { x, y, z } = member.position;
		return this.#spots( member, chestOf( [ x, y, z ] ), PERSON_RADIUS, [ FACE_DISTANCE ], CHEST ).next().value ?? null;

	}

	/**
	 * Feet around what stands at `position`, each of `distances` away and
	 * its front first (`heading`), then around it: on ground within a step of
	 * its own, with nothing solid between `height` over that ground and `aim`
	 * short of `margin` from it.
	 */
	*#spots( { position, heading = 0 }, aim, margin, distances, height ) {

		for ( const distance of distances ) for ( const turn of [ 0, 1, - 1, 2, - 2, 3, - 3, 4 ] ) {

			const angle = heading + turn * Math.PI / 4;
			const x = position.x + Math.sin( angle ) * distance;
			const z = position.z + Math.cos( angle ) * distance;
			const drop = this.#ray( { x, y: position.y + CHEST, z }, { x: 0, y: - 1, z: 0 }, CHEST + STEP_HEIGHT );
			if ( drop === null || drop < CHEST - STEP_HEIGHT ) continue;
			const ground = position.y + CHEST - drop;
			const eye = { x, y: ground + height, z };
			const reach = Math.hypot( aim.x - x, aim.y - eye.y, aim.z - z );
			const toAim = { x: ( aim.x - x ) / reach, y: ( aim.y - eye.y ) / reach, z: ( aim.z - z ) / reach };
			if ( this.#ray( eye, toAim, reach - margin ) !== null ) continue;

			yield { x, y: ground + FOOTING, z };

		}

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
			story: dialog.story.hidden ? null : {
				title: dialog.story.querySelector( '.chat-quest-title' )?.textContent ?? null,
				objective: dialog.story.querySelector( '.chat-quest-objective' )?.textContent ?? null
			},
			choices: [ ...dialog.choices.children ].map( ( choice ) => ( { text: choice.firstElementChild?.textContent ?? '', disabled: choice.disabled } ) ),
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

/** One scene as the director holds it, in plain JSON. */
function sceneOf( sceneId, { spec, status, failed, resolved, assembly }, renderer ) {

	const frame = assembly?.frame;

	return {
		sceneId, questId: spec.questId, purpose: spec.purpose, status, failed,
		place: resolved ? { ...resolved.place } : null,
		frame: frame ? { kind: frame.kind, origin: point( frame.origin ), width: frame.width, depth: frame.depth } : null,
		elements: elementsOf( assembly ),
		standing: renderer.isRealized( sceneId )
	};

}

/** The ids of a staged scene's bodies, props and decals, or none. */
function elementsOf( assembly ) {

	return assembly ? [ ...assembly.entities, ...assembly.decals ].map( ( element ) => element.entityId ) : [];

}

/** What E reaches: its kind, the crowd member it talks to and the quest or evidence target key it takes. */
function targetOf( target ) {

	return target ? { kind: target.kind, person: target.person?.id ?? null, key: target.interaction?.targetKey ?? null } : null;

}

/** The parcel where the story posts a step's people: a talk's or listen's, or where an escort sets out; else null. */
function appointmentOf( target ) {

	if ( target.kind === 'talk' || target.kind === 'listen' ) return target.atParcelId ?? null;
	return target.kind === 'escort' ? target.from.parcelId ?? null : null;

}

/** A place as continuity keys it: a station is walked to as its stop. */
function continuityPlace( kind, id ) {

	return { kind: kind === 'station' ? 'stop' : kind, id };

}

/** A questline's active steps in definition order. */
function activeSteps( { definition, runtime } ) {

	const active = new Set( runtime.activeSteps().map( ( step ) => step.stepId ) );
	return definition.steps.filter( ( step ) => active.has( step.stepId ) );

}

function nameOf( instance ) {

	return instance?.name ? `${instance.name.given} ${instance.name.family}` : null;

}

/** The chest of a person standing at `[x, y, z]`, as a crosshair target. */
function chestOf( [ x, y, z ] ) {

	return { x, y: y + CHEST, z };

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
