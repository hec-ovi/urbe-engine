import { el } from '../components/dom.js';
import { CreationSteps } from '../widgets/CreationSteps.js';

const STAGES = [ 'city', 'instances', 'quests', 'game' ];

function labelled( label, control, note = '' ) {

	const text = el( 'span', { className: 'creation-field-label', textContent: label } );
	const field = el( 'label', { className: 'creation-field' }, text, control );
	if ( note ) field.append( el( 'span', { className: 'creation-field-note', textContent: note } ) );
	return field;

}

function option( value, label = value ) {

	return el( 'option', { value, textContent: label } );

}

function submit( label, action ) {

	const button = el( 'button', { type: 'button', className: 'creation-submit', textContent: label } );
	button.addEventListener( 'click', action );
	return button;

}

/** City -> selected interiors -> quests/jobs -> playable game. No persistence lives here. */
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

		this.name = el( 'input', { className: 'creation-input', type: 'text', value: 'New city', required: true, autocomplete: 'off', ariaLabel: 'City name' } );
		this.seed = el( 'input', { className: 'creation-input', type: 'text', value: 'urbe', required: true, autocomplete: 'off', ariaLabel: 'Seed' } );
		this.size = el( 'select', { className: 'creation-input', ariaLabel: 'City size' },
			option( 'small', 'Small' ), option( 'medium', 'Medium' ), option( 'large', 'Large' )
		);
		this.cityAction = submit( 'Generate city', () => this.generateCity() );
		this.cityStatus = el( 'p', { className: 'creation-stage-status', role: 'status', ariaLive: 'polite' } );
		this.cityPane = this.pane( '1', 'City geometry', 'Generate the deterministic streets, transit, districts and building shells first.',
			el( 'div', { className: 'creation-form-grid' },
				labelled( 'City name', this.name ),
				labelled( 'Seed', this.seed, 'The same seed and size must produce the same city.' ),
				labelled( 'Scale', this.size, 'Small, medium and large use verified generation profiles.' )
			),
			this.cityAction,
			this.cityStatus
		);

		this.instanceMode = el( 'select', { className: 'creation-input', ariaLabel: 'Interior selection mode' },
			option( 'automatic', 'Choose automatically' ), option( 'manual', 'Choose buildings' )
		);
		this.instanceCount = el( 'input', { className: 'creation-input', type: 'number', min: 9, max: 24, step: 1, value: 9, ariaLabel: 'Interior count' } );
		this.buildingList = el( 'fieldset', { className: 'creation-buildings' },
			el( 'legend', { textContent: 'Buildings available for interiors' } )
		);
		this.instanceAction = submit( 'Generate selected interiors', () => this.generateInstances() );
		this.instanceStatus = el( 'p', { className: 'creation-stage-status', role: 'status', ariaLive: 'polite' } );
		this.instancePane = this.pane( '2', 'Playable interiors', 'Only selected quest and work locations receive interiors. The rest remain sealed city buildings.',
			el( 'div', { className: 'creation-form-grid' },
				labelled( 'Selection', this.instanceMode ),
				labelled( 'Interior count', this.instanceCount, 'Nine is the minimum and default: seven main-story locations plus two unique side-job locations.' )
			),
			this.buildingList,
			this.instanceAction,
			this.instanceStatus
		);

		this.mainBrief = el( 'textarea', { className: 'creation-input creation-textarea', placeholder: 'Optional direction for the main story', spellcheck: true, ariaLabel: 'Main story direction' } );
		this.sideJobs = el( 'input', { className: 'creation-input', type: 'number', min: 0, max: 3, step: 1, value: 3, ariaLabel: 'Side jobs' } );
		this.questAction = submit( 'Generate story and jobs', () => this.generateQuests() );
		this.questStatus = el( 'p', { className: 'creation-stage-status', role: 'status', ariaLive: 'polite' } );
		this.questPane = this.pane( '3', 'Story and side jobs', 'The story pass defines the narrative. The gameplay pass then maps it onto real people, places, items and supported actions.',
			el( 'div', { className: 'creation-form-grid' },
				labelled( 'Main story direction', this.mainBrief, 'Leave blank to derive it from the generated city.' ),
				labelled( 'Side jobs', this.sideJobs )
			),
			this.questAction,
			this.questStatus
		);

		this.review = el( 'div', { className: 'creation-review' } );
		this.gameAction = submit( 'Create playable game', () => this.createGame() );
		this.gameStatus = el( 'p', { className: 'creation-stage-status', role: 'status', ariaLive: 'polite' } );
		this.gamePane = this.pane( '4', 'Playable game', 'Seal the city, its selected interiors, quests and initial playthrough into one loadable game.',
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
				el( 'h2', { className: 'menu-section-title', textContent: 'Build in four isolated stages' } ),
				this.steps.element,
				this.cancel
			),
			el( 'div', { className: 'creation-content' },
				this.error,
				this.cityPane, this.instancePane, this.questPane, this.gamePane
			)
		);

		this.instanceMode.addEventListener( 'change', () => this.sync() );
		this.sync();

	}

	pane( number, title, intro, ...children ) {

		const pane = el( 'section', { className: 'creation-pane' },
			el( 'p', { className: 'menu-eyebrow', textContent: `Stage ${ number } of 4` } ),
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
		this.name.value = 'New city';
		this.seed.value = 'urbe';
		this.size.value = 'small';
		this.instanceMode.value = 'automatic';
		this.instanceCount.value = '9';
		this.mainBrief.value = '';
		this.sideJobs.value = '3';
		this.setBuildings( [] );
		this.sync();

	}

	beginWithCity( city ) {

		this.state = { city, instances: null, quests: null, game: null, busy: null, error: '' };
		this.name.value = city.name || city.id;
		this.seed.value = city.seed || '';
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

		const name = this.name.value.trim();
		const seed = this.seed.value.trim();
		this.name.setAttribute( 'aria-invalid', String( ! name ) );
		this.seed.setAttribute( 'aria-invalid', String( ! seed ) );
		if ( ! name || ! seed ) return this.showError( 'City name and seed are required.' );
		this.clearError();
		this.handlers.onGenerateCity?.( { name, seed, size: this.size.value } );

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
			mainBrief: this.mainBrief.value.trim(),
			sideJobs
		} );

	}

	createGame() {

		if ( ! this.state.city || ! this.state.instances || ! this.state.quests ) return this.showError( 'City, interiors and quests must all be ready.' );
		this.clearError();
		this.handlers.onCreateGame?.( {
			cityId: this.state.city.id,
			interiorIds: this.state.instances.ids || [],
			questId: this.state.quests.id
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
			pane.setAttribute( 'aria-busy', String( this.state.busy === STAGES[ index ] ) );

		} );
		this.buildingList.hidden = this.instanceMode.value !== 'manual';
		this.instanceCount.disabled = this.instanceMode.value === 'manual';
		const busy = this.state.busy;
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

		if ( this.state.busy === stage ) return 'Working on this stage.';
		if ( ready ) return ready;
		if ( ! handler ) return `${ stage[ 0 ].toUpperCase() }${ stage.slice( 1 ) } generation is not connected in the current runtime.`;
		return 'Ready for input.';

	}

	reviewRow( label, value ) {

		return el( 'div', { className: 'creation-review-row' }, el( 'span', { textContent: label } ), el( 'strong', { textContent: value } ) );

	}

}
