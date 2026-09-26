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

/**
 * A driver's hands in a read-only preview (`?mode=game&out=...&automation`).
 * It acts only through the player's own paths: placing the body, the E and R
 * presses and the chat line. Every answer is plain JSON.
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

	/** Following a person is not driven yet. */
	follow() {

		return unsupported( 'follow' );

	}

	/** Being led by a person is not driven yet. */
	lead() {

		return unsupported( 'lead' );

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
				text: line.lastElementChild?.textContent ?? ''
			} ) ),
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

function unsupported( scenario ) {

	return { supported: false, reason: `${scenario} is not driven yet` };

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
