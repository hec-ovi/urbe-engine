import { el } from '../components/dom.js';
import { CreationSteps } from '../widgets/CreationSteps.js';
import { CreationForm } from '../components/CreationForm.js';
import layout from './creation-layout.json' with { type: 'json' };

const STAGES = [ 'city', 'instances', 'quests', 'game' ];

function submit( label, action ) {

	const button = el( 'button', { type: 'button', className: 'creation-submit', textContent: label } );
	button.addEventListener( 'click', action );
	return button;

}

/** Presents city creation and optional interiors and quests. */
export class NewGameView {

	constructor( {
		onGenerateCity,
		onGenerateInstances,
		onGenerateQuests,
		onCreateGame,
		onCancel
	} = {} ) {

		this.handlers = { onGenerateCity, onGenerateInstances, onGenerateQuests, onCreateGame, onCancel };
		this.state = { city: null, instances: null, quests: null, game: null, busy: null, error: '' };
		this.current = 1;

		this.forms = Object.fromEntries( [ 'city', 'instances', 'quests' ].map( ( stage ) => [
			stage, new CreationForm( layout[ stage ].fields, () => this.sync() )
		] ) );
		for ( const form of Object.values( this.forms ) ) Object.assign( this, form.inputs );
		this.cityAction = submit( layout.city.action, () => this.generateCity() );
		this.cityStatus = el( 'p', { className: 'creation-stage-status', role: 'status', ariaLive: 'polite' } );
		this.cityPane = this.pane( '1', layout.city.title, layout.city.intro,
			this.forms.city.element, this.cityAction, this.cityStatus
		);
		this.freePlayActions = [ 0, 1 ].map( () => submit( layout.freePlay, () => this.createGame( true ) ) );

		this.buildingList = el( 'fieldset', { className: 'creation-buildings' },
			el( 'legend', { textContent: 'Buildings available for interiors' } )
		);
		this.instanceAction = submit( layout.instances.action, () => this.generateInstances() );
		this.instanceStatus = el( 'p', { className: 'creation-stage-status', role: 'status', ariaLive: 'polite' } );
		this.instancePane = this.pane( '2', layout.instances.title, layout.instances.intro,
			this.freePlayActions[ 0 ], this.forms.instances.element, this.buildingList, this.instanceAction, this.instanceStatus
		);

		this.questAction = submit( layout.quests.action, () => this.generateQuests() );
		this.questStatus = el( 'p', { className: 'creation-stage-status', role: 'status', ariaLive: 'polite' } );
		this.questPane = this.pane( '3', layout.quests.title, layout.quests.intro,
			this.freePlayActions[ 1 ], this.forms.quests.element, this.questAction, this.questStatus
		);

		this.review = el( 'div', { className: 'creation-review' } );
		this.gameAction = submit( layout.game.action, () => this.createGame() );
		this.gameStatus = el( 'p', { className: 'creation-stage-status', role: 'status', ariaLive: 'polite' } );
		this.gamePane = this.pane( '4', layout.game.title, layout.game.intro,
			this.review,
			this.gameAction,
			this.gameStatus
		);

		this.steps = new CreationSteps( { onSelect: ( step ) => this.open( step ) } );
		this.cancel = el( 'button', { type: 'button', className: 'creation-cancel', textContent: 'Back to library' } );
		this.cancel.addEventListener( 'click', () => onCancel?.() );
		this.error = el( 'p', { className: 'creation-error', role: 'alert' } );
		this.error.hidden = true;
		this.element = el( 'section', { className: 'new-game-view', ariaLabel: 'Create a playable game' },
			el( 'div', { className: 'creation-rail' },
				el( 'p', { className: 'menu-eyebrow', textContent: 'New game' } ),
				el( 'h2', { className: 'menu-section-title', textContent: layout.title } ),
				this.steps.element,
				this.cancel
			),
			el( 'div', { className: 'creation-content' },
				this.error,
				this.cityPane, this.instancePane, this.questPane, this.gamePane
			)
		);

		this.sync();

	}

	pane( number, title, intro, ...children ) {

		const pane = el( 'section', { className: 'creation-pane' },
			el( 'p', { className: 'menu-eyebrow', textContent: `Step ${ number }` } ),
			el( 'h3', { id: `creation-stage-${ number }`, textContent: title } ),
			el( 'p', { className: 'creation-intro', textContent: intro } ),
			...children
		);
		pane.setAttribute( 'aria-labelledby', `creation-stage-${ number }` );
		return pane;

	}

	reset() {

		this.state = { city: null, instances: null, quests: null, game: null, busy: null, error: '' };
		this.current = 1;
		for ( const form of Object.values( this.forms ) ) form.reset();
		this.setBuildings( [] );
		this.sync();

	}

	beginWithCity( city ) {

		this.state = { city, instances: null, quests: null, game: null, busy: null, error: '' };
		this.size.value = city.size || 'small';
		this.setBuildings( city.availableBuildings || [] );
		this.current = 2;
		this.sync();

	}

	setCreationState( update = {} ) {

		const next = { ...this.state, ...update };
		if ( update.city && update.city !== this.state.city ) {

			next.instances = update.instances || null;
			next.quests = update.quests || null;
			next.game = update.game || null;

		} else if ( update.instances && update.instances !== this.state.instances ) {

			next.quests = update.quests || null;
			next.game = update.game || null;

		} else if ( update.quests && update.quests !== this.state.quests ) {

			next.game = update.game || null;

		}
		this.state = next;
		if ( Object.hasOwn( update, 'error' ) ) {

			this.error.textContent = update.error || '';

		}
		if ( update.city ) {

			this.setBuildings( update.city.availableBuildings || [] );
			if ( ! this.state.instances ) this.current = 2;

		}
		if ( update.instances ) this.current = 3;
		if ( update.quests ) this.current = 4;
		this.sync();

	}

	setBuildings( buildings ) {

		this.buildingList.replaceChildren( el( 'legend', { textContent: 'Buildings available for interiors' } ) );
		for ( const building of buildings ) {

			const checkbox = el( 'input', { type: 'checkbox', value: building.id, disabled: building.eligible === false } );
			checkbox.dataset.buildingId = building.id;
			this.buildingList.append( el( 'label', { className: 'creation-building' }, checkbox,
				el( 'span', { textContent: building.label || building.id } ),
				el( 'small', { textContent: building.type || ( building.eligible === false ? 'not eligible' : 'building' ) } )
			) );

		}

	}

	open( step ) {

		if ( step > this.unlocked() ) return;
		this.current = step;
		this.sync();

	}

	unlocked() {

		if ( this.state.quests ) return 4;
		if ( this.state.instances ) return 3;
		if ( this.state.city ) return 2;
		return 1;

	}

	generateCity() {

		this.clearError();
		this.handlers.onGenerateCity?.( { size: this.size.value } );

	}

	generateInstances() {

		if ( ! this.state.city ) return this.showError( 'Generate or select a city first.' );
		const count = Number( this.instanceCount.value );
		const ids = [ ...this.buildingList.querySelectorAll( 'input:checked' ) ].map( ( input ) => input.value );
		if ( this.instanceMode.value === 'automatic' && ( ! Number.isInteger( count ) || count < 9 || count > 24 ) ) return this.showError( 'Automatic interior count must be between 9 and 24.' );
		if ( this.instanceMode.value === 'manual' && ids.length === 0 ) return this.showError( 'Select at least one building for a manual interior build.' );
		if ( this.instanceMode.value === 'manual' && ids.length > 24 ) return this.showError( 'Select no more than 24 buildings for interiors.' );
		this.clearError();
		this.handlers.onGenerateInstances?.( {
			cityId: this.state.city.id,
			mode: this.instanceMode.value,
			count: this.instanceMode.value === 'manual' ? ids.length : count,
			buildingIds: ids
		} );

	}

	generateQuests() {

		if ( ! this.state.instances ) return this.showError( 'Generate the playable interiors first.' );
		const sideJobs = Number( this.sideJobs.value );
		if ( ! Number.isInteger( sideJobs ) || sideJobs < 0 || sideJobs > 3 ) return this.showError( 'Side jobs must be between 0 and 3.' );
		this.clearError();
		this.handlers.onGenerateQuests?.( {
			cityId: this.state.city.id,
			interiorIds: this.state.instances.ids || [],
			mainBrief: '',
			sideJobs
		} );

	}

	createGame( freePlay = false ) {

		if ( ! this.state.city || ! freePlay && ! this.state.quests ) return this.showError( 'Complete the selected stages first.' );
		this.clearError();
		this.handlers.onCreateGame?.( {
			cityId: this.state.city.id,
			interiorIds: this.state.instances?.ids || [],
			questId: freePlay ? null : this.state.quests.id
		} );

	}

	showError( message ) {

		this.error.hidden = false;
		this.error.textContent = message;

	}

	clearError() {

		this.error.hidden = true;
		this.error.textContent = '';

	}

	sync() {

		const unlocked = this.unlocked();
		this.steps?.set( this.current, unlocked );
		[ this.cityPane, this.instancePane, this.questPane, this.gamePane ].forEach( ( pane, index ) => {

			pane.hidden = this.current !== index + 1;
			pane.setAttribute( 'aria-busy', String( Boolean( this.state.busy ) && ( this.current === index + 1 || this.state.busy === STAGES[ index ] ) ) );

		} );
		this.buildingList.hidden = this.instanceMode.value !== 'manual';
		this.instanceCount.disabled = this.instanceMode.value === 'manual';
		const busy = this.state.busy;
		for ( const button of this.freePlayActions ) button.disabled = busy !== null || ! this.state.city || ! this.handlers.onCreateGame;
		for ( const form of Object.values( this.forms ) ) for ( const input of Object.values( form.inputs ) ) input.disabled = busy !== null;
		this.instanceCount.disabled = busy !== null || this.instanceMode.value === 'manual';
		this.cityAction.disabled = busy !== null || ! this.handlers.onGenerateCity;
		this.instanceAction.disabled = busy !== null || ! this.state.city || ! this.handlers.onGenerateInstances;
		this.questAction.disabled = busy !== null || ! this.state.instances || ! this.handlers.onGenerateQuests;
		this.gameAction.disabled = busy !== null || ! this.state.quests || ! this.handlers.onCreateGame;

		this.cityStatus.textContent = this.stageStatus( 'city', this.handlers.onGenerateCity, this.state.city && `${ this.state.city.buildingCount ?? this.state.city.buildings ?? 0 } buildings ready.` );
		this.instanceStatus.textContent = this.stageStatus( 'instances', this.handlers.onGenerateInstances, this.state.instances && `${ this.state.instances.count ?? this.state.instances.ids?.length ?? 0 } interiors ready.` );
		this.questStatus.textContent = this.stageStatus( 'quests', this.handlers.onGenerateQuests, this.state.quests && `${ this.state.quests.mainSteps ?? 0 } main steps and ${ this.state.quests.sideJobs ?? 0 } side jobs ready.` );
		this.gameStatus.textContent = this.stageStatus( 'game', this.handlers.onCreateGame, this.state.game && 'Playable game is ready.' );
		this.error.hidden = ! this.state.error && ! this.error.textContent;
		if ( this.state.error ) this.error.textContent = this.state.error;

		const city = this.state.city;
		const instances = this.state.instances;
		const quests = this.state.quests;
		this.review.replaceChildren(
			this.reviewRow( 'City', city ? `${ city.name || city.id } / ${ city.size || 'generated' } / seed ${ city.seed || 'unknown' }` : 'not ready' ),
			this.reviewRow( 'Interiors', instances ? `${ instances.count ?? instances.ids?.length ?? 0 } playable buildings` : 'not ready' ),
			this.reviewRow( 'Main story', quests ? `${ quests.mainSteps ?? 0 } steps` : 'not ready' ),
			this.reviewRow( 'Side jobs', quests ? String( quests.sideJobs ?? 0 ) : 'not ready' )
		);

	}

	stageStatus( stage, handler, ready ) {

		if ( this.state.busy === 'game' ) return 'Opening your city.';
		if ( this.state.busy === stage ) return 'Working on this stage.';
		if ( ready ) return ready;
		if ( ! handler ) return `${ stage[ 0 ].toUpperCase() }${ stage.slice( 1 ) } generation is not connected in the current runtime.`;
		return 'Ready for input.';

	}

	reviewRow( label, value ) {

		return el( 'div', { className: 'creation-review-row' }, el( 'span', { textContent: label } ), el( 'strong', { textContent: value } ) );

	}

}
