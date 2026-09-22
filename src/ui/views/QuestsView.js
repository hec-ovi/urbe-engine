import { el } from '../components/dom.js';
import { emptyState } from '../components/EmptyState.js';
import { PanelHeader } from '../components/PanelHeader.js';

/**
 * The quest log: every quest on the left, the picked one with its steps on
 * the right. Reading a quest is separate from following it on the HUD.
 * props: { onClose, onSelect, onTrack, onWait }
 */
export class QuestsView {

	constructor( { onClose, onSelect = () => {}, onTrack = () => {}, onWait = () => {} } = {} ) {

		this.quests = [];
		this.selected = null;
		this.tracked = null;
		this.trackedStepId = null;
		this.onSelect = onSelect;
		this.onTrack = onTrack;
		this.onWait = onWait;

		this.list = el( 'ul', { className: 'list' } );
		this.side = el( 'div', { className: 'view-side' }, this.list );
		this.main = el( 'div', { className: 'view-main' } );
		this.header = new PanelHeader( { title: 'Quests', key: 'J', onClose } );
		this.element = el( 'div', { className: 'view view-quests' },
			this.header.element,
			el( 'div', { className: 'view-body' }, this.side, this.main )
		);

		this.setQuests( [] );

	}

	/**
	 * @param quests [{ id, title, text, note, state: 'available' | 'active' | 'blocked' | 'done' | 'failed',
	 * steps: [{ text, done, npcName, place, availability, window, wait?: { timeMin, label } }] }]
	 */
	setQuests( quests = [] ) {

		const focused = this.element.contains( document.activeElement ) ? document.activeElement : null;
		const focusLabel = focused?.getAttribute( 'aria-label' ) ?? focused?.textContent;
		this.quests = quests;
		const trackedQuest = quests.find( ( quest ) => quest.id === this.tracked );
		if ( ! canFollow( trackedQuest ) ) this.tracked = null;
		if ( ! this.tracked || ! canRetainStep( trackedQuest?.steps?.find( ( step ) => step.stepId === this.trackedStepId ) ) ) this.trackedStepId = null;
		this.#renderList();
		this.select( quests.some( ( q ) => q.id === this.selected ) ? this.selected : quests[ 0 ]?.id ?? null );
		if ( focused ) {
			const next = [ ...this.element.querySelectorAll( 'button:not(:disabled)' ) ]
				.find( node => ( node.getAttribute( 'aria-label' ) ?? node.textContent ) === focusLabel );
			( next ?? this.header.close ).focus();
		}

	}

	/** The game reports the quest and optional specific lead followed by its HUD and map. */
	setTrackedQuest( id, stepId = null ) {

		const quest = this.quests.find( ( quest ) => quest.id === id );
		const tracked = canFollow( quest ) ? id : null;
		const trackedStepId = tracked && canRetainStep( quest.steps?.find( ( step ) => step.stepId === stepId ) ) ? stepId : null;
		if ( tracked === this.tracked && trackedStepId === this.trackedStepId ) return;
		this.tracked = tracked;
		this.trackedStepId = trackedStepId;
		this.#renderList();
		this.select( this.selected );

	}

	#renderList() {

		this.list.replaceChildren( ...this.quests.map( ( quest ) => {

			const row = el( 'li', {}, el( 'button', { className: 'list-row', type: 'button' },
				el( 'span', { className: 'quest-list-title', textContent: quest.title } ),
				el( 'span', { className: 'quest-list-badges' },
					el( 'span', { className: `badge is-${quest.state ?? 'active'}`, textContent: statusText( quest.state ) } ),
					...( this.tracked === quest.id ? [ el( 'span', { className: 'quest-following', textContent: 'Following' } ) ] : [] )
				)
			) );
			row.firstChild.addEventListener( 'click', () => {

				this.select( quest.id );
				this.onSelect( quest.id );

			} );

			return row;

		} ) );

		if ( ! this.quests.length ) this.list.append( el( 'li', {}, emptyState( 'no quest yet' ) ) );

	}

	select( id ) {

		this.selected = id;
		const quest = this.quests.find( ( q ) => q.id === id );

		this.list.querySelectorAll( '.list-row' ).forEach( ( row, i ) => {

			const active = this.quests[ i ]?.id === id;
			row.classList.toggle( 'is-active', active );
			row.setAttribute( 'aria-pressed', String( active ) );

		} );

		if ( ! quest ) {

			this.main.replaceChildren( emptyState( 'ask around: somebody in the city has work for you' ) );

			return;

		}

		const following = this.tracked === quest.id;
		const followingQuest = following && this.trackedStepId === null;
		const track = el( 'button', {
			className: `hud-button quest-track${followingQuest ? '' : ' is-primary'}`, type: 'button',
			textContent: followingQuest ? 'Following' : 'Follow quest', ariaPressed: String( followingQuest )
		} );
		track.addEventListener( 'click', () => {

			if ( ! canFollow( quest ) || this.tracked === quest.id && this.trackedStepId === null ) return;
			this.setTrackedQuest( quest.id );
			this.onTrack( quest.id );
			this.main.querySelector( '.quest-track' )?.focus();

		} );
		const steps = quest.steps ?? [];
		const current = steps.filter( ( step ) => ! step.done && step.state !== 'cancelled' );
		const history = steps.filter( ( step ) => step.done || step.state === 'cancelled' );
		const endings = current.filter( ( step ) => step.endingId );
		const alternatives = endings.length > 1;
		const ordinary = alternatives ? current.filter( ( step ) => ! step.endingId ) : current;
		const waiting = {
			enabled: canFollow( quest ),
			onWait: ( step ) => {

				if ( canFollow( quest ) && canWaitStep( step ) ) this.onWait( quest.id, step.stepId );

			}
		};
		const historyDetails = el( 'details', { className: 'quest-history', open: current.length === 0 },
			el( 'summary', { textContent: `Quest history (${history.length})` } ),
			el( 'ul', { className: 'quest-steps' }, ...history.map( ( step ) => stepRow( step ) ) )
		);
		const premise = el( 'details', { className: 'quest-history quest-premise', open: current.length === 0 },
			el( 'summary', { textContent: quest.state === 'done' ? 'Outcome' : 'About this quest' } ),
			el( 'p', { className: 'detail-text', textContent: quest.text ?? '' } )
		);

		this.main.replaceChildren(
			el( 'h3', { className: 'detail-title', textContent: quest.title } ),
			el( 'div', { className: 'quest-detail-status' },
				el( 'span', { className: 'detail-kind', textContent: statusText( quest.state ) } ),
				...( canFollow( quest ) ? [ track ] : [] )
			),
			...( canFollow( quest ) ? [ el( 'p', { className: 'quest-tracking-note', textContent: following
				? 'This quest is followed on your HUD and map.'
				: 'Follow this quest to show its objective on your HUD and map.' } ) ] : [] ),
			...( quest.note ? [ el( 'p', { className: 'detail-note', textContent: quest.note } ) ] : [] ),
			...( ordinary.length ? [
				el( 'h4', { className: 'quest-section-title', textContent: 'Current objectives' } ),
				el( 'ul', { className: 'quest-steps' }, ...ordinary.map( ( step ) => stepRow( step, false, null, waiting ) ) )
			] : [] ),
			...( alternatives ? [ endingChoices( endings, {
				enabled: canFollow( quest ), stepId: following ? this.trackedStepId : null,
				onTrack: ( step ) => {

					if ( ! canFollow( quest ) || ! canFollowStep( step ) ) return;
					if ( this.tracked === quest.id && this.trackedStepId === step.stepId ) return;
					this.setTrackedQuest( quest.id, step.stepId );
					this.onTrack( quest.id, step.stepId );
					this.main.querySelector( '.quest-lead-track[aria-pressed="true"]' )?.focus();

				}
			}, waiting ) ] : [] ),
			...( quest.text ? [ premise ] : [] ),
			...( history.length ? [ historyDetails ] : [] )
		);

	}

}

/** One step: what to do, who it is about and where, and why it is closed now. */
function stepRow( step, alternative = false, tracking = null, waiting = null ) {

	const meta = [ step.npcName, step.place?.name ].filter( Boolean ).join( ' - ' );
	const state = step.state ?? ( step.done ? 'done' : step.availability?.available === false ? 'locked' : 'active' );
	const closed = state === 'locked';
	const hours = hoursLine( step.window );
	const following = tracking?.stepId === step.stepId && Boolean( step.stepId );
	const track = tracking ? el( 'button', {
		className: 'hud-button quest-lead-track', type: 'button',
		textContent: following ? 'Following this lead' : 'Follow this lead', ariaPressed: String( following ),
		disabled: ! tracking.enabled || ! canFollowStep( step )
	} ) : null;
	if ( track ) {

		track.setAttribute( 'aria-label', `${following ? 'Following this lead' : 'Follow this lead'}: ${step.endingTitle || step.text}` );
		track.addEventListener( 'click', () => tracking.onTrack( step ) );

	}
	const wait = waiting?.enabled && canWaitStep( step ) ? el( 'button', {
		className: 'hud-button quest-wait', type: 'button', textContent: `Wait until ${step.wait.label}`
	} ) : null;
	if ( wait ) wait.addEventListener( 'click', () => waiting.onWait( step ) );

	return el( 'li', { className: `quest-step is-${state}${closed ? ' is-closed' : ''}${alternative ? ' is-alternative' : ''}${following ? ' is-followed' : ''}` },
		el( 'span', { className: 'quest-step-mark', textContent: state === 'done' ? '✓' : state === 'cancelled' ? '−' : '' } ),
		el( 'span', { className: 'quest-step-body' },
			el( 'span', { className: 'quest-step-state', textContent: { active: 'Current', locked: 'Unavailable', done: 'Completed', cancelled: 'Cancelled' }[ state ] } ),
			...( alternative && step.endingTitle ? [ el( 'strong', { className: 'quest-ending-title', textContent: step.endingTitle } ) ] : [] ),
			el( 'span', { textContent: step.text } ),
			...( meta ? [ el( 'span', { className: 'quest-step-meta', textContent: meta } ) ] : [] ),
			...( alternative && step.stake ? [ el( 'span', { className: 'quest-step-stake', textContent: step.stake } ) ] : [] ),
			...( alternative && step.commitment ? [ el( 'span', { className: 'quest-step-commitment', textContent: `Commit by choosing: “${step.commitment}”` } ) ] : [] ),
			...( track ? [ track ] : [] ),
			...( closed ? [ el( 'span', { className: 'quest-step-closed', textContent: step.availability?.text || 'This objective is unavailable right now.' } ) ] : [] ),
			...( wait ? [ wait, el( 'span', { className: 'quest-wait-note', textContent: 'Advances the world clock; quest progress is unchanged.' } ) ] : [] ),
			...( state === 'cancelled' ? [ el( 'span', { className: 'quest-step-meta', textContent: 'This path closed when the quest ended.' } ) ] : [] ),
			...( hours ? [ el( 'span', { className: 'quest-step-meta', textContent: hours } ) ] : [] )
		)
	);

}

function endingChoices( steps, tracking, waiting ) {

	return el( 'section', { className: 'quest-endings' },
		el( 'h4', { className: 'quest-section-title', textContent: 'Choose how this ends' } ),
		el( 'p', { className: 'quest-choice-summary', textContent: steps.map( ( step ) => step.endingTitle || step.text ).join( ' OR ' ) } ),
		el( 'p', { className: 'quest-choice-note', textContent: 'These are alternatives. Committing to one ending closes the other paths.' } ),
		el( 'p', { className: 'quest-tracking-note', textContent: 'Follow a lead to mark its destination. Your decision happens in the conversation.' } ),
		el( 'ul', { className: 'quest-steps quest-alternatives' }, ...steps.flatMap( ( step, index ) => [
			...( index ? [ el( 'li', { className: 'quest-or', textContent: 'OR', ariaHidden: 'true', role: 'presentation' } ) ] : [] ),
			stepRow( step, true, tracking, waiting )
		] ) )
	);

}

function canFollow( quest ) {

	return Boolean( quest && [ 'active', 'available' ].includes( quest.state ?? 'active' ) );

}

function canFollowStep( step ) {

	// Tracking is navigation, not acceptance: a person may only materialize
	// once the player approaches, and a timed venue can still be visited.
	return canRetainStep( step );

}

function canRetainStep( step ) {

	return Boolean( step?.stepId && ! step.done && ( step.state === undefined || [ 'active', 'locked' ].includes( step.state ) ) );

}

function canWaitStep( step ) {

	return canRetainStep( step ) && step.availability?.available === false && step.availability.reason === 'outside_window'
		&& Number.isFinite( step.wait?.timeMin ) && Boolean( step.wait?.label?.trim?.() );

}

function statusText( state = 'active' ) {

	return { available: 'available', active: 'in progress', blocked: 'unavailable', done: 'completed', failed: 'failed' }[ state ] ?? state;

}

/** "Open during the slow hour, 18:00 to 23:00": the step's own words, and the clock. */
function hoursLine( window ) {

	const label = window?.label?.trim?.() || '';
	if ( ! label || ! Number.isFinite( window.startMin ) || ! Number.isFinite( window.endMin ) ) return '';
	return `Open ${label}, ${clock( window.startMin )} to ${clock( window.endMin )}`;

}

function clock( minuteOfDay ) {

	const hours = Math.floor( minuteOfDay / 60 ) % 24;
	return `${String( hours ).padStart( 2, '0' )}:${String( minuteOfDay % 60 ).padStart( 2, '0' )}`;

}
