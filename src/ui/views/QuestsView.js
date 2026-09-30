import { el } from '../components/dom.js';
import { emptyState } from '../components/EmptyState.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { prose } from '../components/Prose.js';
import { questKind } from '../components/QuestMark.js';
import labels from './quests-layout.json' with { type: 'json' };

/** Quests still open, and the finished ones: the journal's two lists. */
const FINISHED = new Set( [ 'done', 'failed' ] );

/**
 * The journal: the threads of the open or the finished quests on the left,
 * each numbered with its main story tag or side job mark, and the picked one
 * on the right with its premise, who and where, its current objectives, the
 * endings it can take, its prologue and history. Reading a quest is separate
 * from following it on the HUD, which the footer does. Labels come from
 * quests-layout.json (quests-layout.schema.json).
 * props: { onClose, onSelect, onTrack, onWait }
 */
export class QuestsView {

	constructor( { onClose, onSelect = () => {}, onTrack = () => {}, onWait = () => {} } = {} ) {

		this.quests = [];
		this.selected = null;
		this.tracked = null;
		this.trackedStepId = null;
		this.tab = 'active';
		this.onSelect = onSelect;
		this.onTrack = onTrack;
		this.onWait = onWait;

		this.tabs = el( 'div', { className: 'screen-tabs journal-tabs', role: 'tablist' } );
		this.tabs.setAttribute( 'aria-label', labels.tabs.label );
		this.tabButtons = [ 'active', 'done' ].map( ( id ) => {

			const count = el( 'span', { className: 'screen-count' } );
			const tab = el( 'button', { className: 'screen-tab journal-tab', type: 'button', role: 'tab' }, labels.tabs[ id ], count );
			tab.dataset.tab = id;
			tab.addEventListener( 'click', () => this.#showTab( id ) );
			this.tabs.append( tab );
			return { id, tab, count };

		} );
		this.list = el( 'ul', { className: 'list journal-list' } );
		this.railCount = el( 'span', { className: 'journal-rail-count' } );
		this.side = el( 'aside', { className: 'journal-rail' },
			el( 'div', { className: 'journal-rail-heading' }, el( 'span', { textContent: labels.list.label } ), this.railCount ),
			this.list,
			el( 'p', { className: 'journal-rail-hint', textContent: labels.list.hint } )
		);
		this.main = el( 'div', { className: 'journal-detail-scroll' } );
		this.footerNote = el( 'p', { className: 'journal-footer-note' } );
		this.footerAction = el( 'div', { className: 'journal-footer-action' } );
		this.footer = el( 'footer', { className: 'journal-footer' }, this.footerNote, this.footerAction );
		this.records = el( 'span', { className: 'journal-records' } );

		this.header = new PanelHeader( { title: labels.title, eyebrow: labels.eyebrow, onClose } );
		this.header.element.prepend( el( 'span', { className: 'journal-symbol', ariaHidden: 'true' }, el( 'span' ) ) );
		this.header.aside.append( el( 'div', { className: 'journal-summary' },
			el( 'span', { className: 'journal-summary-line', textContent: labels.subtitle } ),
			this.records
		) );
		this.element = el( 'div', { className: 'view view-quests' },
			this.header.element,
			this.tabs,
			el( 'div', { className: 'journal-body' },
				this.side,
				el( 'article', { className: 'journal-detail' }, this.main, this.footer )
			)
		);

		this.setQuests( [] );

	}

	/** The game's name after the journal's eyebrow. */
	setPlace( name ) {

		this.header.setEyebrow( name ? `${labels.eyebrow} / ${name}` : labels.eyebrow );

	}

	/**
	 * @param quests [{ id, title, text, kind?: 'main' | 'side', prologue?, note, state: 'available' | 'active' | 'blocked' | 'done' | 'failed',
	 * steps: [{ text, done, npcName, place, availability, window, wait?: { timeMin, label } }] }]
	 */
	setQuests( quests = [] ) {

		const focused = this.element.contains( document.activeElement ) ? document.activeElement : null;
		const focusLabel = focused?.getAttribute( 'aria-label' ) ?? focused?.textContent;
		this.quests = quests;
		const trackedQuest = quests.find( ( quest ) => quest.id === this.tracked );
		if ( ! canFollow( trackedQuest ) ) this.tracked = null;
		if ( ! this.tracked || ! canRetainStep( trackedQuest?.steps?.find( ( step ) => step.stepId === this.trackedStepId ) ) ) this.trackedStepId = null;
		this.records.textContent = labels.records.replace( '{count}', String( quests.length ).padStart( 2, '0' ) );
		const kept = quests.find( ( quest ) => quest.id === this.selected );
		this.select( kept ? kept.id : this.#visible()[ 0 ]?.id ?? quests[ 0 ]?.id ?? null );
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
		this.select( this.selected );

	}

	/** Opens one quest, turning to the list that holds it. */
	select( id ) {

		const quest = this.quests.find( ( q ) => q.id === id );
		if ( quest ) this.tab = tabOf( quest );
		this.selected = quest?.id ?? null;
		this.#renderTabs();
		this.#renderList();
		this.#renderDetail( quest ?? null );

	}

	#visible() {

		return this.quests.filter( ( quest ) => tabOf( quest ) === this.tab );

	}

	#showTab( id ) {

		if ( id === this.tab ) return;
		this.tab = id;
		const first = this.#visible()[ 0 ];
		this.selected = first?.id ?? null;
		this.#renderTabs();
		this.#renderList();
		this.#renderDetail( first ?? null );
		if ( first ) this.onSelect( first.id );

	}

	#renderTabs() {

		for ( const { id, tab, count } of this.tabButtons ) {

			tab.setAttribute( 'aria-selected', String( id === this.tab ) );
			count.textContent = String( this.quests.filter( ( quest ) => tabOf( quest ) === id ).length );

		}

	}

	#renderList() {

		const visible = this.#visible();
		this.railCount.textContent = String( visible.length ).padStart( 2, '0' );
		this.list.replaceChildren( ...visible.map( ( quest ) => {

			const number = String( this.quests.indexOf( quest ) + 1 ).padStart( 2, '0' );
			const place = currentPlace( quest );
			const active = quest.id === this.selected;
			const button = el( 'button', { className: `list-row journal-row${active ? ' is-active' : ''}`, type: 'button' },
				el( 'span', { className: 'journal-row-number', textContent: number, ariaHidden: 'true' } ),
				el( 'span', { className: 'journal-row-copy' },
					el( 'span', { className: 'journal-row-meta' },
						...( quest.kind ? [ questKind( quest.kind, labels.kinds ), el( 'span', { className: 'journal-row-kind', textContent: labels.kinds[ quest.kind ]?.label ?? '' } ) ] : [] )
					),
					el( 'span', { className: 'quest-list-title', textContent: quest.title } ),
					el( 'span', { className: 'journal-row-bottom' },
						...( place ? [ el( 'span', { className: 'journal-row-place', textContent: place } ) ] : [] ),
						el( 'span', { className: `badge is-${quest.state ?? 'active'}`, textContent: statusText( quest.state ) } ),
						...( this.tracked === quest.id ? [ el( 'span', { className: 'quest-following', textContent: labels.follow.following } ) ] : [] )
					)
				),
				el( 'span', { className: 'journal-row-arrow', textContent: '↗', ariaHidden: 'true' } )
			);
			button.setAttribute( 'aria-pressed', String( active ) );
			button.addEventListener( 'click', () => {

				this.select( quest.id );
				this.onSelect( quest.id );

			} );
			return el( 'li', {}, button );

		} ) );

		if ( ! visible.length ) this.list.append( el( 'li', {}, emptyState( this.tab === 'done' && this.quests.length ? labels.empty.done : labels.empty.list ) ) );

	}

	#renderDetail( quest ) {

		this.main.scrollTop = this.shownQuest === quest?.id ? this.main.scrollTop : 0;
		this.shownQuest = quest?.id ?? null;
		if ( ! quest ) {

			this.main.replaceChildren( emptyState( labels.empty.detail ) );
			this.footer.hidden = true;
			return;

		}
		this.footer.hidden = false;

		const following = this.tracked === quest.id;
		const followingQuest = following && this.trackedStepId === null;
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
		const lead = current.find( ( step ) => step.npcName || step.place?.name );
		const facts = [
			...( lead?.npcName ? [ [ labels.facts.contact, lead.npcName ] ] : [] ),
			...( lead?.place?.name ? [ [ labels.facts.place, lead.place.name ] ] : [] )
		];
		const historyDetails = el( 'details', { className: 'quest-history', open: current.length === 0 },
			el( 'summary', { textContent: fill( labels.sections.history, { count: history.length } ) } ),
			el( 'ul', { className: 'quest-steps' }, ...history.map( ( step ) => stepRow( step ) ) )
		);
		const prologue = el( 'details', { className: 'quest-history quest-prologue' },
			el( 'summary', { textContent: labels.sections.prologue } ),
			el( 'div', { className: 'prose' }, ...prose( quest.prologue ) )
		);
		const number = String( this.quests.indexOf( quest ) + 1 ).padStart( 2, '0' );

		this.main.replaceChildren(
			el( 'header', { className: 'journal-detail-header' },
				el( 'div', { className: 'journal-detail-meta' },
					...( quest.kind ? [ questKind( quest.kind, labels.kinds ), el( 'span', { className: 'journal-detail-kind', textContent: labels.kinds[ quest.kind ]?.label ?? '' } ) ] : [] ),
					el( 'span', { className: `detail-kind journal-status is-${quest.state ?? 'active'}`, textContent: statusText( quest.state ) } )
				),
				el( 'h3', { className: 'detail-title', textContent: quest.title } ),
				el( 'span', { className: 'journal-detail-number', textContent: number, ariaHidden: 'true' } )
			),
			...( quest.text ? [ el( 'section', { className: 'journal-premise' },
				el( 'h4', { className: 'journal-premise-label', textContent: quest.state === 'done' ? labels.sections.outcome : labels.sections.premise } ),
				el( 'p', { className: 'detail-text', textContent: quest.text } )
			) ] : [] ),
			...( quest.note ? [ el( 'p', { className: 'detail-note', textContent: quest.note } ) ] : [] ),
			...( facts.length ? [ el( 'dl', { className: 'journal-facts' }, ...facts.map( ( [ label, value ] ) => el( 'div', {},
				el( 'dt', { textContent: label } ), el( 'dd', { textContent: value } )
			) ) ) ] : [] ),
			...( ordinary.length ? [ el( 'section', { className: 'journal-section' },
				el( 'h4', { className: 'quest-section-title', textContent: labels.sections.current } ),
				el( 'ul', { className: 'quest-steps' }, ...ordinary.map( ( step ) => stepRow( step, false, null, waiting ) ) )
			) ] : [] ),
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
			...( quest.prologue ? [ prologue ] : [] ),
			...( history.length ? [ historyDetails ] : [] )
		);

		if ( ! canFollow( quest ) ) {

			this.footerNote.textContent = quest.state === 'blocked' ? quest.note ?? labels.status.blocked : labels.follow.finished;
			this.footerAction.replaceChildren();
			return;

		}
		const track = el( 'button', {
			className: `screen-button quest-track${followingQuest ? '' : ' is-primary'}`, type: 'button',
			ariaPressed: String( followingQuest )
		}, el( 'span', { className: 'quest-track-mark', ariaHidden: 'true' } ), followingQuest ? labels.follow.following : labels.follow.quest );
		track.setAttribute( 'aria-label', followingQuest ? labels.follow.following : labels.follow.quest );
		track.addEventListener( 'click', () => {

			if ( this.tracked === quest.id && this.trackedStepId === null ) return;
			this.setTrackedQuest( quest.id );
			this.onTrack( quest.id );
			this.footerAction.querySelector( '.quest-track' )?.focus();

		} );
		this.footerNote.textContent = following ? labels.follow.on : labels.follow.off;
		this.footerAction.replaceChildren( track );

	}

}

/** One step: what to do, who it is about and where, and why it is closed now. */
function stepRow( step, alternative = false, tracking = null, waiting = null ) {

	const meta = [ step.npcName, step.place?.name ].filter( Boolean ).join( ' - ' );
	const state = step.state ?? ( step.done ? 'done' : step.availability?.available === false ? 'locked' : 'active' );
	const closed = state === 'locked';
	const hours = hoursLine( step.window );
	const following = tracking?.stepId === step.stepId && Boolean( step.stepId );
	const lead = following ? labels.follow.leading : labels.follow.lead;
	const track = tracking ? el( 'button', {
		className: 'screen-button quest-lead-track', type: 'button',
		textContent: lead, ariaPressed: String( following ),
		disabled: ! tracking.enabled || ! canFollowStep( step )
	} ) : null;
	if ( track ) {

		track.setAttribute( 'aria-label', `${lead}: ${step.endingTitle || step.text}` );
		track.addEventListener( 'click', () => tracking.onTrack( step ) );

	}
	const wait = waiting?.enabled && canWaitStep( step ) ? el( 'button', {
		className: 'screen-button quest-wait', type: 'button', textContent: fill( labels.step.wait, { label: step.wait.label } )
	} ) : null;
	if ( wait ) wait.addEventListener( 'click', () => waiting.onWait( step ) );

	return el( 'li', { className: `quest-step is-${state}${closed ? ' is-closed' : ''}${alternative ? ' is-alternative' : ''}${following ? ' is-followed' : ''}` },
		el( 'span', { className: 'quest-step-mark', textContent: state === 'done' ? '✓' : state === 'cancelled' ? '−' : '' } ),
		el( 'span', { className: 'quest-step-body' },
			el( 'span', { className: 'quest-step-state', textContent: labels.step.states[ state ] } ),
			...( alternative && step.endingTitle ? [ el( 'strong', { className: 'quest-ending-title', textContent: step.endingTitle } ) ] : [] ),
			el( 'span', { className: 'quest-step-text', textContent: step.text } ),
			...( meta ? [ el( 'span', { className: 'quest-step-meta', textContent: meta } ) ] : [] ),
			...( alternative && step.stake ? [ el( 'span', { className: 'quest-step-stake', textContent: step.stake } ) ] : [] ),
			...( alternative && step.commitment ? [ el( 'span', { className: 'quest-step-commitment', textContent: fill( labels.step.commit, { text: step.commitment } ) } ) ] : [] ),
			...( track ? [ track ] : [] ),
			...( closed ? [ el( 'span', { className: 'quest-step-closed', textContent: step.availability?.text || labels.step.closed } ) ] : [] ),
			...( wait ? [ wait, el( 'span', { className: 'quest-wait-note', textContent: labels.step.waitNote } ) ] : [] ),
			...( state === 'cancelled' ? [ el( 'span', { className: 'quest-step-meta', textContent: labels.step.cancelled } ) ] : [] ),
			...( hours ? [ el( 'span', { className: 'quest-step-meta', textContent: hours } ) ] : [] )
		)
	);

}

function endingChoices( steps, tracking, waiting ) {

	return el( 'section', { className: 'journal-section quest-endings' },
		el( 'h4', { className: 'quest-section-title', textContent: labels.endings.title } ),
		el( 'p', { className: 'quest-choice-summary', textContent: steps.map( ( step ) => step.endingTitle || step.text ).join( ` ${labels.endings.or} ` ) } ),
		el( 'p', { className: 'quest-choice-note', textContent: labels.endings.note } ),
		el( 'p', { className: 'quest-tracking-note', textContent: labels.endings.tracking } ),
		el( 'ul', { className: 'quest-steps quest-alternatives' }, ...steps.flatMap( ( step, index ) => [
			...( index ? [ el( 'li', { className: 'quest-or', textContent: labels.endings.or, ariaHidden: 'true', role: 'presentation' } ) ] : [] ),
			stepRow( step, true, tracking, waiting )
		] ) )
	);

}

/** Which list a quest sits in: finished or not. */
function tabOf( quest ) {

	return FINISHED.has( quest.state ) ? 'done' : 'active';

}

/** Where the quest goes next: the first open step's place, else its person. */
function currentPlace( quest ) {

	const step = quest.steps?.find( ( candidate ) => ! candidate.done && candidate.state !== 'cancelled' && ( candidate.place?.name || candidate.npcName ) );
	return step?.place?.name ?? step?.npcName ?? '';

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

	return labels.status[ state ] ?? state;

}

/** "Open during the slow hour, 18:00 to 23:00": the step's own words, and the clock. */
function hoursLine( window ) {

	const label = window?.label?.trim?.() || '';
	if ( ! label || ! Number.isFinite( window.startMin ) || ! Number.isFinite( window.endMin ) ) return '';
	return fill( labels.step.hours, { label, start: clock( window.startMin ), end: clock( window.endMin ) } );

}

function clock( minuteOfDay ) {

	const hours = Math.floor( minuteOfDay / 60 ) % 24;
	return `${String( hours ).padStart( 2, '0' )}:${String( minuteOfDay % 60 ).padStart( 2, '0' )}`;

}

/** A label with its {name} placeholders filled. */
function fill( template, values ) {

	return template.replace( /\{(\w+)\}/g, ( match, name ) => String( values[ name ] ?? match ) );

}
