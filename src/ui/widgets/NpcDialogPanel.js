import { el } from '../components/dom.js';

const DAYS = [ 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun' ];

/**
 * Who you are talking to, straight out of the simulation's instantiated NPC:
 * name, type, home, job and the weekly routine, with the entry it is living
 * right now called out. No dialogue yet, so this is the whole conversation.
 */
export class NpcDialogPanel {

	constructor( { onClose } ) {

		this.body = el( 'div', {} );
		this.close = el( 'button', { className: 'hud-npc-close', type: 'button', textContent: 'Close  (E)' } );
		this.close.addEventListener( 'click', onClose );
		this.element = el( 'div', { className: 'hud-npc' }, this.body, this.close );
		this.element.hidden = true;

	}

	show( conversation ) {

		this.element.hidden = ! conversation;

		if ( ! conversation ) return;

		const { instance, behavior } = conversation;
		this.body.replaceChildren();

		if ( ! instance ) {

			this.body.append( el( 'div', { className: 'hud-npc-name', textContent: 'Someone passing by' } ) );

			return;

		}

		this.body.append(
			el( 'div', { className: 'hud-npc-name', textContent: `${instance.name.given} ${instance.name.family}` } ),
			el( 'div', { className: 'hud-npc-type', textContent: instance.type.replace( /_/g, ' ' ) } )
		);

		this.#row( 'npc id', instance.npcId );
		this.#row( 'home', `${instance.home.parcelId} · unit ${instance.home.unit}` );

		if ( instance.job ) {

			this.#row( 'works at', instance.job.parcelId );
			this.#row( 'role', instance.job.role.replace( /_/g, ' ' ) );
			this.#row( 'shift', `${clock( instance.job.shift.startMin )}-${clock( instance.job.shift.endMin )} ${instance.job.shift.kind}` );

		}

		if ( instance.family?.length ) {

			this.#row( 'family', instance.family
				.map( ( member ) => `${member.name.given} (${member.relation})` )
				.join( ', ' ) );

		}

		if ( behavior ) {

			this.body.append( el( 'div', { className: 'hud-npc-section', textContent: 'right now' } ) );
			this.body.append( el( 'div', {
				className: 'hud-npc-now',
				textContent: `${behavior.activity.replace( /_/g, ' ' )} · ${behavior.mode} · ${place( behavior.place )}${behavior.interrupted ? '  (paused for you)' : ''}`
			} ) );

		}

		if ( instance.routine?.length ) {

			this.body.append( el( 'div', { className: 'hud-npc-section', textContent: 'routine' } ) );
			const list = el( 'ul', { className: 'hud-npc-routine' } );

			for ( const entry of instance.routine ) {

				list.append( el( 'li', {
					textContent: `${days( entry.days )} ${clock( entry.startMin )}-${clock( entry.endMin )}  ${entry.activity.replace( /_/g, ' ' )} @ ${place( entry.place )}`
				} ) );

			}

			this.body.append( list );

		}

	}

	#row( key, value ) {

		this.body.append( el( 'div', { className: 'hud-npc-row' },
			el( 'span', { className: 'hud-npc-key', textContent: key } ),
			el( 'span', { className: 'hud-npc-value', textContent: String( value ) } )
		) );

	}

}

function clock( minutes ) {

	const m = ( ( minutes % 1440 ) + 1440 ) % 1440;

	return `${String( Math.floor( m / 60 ) ).padStart( 2, '0' )}:${String( m % 60 ).padStart( 2, '0' )}`;

}

function days( list ) {

	if ( ! list?.length || list.length === 7 ) return 'daily';

	return list.map( ( d ) => DAYS[ d ] ).join( '' );

}

function place( ref ) {

	return ref ? `${ref.kind} ${ref.id}` : 'nowhere';

}
