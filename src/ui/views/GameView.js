import '../components/styles.css';
import '../components/game.css';
import '../components/tabbar.css';
import '../components/panels.css';
import '../components/views.css';
import '../components/chat.css';
import '../components/mission.css';
import { el } from '../components/dom.js';
import { HudClock } from '../widgets/HudClock.js';
import { InteractPrompt } from '../widgets/InteractPrompt.js';
import { LocationReadout } from '../widgets/LocationReadout.js';
import { DebugStats } from '../widgets/DebugStats.js';
import { CurrentObjective } from '../widgets/CurrentObjective.js';
import { ChatPanel } from '../widgets/ChatPanel.js';
import { AvatarCard } from '../widgets/AvatarCard.js';
import { VideoCallPanel } from '../widgets/VideoCallPanel.js';
import { MissionToast } from '../widgets/MissionToast.js';
import { MissionSummary } from '../widgets/MissionSummary.js';
import { TransitHud } from '../widgets/TransitHud.js';
import { PauseMenu } from '../widgets/PauseMenu.js';
import { TabBar } from '../widgets/TabBar.js';
import { PanelHost } from './PanelHost.js';
import { MinimapView } from './MinimapView.js';
import { Map3DView } from './Map3DView.js';
import { InventoryView } from './InventoryView.js';
import { QuestsView } from './QuestsView.js';
import { CodexView } from './CodexView.js';
import { SettingsView } from './SettingsView.js';
import { ControlsView } from './ControlsView.js';
import { MainMenuView } from './MainMenuView.js';
import menuLabels from './game-menu.json' with { type: 'json' };

const noop = () => {};

/**
 * The whole game overlay: the always-on HUD, the tab bar, one panel at a
 * time over the game, and the chat, avatar, call and mission widgets.
 * Presentation only: it is handed values and reports intents through props,
 * all optional and listed in the UI contract.
 */
export class GameView {

	constructor( {
		onResume = noop, onSave = noop, onCloseDialog = noop, onSend = noop, onOpen = noop, onClose = noop,
		onLeave = noop, onSettingChange = noop, onHangUp = noop, onSummaryClose = noop, onSummaryOpen = noop,
		onTransitSelect = noop, onTransitCancel = noop, onQuestSelect = noop, onQuestTrack = noop, onQuestWait = noop,
		onDialogueChoice = noop, onDialogueTopic = noop, onDialogueAction = noop, onDialogueRetry = noop, onDialogueJournal = noop,
		menu = {}
	} = {} ) {

		const close = () => this.close();
		const leave = () => {

			this.showMainMenu();
			onLeave();

		};

		this.clock = new HudClock();
		this.prompt = new InteractPrompt();
		this.readout = new LocationReadout();
		this.stats = new DebugStats();
		this.objective = new CurrentObjective( { onOpen: () => this.open( 'QUESTS' ) } );
		this.minimap = new MinimapView();
		this.avatar = new AvatarCard();
		this.call = new VideoCallPanel( { onHangUp } );
		this.toast = new MissionToast();
		this.dialog = new ChatPanel( { onSend, onClose: onCloseDialog,
			onChoice: onDialogueChoice, onTopic: onDialogueTopic, onAction: onDialogueAction, onRetry: onDialogueRetry, onJournal: onDialogueJournal } );
		this.summary = new MissionSummary( { onOpen: onSummaryOpen, onClose: ( close ) => { this.summary.setVisible( false ); onSummaryClose( close ); } } );
		this.transit = new TransitHud( { onSelect: onTransitSelect, onCancel: onTransitCancel } );
		this.pause = new PauseMenu( { onResume, onOpen: ( name ) => this.open( name ), onSave, onLeave: leave } );
		this.free = el( 'div', { className: 'hud-free', textContent: menuLabels.free } );
		this.free.hidden = true;

		this.map = new Map3DView( { onClose: close } );
		this.inventory = new InventoryView( { onClose: close } );
		this.quests = new QuestsView( { onClose: close, onSelect: onQuestSelect, onTrack: onQuestTrack, onWait: onQuestWait } );
		this.codex = new CodexView( { onClose: close } );
		this.settings = new SettingsView( { onChange: onSettingChange, onClose: close } );
		this.controls = new ControlsView( { onClose: close } );

		this.mainMenu = new MainMenuView( menu );
		this.tabs = new TabBar( { onSelect: ( name ) => this.toggle( name ), onLeave: leave } );
		this.panels = new PanelHost( {
			views: {
				QUESTS: this.quests,
				MAP: this.map,
				INVENTORY: this.inventory,
				CODEX: this.codex,
				SETTINGS: this.settings,
				CONTROLS: this.controls
			},
			onOpen: ( name ) => {

				this.tabs.setActive( name );
				this.#overlays();
				onOpen( name );

			},
			onClose: () => {

				this.tabs.setActive( null );
				this.#overlays();
				onClose();

			}
		} );

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
			this.objective.element,
			this.minimap.element,
			this.avatar.element,
			this.call.element,
			this.toast.element,
			this.dialog.element,
			this.summary.element,
			this.transit.element,
			this.pause.element,
			this.free,
			this.panels.element,
			this.tabs.element,
			this.loading,
			this.mainMenu.element
		);
		this.gameplayElements = [ ...this.element.children ].filter( ( element ) => element !== this.mainMenu.element );

		this.paused = false;
		this.#overlays();

	}

	/**
	 * The pause menu, under any panel, chat or summary opened over it. The
	 * panels are reached from it or by their keys; the tab bar is up only
	 * while one of them is open, to move between them.
	 */
	setPaused( paused ) {

		this.paused = paused;
		this.#overlays();

	}

	/** The pointer is free while the world plays on: a line says how to take it back. */
	setPointerFree( free ) {

		this.free.hidden = ! free;

	}

	mount( parent ) {

		parent.append( this.element );

	}

	/** Panel names: QUESTS, MAP, INVENTORY, CODEX, SETTINGS, CONTROLS. */
	open( name ) {

		this.panels.open( name );

	}

	close() {

		this.panels.close();

	}

	toggle( name ) {

		this.panels.toggle( name );

	}

	step( text ) {

		this.loadingStep.textContent = text;

	}

	ready() {

		this.loading.hidden = true;

	}

	showMainMenu() {

		this.close();
		for ( const element of this.gameplayElements ) {

			element.inert = true;
			element.setAttribute( 'aria-hidden', 'true' );

		}
		this.mainMenu.show();

	}

	hideMainMenu() {

		this.mainMenu.hide();
		for ( const element of this.gameplayElements ) {

			element.inert = false;
			element.removeAttribute( 'aria-hidden' );

		}

	}

	setLibrary( library ) {

		this.mainMenu.setLibrary( library );

	}

	setCreationState( state ) {

		this.mainMenu.setCreationState( state );

	}

	setObjective( objective ) {

		this.objective.setObjective( objective );

	}

	#overlays() {

		this.pause.setVisible( this.paused && ! this.panels.current && this.summary.element.hidden && this.dialog.element.hidden );
		this.tabs.element.hidden = ! this.panels.current;

	}

	fail( message ) {

		this.loading.hidden = false;
		this.loadingStep.textContent = 'could not start';
		this.loadingError.hidden = false;
		this.loadingError.textContent = message;

	}

}
