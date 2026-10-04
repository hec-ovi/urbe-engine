import '../components/styles.css';
import '../components/game.css';
import '../components/panels.css';
import '../components/screens.css';
import '../components/dock.css';
import '../components/journal.css';
import '../components/map.css';
import '../components/inventory.css';
import '../components/codex.css';
import '../components/settings.css';
import '../components/chat.css';
import '../components/mission.css';
import '../components/fracture.css';
import '../components/loading.css';
import '../components/hud-studio.css';
import { el } from '../components/dom.js';
import { HudClock } from '../widgets/HudClock.js';
import { InteractPrompt } from '../widgets/InteractPrompt.js';
import { HudShortcuts } from '../widgets/HudShortcuts.js';
import { InspectionCard } from '../widgets/InspectionCard.js';
import { LocationReadout } from '../widgets/LocationReadout.js';
import { DebugStats } from '../widgets/DebugStats.js';
import { CurrentObjective } from '../widgets/CurrentObjective.js';
import { ChatPanel } from '../widgets/ChatPanel.js';
import { AvatarCard } from '../widgets/AvatarCard.js';
import { CallPanel } from '../widgets/CallPanel.js';
import { MissionToast } from '../widgets/MissionToast.js';
import { MissionSummary } from '../widgets/MissionSummary.js';
import { TransitHud } from '../widgets/TransitHud.js';
import { LoadingScreen } from '../widgets/LoadingScreen.js';
import { GameDock } from '../widgets/GameDock.js';
import { PanelHost } from './PanelHost.js';
import { MinimapView } from './MinimapView.js';
import { Map3DView } from './Map3DView.js';
import { InventoryView, modelOf } from './InventoryView.js';
import { ItemPreview } from '../components/ItemPreview.js';
import { QuestsView } from './QuestsView.js';
import { CodexView } from './CodexView.js';
import { ContactsView } from './ContactsView.js';
import { SettingsView } from './SettingsView.js';
import { ControlsView } from './ControlsView.js';
import { MainMenuView } from './MainMenuView.js';
import menuLabels from './game-menu.json' with { type: 'json' };

const noop = () => {};

/**
 * The whole game overlay: the always-on HUD, one full screen at a time over
 * the game with the labelled dock under it, and the chat, avatar, call and
 * mission widgets.
 * Presentation only: it is handed values and reports intents through props,
 * all optional and listed in the UI contract.
 */
export class GameView {

	constructor( {
		onResume = noop, onSave = noop, onCloseDialog = noop, onSend = noop, onOpen = noop, onClose = noop,
		onLeave = noop, onSettingChange = noop, onHangUp = noop, onCall = noop, onRedial = noop, onCallClose = noop, onSummaryClose = noop, onSummaryOpen = noop,
		onTransitSelect = noop, onTransitCancel = noop, onQuestSelect = noop, onQuestTrack = noop, onQuestWait = noop,
		onDialogueChoice = noop, onDialogueTopic = noop, onDialogueAction = noop, onDialogueRetry = noop, onDialogueJournal = noop, onDialogueVoice = noop,
		menu = {}
	} = {} ) {

		const close = () => this.close();
		const leave = () => {

			this.showMainMenu();
			onLeave();

		};

		this.clock = new HudClock();
		this.prompt = new InteractPrompt();
		this.shortcuts = new HudShortcuts();
		this.inspection = new InspectionCard( { onOpen: onSummaryOpen, onClose: onSummaryClose } );
		this.readout = new LocationReadout();
		this.stats = new DebugStats();
		this.objective = new CurrentObjective( { onOpen: () => this.open( 'QUESTS' ) } );
		this.minimap = new MinimapView( { onOpen: () => this.open( 'MAP' ) } );
		this.avatar = new AvatarCard();
		this.call = new CallPanel( { onHangUp, onRedial, onClose: onCallClose } );
		this.toast = new MissionToast();
		this.dialog = new ChatPanel( { onSend, onClose: onCloseDialog,
			onChoice: onDialogueChoice, onTopic: onDialogueTopic, onAction: onDialogueAction, onRetry: onDialogueRetry, onJournal: onDialogueJournal, onVoice: onDialogueVoice } );
		this.summary = new MissionSummary( { onOpen: onSummaryOpen, onClose: ( close ) => {
			this.summary.setVisible( false );
			if ( ! this.inspection.element.hidden ) this.inspection.done.focus();
			onSummaryClose( close );
		} } );
		this.transit = new TransitHud( { onSelect: onTransitSelect, onCancel: onTransitCancel } );
		this.free = el( 'div', { className: 'hud-free', textContent: menuLabels.free } );
		this.free.hidden = true;

		this.map = new Map3DView( { onClose: close } );
		// One small 3D stage for the item and codex previews, made when first drawn.
		this.preview = new ItemPreview();
		const openQuest = ( questId ) => {

			this.open( 'QUESTS' );
			this.quests.select( questId );
			onQuestSelect( questId );

		};
		this.inventory = new InventoryView( { onClose: close, onQuest: openQuest, preview: this.preview } );
		this.quests = new QuestsView( { onClose: close, onSelect: onQuestSelect, onTrack: onQuestTrack, onWait: onQuestWait } );
		this.codex = new CodexView( { onClose: close, onQuest: openQuest, preview: this.preview } );
		this.contacts = new ContactsView( { onClose: close, onCall } );
		this.settings = new SettingsView( { onChange: onSettingChange, onClose: close, onSave, onLeave: leave } );
		this.controls = new ControlsView( { onClose: close } );

		this.mainMenu = new MainMenuView( menu );
		this.dock = new GameDock( {
			onSelect: ( name ) => this.toggle( name ),
			onPlay: () => {

				this.close();
				onResume();

			}
		} );
		this.panels = new PanelHost( {
			views: {
				QUESTS: this.quests,
				MAP: this.map,
				INVENTORY: this.inventory,
				CODEX: this.codex,
				CONTACTS: this.contacts,
				SETTINGS: this.settings,
				CONTROLS: this.controls
			},
			onOpen: ( name ) => {

				this.dock.setActive( name );
				this.#overlays();
				onOpen( name );

			},
			onClose: () => {

				this.dock.setActive( null );
				this.#overlays();
				onClose();

			}
		} );

		this.loadingScreen = new LoadingScreen();
		this.loading = this.loadingScreen.element;
		this.loadingStep = this.loadingScreen.line;
		this.loadingError = this.loadingScreen.error;

		this.element = el( 'div', { className: 'hud' },
			this.clock.element,
			this.prompt.element,
			this.shortcuts.element,
			this.inspection.element,
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
			this.free,
			this.panels.element,
			this.dock.element,
			this.loading,
			this.mainMenu.element
		);
		this.gameplayElements = [ ...this.element.children ].filter( ( element ) => element !== this.mainMenu.element );

		this.#overlays();

	}

	/** The pointer is free on the street with nothing open: a line says how to take it back, and that Escape opens the settings. */
	setPointerFree( free ) {

		this.free.hidden = ! free;

	}

	/** The developer readouts: where the player stands, the files loaded and the frame stats. */
	setDetails( shown ) {

		this.readout.element.hidden = ! shown;
		this.stats.element.hidden = ! shown;

	}

	mount( parent ) {

		parent.append( this.element );

	}

	/** Panel names: QUESTS, MAP, INVENTORY, CODEX, CONTACTS, SETTINGS, CONTROLS. */
	open( name ) {

		this.panels.open( name );

	}

	close() {

		this.panels.close();

	}

	toggle( name ) {

		this.panels.toggle( name );

	}

	/** The loader's line and, from LoadProgress, its record `{ label, step, done, total, part }`. */
	step( text, progress = null ) {

		this.loadingScreen.step( text, progress );

	}

	/** The game's name under the loading crystal, after the journal's eyebrow; null hides it. */
	setLoadingPlace( name ) {

		this.loadingScreen.setPlace( name );
		this.quests.setPlace( name );
		this.map.setPlace( name );

	}

	ready() {

		this.loadingScreen.ready();

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

	/**
	 * A gain shown where the eye is: a notice with its picture and, while a
	 * conversation is open, the same gain set apart in its transcript.
	 * `{ kind: 'item' | 'contact' | 'companion', title, text?, image?, item? }`:
	 * `image` is a URL or a promise of one; an `item` (an inventory card) is
	 * pictured by its thumbnail, drawn now.
	 */
	announce( { kind, title, text, image = null, item = null } ) {

		const picture = image ?? ( item ? this.preview.thumbnail( modelOf( item ), { now: true } ) : null );
		this.toast.show( { kind, title, text, image: picture } );
		if ( ( kind === 'item' || kind === 'contact' ) && ! this.dialog.element.hidden ) this.dialog.note( { kind, title, image: picture } );

	}

	/** The persistent objective, and the same record beside the city map. */
	setObjective( objective ) {

		this.objective.setObjective( objective );
		this.map.setObjective( objective );

	}

	/** The dock is up under an open panel, to move between the panels or back to play. */
	#overlays() {

		this.dock.element.hidden = ! this.panels.current;

	}

	fail( message ) {

		this.loadingScreen.fail( message );

	}

}
