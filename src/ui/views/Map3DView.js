import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';
import layout from './map-layout.json' with { type: 'json' };

const WHEEL_STEP = 1.15;
const BUTTON_STEP = WHEEL_STEP * WHEEL_STEP;
const DISTANCE = { min: 40, max: 1600, start: 260 };
const PITCH = { min: 0.25, max: 1.45, start: 1.15 };
/** The city in the screens' teal: blocks over the ground, the player cyan, the objective and its way amber. */
const COLORS = {
	sky: 0x071c21, roadway: 0x24464b, sidewalk: 0x1a383c, block: 0x0f292e, open: 0x1c4439,
	building: 0x1f4a50, edge: 0x5f9c9a, player: 0x73ecdf, venueOpen: 0xdfeee6, venueShut: 0x3d5a5c,
	bus: 0x73ecdf, train: 0x9fdcb0, subway: 0xa99cf0, route: 0xefc082, objective: 0xefc082
};
/** The objective's diamond stands this high, over the roofs of a low street. */
const OBJECTIVE_HEIGHT = 6;

/** A ring of [x, z] as a three Shape lying in the ground plane once rotated onto XZ. */
function shapeOf( ring ) {

	return new THREE.Shape( ring.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );

}

/** Every building's prism, one geometry, +Y up. */
export function prismGeometry( buildings ) {

	const parts = buildings
		.filter( ( building ) => building.ring.length >= 3 && building.height > 0 )
		.map( ( building ) => new THREE.ExtrudeGeometry( shapeOf( building.ring ), { depth: building.height, bevelEnabled: false } ).rotateX( - Math.PI / 2 ) );

	return parts.length ? BufferGeometryUtils.mergeGeometries( parts, false ) : new THREE.BufferGeometry();

}

/** The ground cover of one surface kind as flat plates a hair above the plane. */
export function plateGeometry( ground, surface, y ) {

	const parts = ground
		.filter( ( cover ) => cover.surface === surface && cover.polygon.length >= 3 )
		.map( ( cover ) => new THREE.ShapeGeometry( shapeOf( cover.polygon ) ).rotateX( - Math.PI / 2 ).translate( 0, y, 0 ) );

	return parts.length ? BufferGeometryUtils.mergeGeometries( parts, false ) : new THREE.BufferGeometry();

}

/**
 * The city map: every parcel prism and every ground polygon of the atlas
 * volumetrics, orbited around the player, framed as a full screen: layer
 * toggles and the zoom stack over it, a compass that turns with it, the
 * current objective and where the player stands beside it, the legend under
 * it. Drag turns, wheel or the stack zooms; the frame is rendered only on a
 * change and never on its own. Labels come from [map-layout.json](map-layout.json)
 * ([schema](map-layout.schema.json)).
 * props: { onClose }
 */
export class Map3DView {

	constructor( { onClose } ) {

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color( COLORS.sky );
		this.camera = new THREE.PerspectiveCamera( 50, 1, 1, 6000 );
		this.orbit = { yaw: 0.6, pitch: PITCH.start, distance: DISTANCE.start };
		this.target = new THREE.Vector3();
		this.player = null;
		this.follow = true;
		this.renderer = null;
		this.drag = null;
		this.blocks = null;
		this.edges = null;
		this.plates = [];
		this.route = null;
		this.transitRoutes = new THREE.Group();
		this.transitPlaces = new THREE.Group();
		this.venueMarks = new THREE.Group();
		this.venueGeometry = new THREE.CylinderGeometry( 2.4, 2.4, 0.8, 16 );
		this.venueMaterials = {
			open: new THREE.MeshBasicMaterial( { color: COLORS.venueOpen } ),
			shut: new THREE.MeshBasicMaterial( { color: COLORS.venueShut } )
		};
		this.routeLine = null;
		this.objectiveMark = new THREE.Mesh(
			new THREE.OctahedronGeometry( 3.2 ),
			new THREE.MeshBasicMaterial( { color: COLORS.objective, depthTest: false } )
		);
		this.objectiveMark.renderOrder = 8;
		this.objectiveMark.visible = false;
		this.marker = this.#marker();
		this.scene.add( this.transitRoutes, this.transitPlaces, this.venueMarks, this.marker, this.objectiveMark );
		this.scene.add( new THREE.HemisphereLight( 0xbfe4df, 0x10262b, 1.5 ) );
		const sun = new THREE.DirectionalLight( 0xffe7c7, 0.6 );
		sun.position.set( - 2, 5, 3 );
		this.scene.add( sun );

		this.canvas = el( 'canvas', { className: 'map-canvas' } );
		this.layers = {
			route: this.#layer( 'route', layout.layers.route, [ () => this.routeLine, () => this.route && this.objectiveMark ] ),
			transit: this.#layer( 'transit', layout.layers.transit, [ () => this.transitRoutes, () => this.transitPlaces ] ),
			places: this.#layer( 'places', layout.layers.places, [ () => this.venueMarks ] )
		};
		this.needle = el( 'span', { className: 'map-needle', ariaHidden: 'true' } );
		this.centreButton = this.#tool( '⌖', layout.tools.centre, () => this.centre() );
		this.stage = el( 'div', { className: 'map-stage' },
			this.canvas,
			el( 'div', { className: 'map-layers', role: 'group', ariaLabel: layout.layers.label }, ...Object.values( this.layers ).map( ( layer ) => layer.button ) ),
			el( 'div', { className: 'map-tools', role: 'group', ariaLabel: layout.tools.label },
				el( 'div', { className: 'map-compass' }, this.needle, el( 'span', { textContent: layout.north } ) ),
				this.#tool( '+', layout.tools.zoomIn, () => this.#zoom( 1 / BUTTON_STEP ) ),
				this.#tool( '−', layout.tools.zoomOut, () => this.#zoom( BUTTON_STEP ) ),
				this.centreButton,
				this.#tool( '⤢', layout.tools.whole, () => this.whole() )
			)
		);

		this.objectivePlace = el( 'h3', { className: 'map-side-title' } );
		this.objectiveQuest = el( 'p', { className: 'map-side-quest' } );
		this.objectiveText = el( 'p', { className: 'map-side-text' } );
		this.walk = el( 'dd' );
		this.distance = el( 'dd' );
		this.facts = el( 'dl', { className: 'map-side-facts' },
			el( 'div', {}, el( 'dt', { textContent: layout.objective.walk } ), this.walk ),
			el( 'div', {}, el( 'dt', { textContent: layout.objective.distance } ), this.distance )
		);
		this.hours = el( 'p', { className: 'map-side-hours' } );
		this.showWay = el( 'button', { className: 'screen-button is-primary map-show-way', type: 'button', textContent: layout.objective.show } );
		this.showWay.addEventListener( 'click', () => this.frameRoute() );
		this.herePlace = el( 'strong', { className: 'map-here-place' } );
		this.hereDistrict = el( 'span', { className: 'map-here-district' } );
		this.side = el( 'aside', { className: 'map-side' },
			el( 'p', { className: 'map-side-eyebrow', textContent: layout.objective.eyebrow } ),
			this.objectivePlace, this.objectiveQuest,
			el( 'span', { className: 'map-side-rule', ariaHidden: 'true' } ),
			this.objectiveText, this.facts, this.hours, this.showWay,
			el( 'div', { className: 'map-here' },
				el( 'p', { className: 'map-side-eyebrow', textContent: layout.here } ),
				this.herePlace, this.hereDistrict
			)
		);

		this.header = new PanelHeader( { title: layout.title, eyebrow: layout.eyebrow, onClose } );
		this.element = el( 'div', { className: 'view view-map' },
			this.header.element,
			el( 'div', { className: 'map-body' }, this.stage, this.side ),
			el( 'footer', { className: 'map-footer' },
				el( 'div', { className: 'map-legend' },
					legend( 'you', layout.legend.you ), legend( 'objective', layout.legend.objective ),
					legend( 'open', layout.legend.open ), legend( 'shut', layout.legend.shut ), legend( 'transit', layout.legend.transit )
				),
				el( 'span', { className: 'map-hint', textContent: layout.hint } )
			)
		);
		this.setObjective( null );
		this.setLocation( '', '' );
		this.#bindPointer();

	}

	/**
	 * @param world { bounds: { min: [x,z], max: [x,z] }, buildings: [{ ring: [[x,z]], height }],
	 *   ground: [{ surface, polygon: [[x,z]] }], transit: { routes, places } }
	 */
	setWorld( { bounds, buildings, ground, transit } ) {

		for ( const old of [ this.blocks, this.edges, ...this.plates ] ) {

			if ( ! old ) continue;

			this.scene.remove( old );
			old.geometry.dispose();

		}

		const prisms = prismGeometry( buildings );
		this.blocks = new THREE.Mesh( prisms, new THREE.MeshLambertMaterial( { color: COLORS.building } ) );
		this.edges = new THREE.LineSegments( new THREE.EdgesGeometry( prisms, 20 ), new THREE.LineBasicMaterial( { color: COLORS.edge, transparent: true, opacity: 0.55 } ) );
		this.plates = [ [ 'roadway', 0.05 ], [ 'sidewalk', 0.2 ], [ 'block', 0.1 ], [ 'open', 0.1 ] ].map( ( [ surface, y ] ) =>
			new THREE.Mesh( plateGeometry( ground, surface, y ), new THREE.MeshLambertMaterial( { color: COLORS[ surface ] } ) ) );
		this.scene.add( this.blocks, this.edges, ...this.plates );
		this.#setTransit( transit );

		this.bounds = bounds;
		this.target.set( ( bounds.min[ 0 ] + bounds.max[ 0 ] ) / 2, 0, ( bounds.min[ 1 ] + bounds.max[ 1 ] ) / 2 );
		this.orbit.distance = Math.min( DISTANCE.max, Math.max( bounds.max[ 0 ] - bounds.min[ 0 ], bounds.max[ 1 ] - bounds.min[ 1 ] ) * 0.9 );
		this.redraw();

	}

	#setTransit( { routes, places } ) {

		clearGroup( this.transitRoutes );
		clearGroup( this.transitPlaces );

		for ( const route of routes ) {

			const line = new THREE.Line(
				new THREE.BufferGeometry().setFromPoints( route.path.map( ( point ) => new THREE.Vector3( ...point ) ) ),
				new THREE.LineBasicMaterial( { color: COLORS[ route.kind ], depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 } )
			);
			line.name = `transit-route:${route.id}`;
			line.renderOrder = 5;
			this.transitRoutes.add( line );

		}

		for ( const place of places ) {

			const mark = new THREE.Mesh(
				new THREE.BoxGeometry( 4, 1.5, 4 ),
				new THREE.MeshBasicMaterial( { color: COLORS[ place.kind ], depthTest: false, depthWrite: false } )
			);
			mark.name = `transit-place:${place.id}`;
			mark.position.set( place.point[ 0 ], place.point[ 1 ] + 0.75, place.point[ 2 ] );
			mark.userData.point = [ ...place.point ];
			mark.renderOrder = 6;
			this.transitPlaces.add( mark );

		}

	}

	/** @param venues [{ point: { x, z }, open }] */
	setVenues( venues ) {

		this.venueMarks.clear();

		for ( const venue of venues ) {

			const mark = new THREE.Mesh( this.venueGeometry, venue.open ? this.venueMaterials.open : this.venueMaterials.shut );
			mark.position.set( venue.point.x, 1.4, venue.point.z );
			this.venueMarks.add( mark );

		}

		this.redraw();

	}

	/** @param route { path: [[x,z]], label: string } or null */
	setRoute( route ) {

		if ( this.routeLine ) {

			this.scene.remove( this.routeLine );
			this.routeLine.geometry.dispose();
			this.routeLine.material.dispose();
			this.routeLine = null;

		}

		this.route = route?.path.length ? route : null;
		this.objectiveMark.visible = false;
		if ( this.route ) {

			const points = route.path.map( ( [ x, z ] ) => new THREE.Vector3( x, 0.5, z ) );
			this.routeLine = new THREE.Line(
				new THREE.BufferGeometry().setFromPoints( points ),
				new THREE.LineBasicMaterial( { color: COLORS.route, depthTest: false, depthWrite: false } )
			);
			this.routeLine.name = 'objective-route';
			this.routeLine.renderOrder = 7;
			this.routeLine.visible = this.layers.route.on;
			this.scene.add( this.routeLine );
			this.objectiveMark.position.copy( points.at( - 1 ) ).setY( OBJECTIVE_HEIGHT );
			this.objectiveMark.visible = this.layers.route.on;

		}
		this.showWay.hidden = ! this.route;
		this.redraw();

	}

	/** @param position { x, y, z } feet; @param heading radians, 0 facing -Z */
	setPlayer( position, heading ) {

		this.player = { x: position.x, z: position.z, heading };
		this.marker.position.set( position.x, position.y + 2, position.z );
		this.marker.rotation.y = heading;
		this.marker.visible = true;

		if ( this.follow ) this.target.set( position.x, 0, position.z );

		this.redraw();

	}

	/**
	 * The objective beside the map, the HUD's record: { title, objective, state, note?,
	 * place: { name, distanceMeters?, window? } } or null.
	 */
	setObjective( objective ) {

		const shown = Boolean( objective && ( objective.title || objective.objective ) );
		const place = objective?.place ?? null;
		this.objectivePlace.textContent = shown ? place?.name ?? objective.title : layout.objective.none;
		this.objectiveQuest.textContent = shown && place?.name ? objective.title ?? '' : '';
		this.objectiveQuest.hidden = ! this.objectiveQuest.textContent;
		this.objectiveText.textContent = shown ? objective.note ?? objective.objective ?? '' : layout.objective.noneText;
		const metres = Number.isFinite( place?.distanceMeters ) ? Math.round( place.distanceMeters ) : null;
		this.facts.hidden = metres === null;
		if ( metres !== null ) {

			this.walk.textContent = layout.objective.minutes.replace( '{minutes}', Math.max( 1, Math.round( metres / layout.walkingSpeed / 60 ) ) );
			this.distance.textContent = layout.objective.metres.replace( '{metres}', metres );

		}
		const window = place?.window;
		this.hours.textContent = window?.label && Number.isFinite( window.startMin ) && Number.isFinite( window.endMin )
			? fill( layout.objective.opens, { label: window.label, start: clock( window.startMin ), end: clock( window.endMin ) } ) : '';
		this.hours.hidden = ! this.hours.textContent;
		this.side.classList.toggle( 'is-idle', ! shown );
		this.side.classList.toggle( 'is-unavailable', objective?.state === 'unavailable' );

	}

	/** Where the player stands: the place's name and its district. */
	setLocation( place, district ) {

		if ( this.herePlace.textContent !== ( place ?? '' ) ) this.herePlace.textContent = place ?? '';
		if ( this.hereDistrict.textContent !== ( district ?? '' ) ) this.hereDistrict.textContent = district ?? '';

	}

	/** The game's name beside the title. */
	setPlace( name ) {

		this.header.subtitle.textContent = name ?? '';
		this.header.subtitle.hidden = ! name;

	}

	/** Back on the player, following again. */
	centre() {

		this.follow = true;
		this.orbit.distance = DISTANCE.start;

		if ( this.player ) this.target.set( this.player.x, 0, this.player.z );

		this.redraw();

	}

	/** The whole city in view, no longer following. */
	whole() {

		if ( ! this.bounds ) return;
		this.follow = false;
		const { min, max } = this.bounds;
		this.target.set( ( min[ 0 ] + max[ 0 ] ) / 2, 0, ( min[ 1 ] + max[ 1 ] ) / 2 );
		this.orbit.distance = Math.min( DISTANCE.max, Math.max( max[ 0 ] - min[ 0 ], max[ 1 ] - min[ 1 ] ) * 0.9 );
		this.redraw();

	}

	/** The player and the objective's way in view, no longer following. */
	frameRoute() {

		if ( ! this.route ) return;
		const points = [ ...this.route.path, ...( this.player ? [ [ this.player.x, this.player.z ] ] : [] ) ];
		const xs = points.map( ( point ) => point[ 0 ] ), zs = points.map( ( point ) => point[ 1 ] );
		const extent = Math.max( Math.max( ...xs ) - Math.min( ...xs ), Math.max( ...zs ) - Math.min( ...zs ) );
		this.follow = false;
		this.target.set( ( Math.max( ...xs ) + Math.min( ...xs ) ) / 2, 0, ( Math.max( ...zs ) + Math.min( ...zs ) ) / 2 );
		this.orbit.distance = Math.min( DISTANCE.max, Math.max( DISTANCE.min * 2, extent * 1.3 ) );
		this.redraw();

	}

	/** The panel is on screen: the renderer exists from here on, sized to the stage. */
	shown() {

		if ( ! this.renderer ) {

			// No WebGL here (a test DOM, a blocked GPU): the panel stays a frame-less scene.
			if ( ! this.canvas.getContext( 'webgl2' ) ) return;

			this.renderer = new THREE.WebGLRenderer( { canvas: this.canvas, antialias: true } );

		}

		const width = this.canvas.clientWidth || this.stage.clientWidth || 1;
		const height = this.canvas.clientHeight || this.stage.clientHeight || 1;
		this.renderer.setPixelRatio( Math.min( window.devicePixelRatio || 1, 2 ) );
		this.renderer.setSize( width, height, false );
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.redraw();

	}

	redraw() {

		const { yaw, pitch, distance } = this.orbit;
		this.needle.style.transform = `rotate(${yaw}rad)`;
		if ( ! this.renderer ) return;

		this.camera.position.set(
			this.target.x + Math.sin( yaw ) * Math.cos( pitch ) * distance,
			Math.sin( pitch ) * distance,
			this.target.z + Math.cos( yaw ) * Math.cos( pitch ) * distance
		);
		this.camera.lookAt( this.target );
		this.renderer.render( this.scene, this.camera );

	}

	#zoom( factor ) {

		this.orbit.distance = Math.min( DISTANCE.max, Math.max( DISTANCE.min, this.orbit.distance * factor ) );
		this.redraw();

	}

	#layer( name, label, parts ) {

		const button = el( 'button', { className: 'map-layer', type: 'button', textContent: label } );
		button.setAttribute( 'aria-pressed', 'true' );
		const layer = { button, on: true };
		button.addEventListener( 'click', () => {

			layer.on = ! layer.on;
			button.setAttribute( 'aria-pressed', String( layer.on ) );
			for ( const part of parts ) {

				const object = part();
				if ( object ) object.visible = layer.on;

			}
			this.redraw();

		} );
		return layer;

	}

	#tool( text, label, onClick ) {

		const button = el( 'button', { className: 'map-tool', type: 'button', textContent: text } );
		button.setAttribute( 'aria-label', label );
		button.title = label;
		button.addEventListener( 'click', onClick );
		return button;

	}

	#marker() {

		const cone = new THREE.Mesh( new THREE.ConeGeometry( 3, 8, 4 ), new THREE.MeshBasicMaterial( { color: COLORS.player, depthTest: false } ) );
		cone.rotation.x = - Math.PI / 2;
		cone.renderOrder = 9;
		const group = new THREE.Group();
		group.add( cone );
		group.visible = false;

		return group;

	}

	#bindPointer() {

		this.canvas.addEventListener( 'pointerdown', ( event ) => {

			this.drag = { x: event.clientX, y: event.clientY };
			this.stage.classList.add( 'is-dragging' );
			this.canvas.setPointerCapture?.( event.pointerId );

		} );
		this.canvas.addEventListener( 'pointermove', ( event ) => {

			if ( ! this.drag ) return;

			this.orbit.yaw -= ( event.clientX - this.drag.x ) * 0.006;
			this.orbit.pitch = Math.min( PITCH.max, Math.max( PITCH.min, this.orbit.pitch + ( event.clientY - this.drag.y ) * 0.004 ) );
			this.drag = { x: event.clientX, y: event.clientY };
			this.redraw();

		} );
		const release = () => {

			this.drag = null;
			this.stage.classList.remove( 'is-dragging' );

		};
		this.canvas.addEventListener( 'pointerup', release );
		this.canvas.addEventListener( 'pointercancel', release );
		this.canvas.addEventListener( 'wheel', ( event ) => {

			event.preventDefault();
			this.#zoom( event.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP );

		}, { passive: false } );
		window.addEventListener( 'resize', () => {

			if ( ! this.element.hidden ) this.shown();

		} );

	}

}

function legend( kind, label ) {

	return el( 'span', { className: 'map-legend-item' }, el( 'span', { className: `map-legend-mark is-${kind}`, ariaHidden: 'true' } ), label );

}

function clearGroup( group ) {

	for ( const child of [ ...group.children ] ) {

		child.geometry?.dispose();
		if ( Array.isArray( child.material ) ) child.material.forEach( ( material ) => material.dispose() );
		else child.material?.dispose();
		group.remove( child );

	}

}

function clock( minuteOfDay ) {

	return `${String( Math.floor( minuteOfDay / 60 ) % 24 ).padStart( 2, '0' )}:${String( minuteOfDay % 60 ).padStart( 2, '0' )}`;

}

function fill( template, values ) {

	return template.replace( /\{(\w+)\}/g, ( match, name ) => String( values[ name ] ?? match ) );

}
