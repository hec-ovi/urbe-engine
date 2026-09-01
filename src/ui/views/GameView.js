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
import { ChatPanel } from '../widgets/ChatPanel.js';
import { AvatarCard } from '../widgets/AvatarCard.js';
import { VideoCallPanel } from '../widgets/VideoCallPanel.js';
import { MissionToast } from '../widgets/MissionToast.js';
import { MissionSummary } from '../widgets/MissionSummary.js';
import { PauseMenu } from '../widgets/PauseMenu.js';
import { TabBar } from '../widgets/TabBar.js';
import { PanelHost } from './PanelHost.js';
import { MinimapView } from './MinimapView.js';
import { MapView } from './MapView.js';
import { InventoryView } from './InventoryView.js';
import { QuestsView } from './QuestsView.js';
import { CodexView } from './CodexView.js';
import { SettingsView } from './SettingsView.js';
import { ControlsView } from './ControlsView.js';

const noop = () => {};

/**
 * The whole game overlay: the always-on HUD, the tab bar, one panel at a
 * time over the game, and the chat, avatar, call and mission widgets.
 * Presentation only: it is handed values and reports intents through props.
 * props (all optional): { onResume, onCloseDialog, onSend, onOpen, onClose,
 *   onLeave, onSettingChange, onHangUp, onSummaryClose }
 */
export class GameView {

	constructor( {
		onResume = noop, onCloseDialog = noop, onSend = noop, onOpen = noop, onClose = noop,
		onLeave = noop, onSettingChange = noop, onHangUp = noop, onSummaryClose = noop
	} = {} ) {

		const close = () => this.close();

		this.clock = new HudClock();
		this.prompt = new InteractPrompt();
		this.readout = new LocationReadout();
		this.stats = new DebugStats();
		this.minimap = new MinimapView();
		this.avatar = new AvatarCard();
		this.call = new VideoCallPanel( { onHangUp } );
		this.toast = new MissionToast();
		this.dialog = new ChatPanel( { onSend, onClose: onCloseDialog } );
		this.summary = new MissionSummary( { onClose: onSummaryClose } );
		this.pause = new PauseMenu( { onResume } );

		this.map = new MapView( { onClose: close } );
		this.inventory = new InventoryView( { onClose: close } );
		this.quests = new QuestsView( { onClose: close } );
		this.codex = new CodexView( { onClose: close } );
		this.settings = new SettingsView( { onChange: onSettingChange, onClose: close } );
		this.controls = new ControlsView( { onClose: close } );

		this.tabs = new TabBar( { onSelect: ( name ) => this.toggle( name ), onLeave } );
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
				onOpen( name );

			},
			onClose: () => {

				this.tabs.setActive( null );
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
			this.minimap.element,
			this.avatar.element,
			this.call.element,
			this.toast.element,
			this.dialog.element,
			this.summary.element,
			this.pause.element,
			this.panels.element,
			this.tabs.element,
			this.loading
		);

		this.pause.setVisible( false );

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

	fail( message ) {

		this.loading.hidden = false;
		this.loadingStep.textContent = 'could not start';
		this.loadingError.hidden = false;
		this.loadingError.textContent = message;

	}

}
