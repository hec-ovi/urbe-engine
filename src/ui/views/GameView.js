import '../components/styles.css';
import '../components/game.css';
import { el } from '../components/dom.js';
import { HudClock } from '../widgets/HudClock.js';
import { InteractPrompt } from '../widgets/InteractPrompt.js';
import { LocationReadout } from '../widgets/LocationReadout.js';
import { DebugStats } from '../widgets/DebugStats.js';
import { NpcDialogPanel } from '../widgets/NpcDialogPanel.js';
import { PauseMenu } from '../widgets/PauseMenu.js';

/**
 * The whole game overlay. Presentation only: it is handed values and shows
 * them, and reports two intents back through props (resume, close dialogue).
 * props: { onResume, onCloseDialog }
 */
export class GameView {

	constructor( { onResume, onCloseDialog } ) {

		this.clock = new HudClock();
		this.prompt = new InteractPrompt();
		this.readout = new LocationReadout();
		this.stats = new DebugStats();
		this.dialog = new NpcDialogPanel( { onClose: onCloseDialog } );
		this.pause = new PauseMenu( { onResume } );

		this.loadingStep = el( 'div', { className: 'hud-loading-step', textContent: 'starting' } );
		this.loadingError = el( 'div', { className: 'hud-loading-error' } );
		this.loadingError.hidden = true;
		this.loading = el( 'div', { className: 'hud-loading' },
			el( 'div', { className: 'hud-loading-title', textContent: 'urbe' } ),
			this.loadingStep,
			this.loadingError
		);

		this.element = el( 'div', { className: 'hud' },
			this.clock.element,
			this.prompt.element,
			this.readout.element,
			this.stats.element,
			this.dialog.element,
			this.pause.element,
			this.loading
		);

		this.pause.setVisible( false );

	}

	mount( parent ) {

		parent.append( this.element );

	}

	step( text ) {

		this.loadingStep.textContent = text;

	}

	ready() {

		this.loading.hidden = true;

	}

	fail( message ) {

		this.loading.hidden = false;
		this.loadingStep.textContent = 'could not start';
		this.loadingError.hidden = false;
		this.loadingError.textContent = message;

	}

}
