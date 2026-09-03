import { GameView } from './views/GameView.js';

/**
 * Every view and widget with sample data, over a plain backdrop, so the
 * overlay can be styled without running the game: npm run dev, then
 * /src/ui/preview.html. Click the bar to open panels.
 */
const view = new GameView( {
	onSend: ( text ) => view.dialog.addMessage( { from: 'player', text } ),
	onSettingChange: ( change ) => console.log( 'setting', change ),
	onOpen: ( name ) => console.log( 'open', name ),
	onClose: () => console.log( 'close' ),
	onLeave: () => console.log( 'leave' ),
	onHangUp: () => view.call.setVisible( false ),
	onSummaryClose: () => view.summary.setVisible( false ),
	onCloseDialog: () => view.dialog.setVisible( false ),
	menu: {
		onContinue: ( id ) => console.log( 'continue', id ),
		onSave: ( id ) => console.log( 'save', id ),
		onLoad: ( file ) => console.log( 'load', file.name ),
		onExportCity: ( id ) => console.log( 'export city', id ),
		onGenerateCity: ( input ) => console.log( 'generate city', input ),
		onGenerateInstances: ( input ) => console.log( 'generate interiors', input ),
		onGenerateQuests: ( input ) => console.log( 'generate quests', input ),
		onCreateGame: ( input ) => console.log( 'create game', input )
	}
} );

view.mount( document.body );
view.ready();

const city = {
	bounds: { min: [ - 200, - 160 ], max: [ 220, 180 ] },
	roads: [
		{ path: [ [ - 200, 0 ], [ 220, 0 ] ], width: 12 },
		{ path: [ [ 0, - 160 ], [ 0, 180 ] ], width: 12 },
		{ path: [ [ - 200, - 90 ], [ 220, - 90 ] ], width: 8 },
		{ path: [ [ - 200, 90 ], [ 220, 90 ] ], width: 8 },
		{ path: [ [ - 110, - 160 ], [ - 110, 180 ] ], width: 8 },
		{ path: [ [ 110, - 160 ], [ 110, 180 ] ], width: 8 }
	],
	blocks: [],
	stations: [ { point: [ - 55, 45 ], name: 'Quay' }, { point: [ 165, - 45 ], name: 'Mill' } ],
	markers: [ { point: [ 60, - 130 ], label: 'meet Ada' } ]
};

for ( const x of [ - 200, - 110, 0, 110 ] ) {

	for ( const z of [ - 160, - 90, 0, 90 ] ) {

		city.blocks.push( [ [ x + 8, z + 8 ], [ x + 102, z + 8 ], [ x + 102, z + 82 ], [ x + 8, z + 82 ] ] );

	}

}

const venues = [
	{ point: { x: - 60, z: - 40 }, open: true },
	{ point: { x: 40, z: 30 }, open: false },
	{ point: { x: 150, z: 120 }, open: true }
];

view.map.setMap( city );
view.map.setVenues( venues );
view.map.setPlayer( { x: 12, z: - 20 }, 0.6 );
view.minimap.setMap( city );
view.minimap.setVenues( venues );
view.minimap.update( { x: 12, z: - 20 }, 0.6 );

view.clock.update( '21:14', 'Salt Wharf' );
view.clock.setState( 'night' );
view.readout.update( { x: 12, y: 0.12, z: - 20 }, 'Salt Wharf', 'p12' );
view.readout.setAbout( [ '/atlas/city-urbe-tiny.json', '/out/city-tiny' ] );
view.stats.update( { frameMs: 8.2, gpuMs: 3.1, drawCalls: 212, triangles: 1840000, lights: 340, tier: 'high', crowd: 187, cars: 14, interiors: 3 } );

view.inventory.setItems( [
	{ id: 'key', name: 'Brass key', kind: 'tool', description: 'Opens a door somewhere on the quay. The tag reads 4B.', place: 'Salt Wharf, unit 3' },
	{ id: 'note', name: 'Folded note', kind: 'paper', description: 'A phone number and the word "tonight".', place: 'Bar Nadir' }
] );
view.inventory.select( 0 );

view.quests.setQuests( [
	{ id: 'q1', title: 'Salt Wharf', text: 'Somebody has been moving containers off the last working quay at night. Find out who signs for them.', state: 'active', steps: [ { text: 'Talk to Ada Vance at the quay office', done: true }, { text: 'Check the freight ledger', done: false }, { text: 'Be at pier 4 after 23:00', done: false } ] },
	{ id: 'q2', title: 'Late shift', text: 'Cover the bar while Nadir is out.', state: 'done', steps: [ { text: 'Serve until close', done: true } ] }
] );

view.codex.setEntries( [
	{ id: 'p1', title: 'Ada Vance', category: 'people', text: 'Runs the quay office. Has signed for every container since the inland line shut.' },
	{ id: 'p2', title: 'Nadir', category: 'people', text: 'Owns the bar under the overpass.' },
	{ id: 'd1', title: 'Salt Wharf', category: 'places', text: 'The last quay still taking containers after the inland freight line shut.' }
] );

view.settings.setValues( { quality: 'high', fog: 0.0006, exposure: 0.024, crowd: 200 } );
view.controls.setBindings( [
	{ action: 'walk', keys: [ 'W', 'A', 'S', 'D' ] },
	{ action: 'run', keys: [ 'Shift' ] },
	{ action: 'doors and people', keys: [ 'E' ] },
	{ action: 'release the mouse', keys: [ 'Esc' ] },
	{ action: 'quests', keys: [ 'J' ] },
	{ action: 'map', keys: [ 'M' ] },
	{ action: 'inventory', keys: [ 'I' ] },
	{ action: 'codex', keys: [ 'X' ] },
	{ action: 'settings', keys: [ 'O' ] },
	{ action: 'controls', keys: [ '?' ] },
	{ action: 'leave', keys: [ 'N' ] }
] );

const portrait = document.createElement( 'canvas' );
portrait.width = 150;
portrait.height = 148;
const ctx = portrait.getContext( '2d' );
ctx.fillStyle = '#0d1a22';
ctx.fillRect( 0, 0, 150, 148 );
ctx.fillStyle = '#2ee6ff';
ctx.fillRect( 55, 30, 40, 40 );
ctx.fillRect( 40, 80, 70, 68 );
view.avatar.setAvatar( { name: 'Ada Vance', canvas: portrait, bar: 0.8 } );

view.dialog.setNpc( { name: 'Ada Vance', role: 'office worker' } );
view.dialog.setProfile( { facts: [ [ 'works at', 'quay office' ], [ 'shift', '09:00-17:00 day' ] ], now: 'working · indoors · parcel p40  (paused for you)', routine: [] } );
view.dialog.setTranscript( [
	{ from: 'npc', name: 'Ada', text: 'The ledger is in the back office. Nobody reads it but me.' },
	{ from: 'player', text: 'Who signs for the night containers?' }
] );
view.dialog.setVisible( true );

view.call.setName( 'Nadir' );
view.call.setVisible( true );
view.toast.show( { title: 'New mission', text: 'Salt Wharf: find out who signs for the night containers.' } );
view.setLibrary( {
	games: [ {
		id: 'salt-wharf', name: 'Salt Wharf', cityName: 'Rain Sector', theme: 'future noir', playable: true,
		mainSteps: 8, sideJobs: 4, interiors: 5, location: 'Quay Office', position: [ 12.4, 0.12, - 20.8 ],
		activeQuest: { title: 'Salt Wharf', objective: 'Check the freight ledger' },
		inventory: [ { name: 'Brass key' }, { name: 'Folded note' } ],
		locations: [ { name: 'Quay Office' }, { name: 'Bar Nadir' }, { name: 'Pier 4' } ]
	} ],
	cities: [ {
		id: 'rain-sector', name: 'Rain Sector', size: 'medium', seed: 'rain-44', buildings: 146, interiorCount: 5, districts: 7,
		availableBuildings: [ { id: 'p11', label: 'Quay Office', type: 'office' }, { id: 'p64', label: 'Bar Nadir', type: 'business' } ]
	} ]
} );
view.showMainMenu();
window.view = view;
