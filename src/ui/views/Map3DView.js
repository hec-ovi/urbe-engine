import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import { PanelHeader } from '../components/PanelHeader.js';

const WHEEL_STEP = 1.15;
const DISTANCE = { min: 40, max: 1600, start: 260 };
const PITCH = { min: 0.25, max: 1.45, start: 0.95 };
const COLORS = {
	sky: 0x0a0e14, roadway: 0x2f4358, sidewalk: 0x1b2430, block: 0x141a22, open: 0x1a2a24,
	building: 0x27313f, edge: 0x5a6d84, player: 0xcfe6ff, venueOpen: 0xffc46b, venueShut: 0x4a4136
};
const LEGEND = [
	[ 'you', COLORS.player ], [ 'venue open', COLORS.venueOpen ], [ 'venue shut', COLORS.venueShut ],
	[ 'building', COLORS.building ], [ 'road', COLORS.roadway ], [ 'pavement', COLORS.sidewalk ]
];

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
 * The city as blocks: every parcel prism and every ground polygon of the atlas
 * volumetrics, orbited around the player. Drag turns, wheel zooms, the frame
 * is rendered only on a change and never on its own.
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
		this.venueMarks = new THREE.Group();
		this.marker = this.#marker();
		this.scene.add( this.venueMarks, this.marker );
		this.scene.add( new THREE.HemisphereLight( 0x9fb4cc, 0x1a2230, 1.4 ) );

		this.canvas = el( 'canvas', { className: 'map-canvas' } );
		this.centreButton = el( 'button', { className: 'hud-button', type: 'button', textContent: 'centre on me' } );
		this.centreButton.addEventListener( 'click', () => this.centre() );
		this.stage = el( 'div', { className: 'map-stage' },
			this.canvas,
			el( 'div', { className: 'map-north' }, icon( 'north' ), 'N' ),
			el( 'div', { className: 'map-legend' }, ...LEGEND.map( ( [ label, color ] ) => el( 'div', { className: 'map-legend-item' },
				el( 'span', { className: 'map-swatch', style: `background:#${color.toString( 16 ).padStart( 6, '0' )}` } ),
				label
			) ) ),
			el( 'div', { className: 'map-tools' }, 'drag to turn, wheel to zoom', this.centreButton )
		);
		this.header = new PanelHeader( { title: 'Map', key: 'M', onClose } );
		this.element = el( 'div', { className: 'view view-map' }, this.header.element, this.stage );
		this.#bindPointer();

	}

	/**
	 * @param world { bounds: { min: [x,z], max: [x,z] }, buildings: [{ ring: [[x,z]], height }],
	 *   ground: [{ surface, polygon: [[x,z]] }] }
	 */
	setWorld( { bounds, buildings, ground } ) {

		for ( const old of [ this.blocks, this.edges, ...this.plates ] ) {

			if ( ! old ) continue;

			this.scene.remove( old );
			old.geometry.dispose();

		}

		const prisms = prismGeometry( buildings );
		this.blocks = new THREE.Mesh( prisms, new THREE.MeshLambertMaterial( { color: COLORS.building } ) );
		this.edges = new THREE.LineSegments( new THREE.EdgesGeometry( prisms, 20 ), new THREE.LineBasicMaterial( { color: COLORS.edge } ) );
		this.plates = [ [ 'roadway', 0.05 ], [ 'sidewalk', 0.2 ], [ 'block', 0.1 ], [ 'open', 0.1 ] ].map( ( [ surface, y ] ) =>
			new THREE.Mesh( plateGeometry( ground, surface, y ), new THREE.MeshLambertMaterial( { color: COLORS[ surface ] } ) ) );
		this.scene.add( this.blocks, this.edges, ...this.plates );

		this.bounds = bounds;
		this.target.set( ( bounds.min[ 0 ] + bounds.max[ 0 ] ) / 2, 0, ( bounds.min[ 1 ] + bounds.max[ 1 ] ) / 2 );
		this.orbit.distance = Math.min( DISTANCE.max, Math.max( bounds.max[ 0 ] - bounds.min[ 0 ], bounds.max[ 1 ] - bounds.min[ 1 ] ) * 0.9 );
		this.redraw();

	}

	/** @param venues [{ point: { x, z }, open }] */
	setVenues( venues ) {

		this.venueMarks.clear();

		for ( const venue of venues ) {

			const mark = new THREE.Mesh( new THREE.BoxGeometry( 3, 3, 3 ), new THREE.MeshBasicMaterial( { color: venue.open ? COLORS.venueOpen : COLORS.venueShut } ) );
			mark.position.set( venue.point.x, 2, venue.point.z );
			this.venueMarks.add( mark );

		}

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

	/** Back on the player, following again. */
	centre() {

		this.follow = true;
		this.orbit.distance = DISTANCE.start;

		if ( this.player ) this.target.set( this.player.x, 0, this.player.z );

		this.redraw();

	}

	/** The panel is on screen: the renderer exists from here on, sized to the stage. */
	shown() {

		if ( ! this.renderer ) {

			// No WebGL here (a test DOM, a blocked GPU): the panel stays a frame-less scene.
			if ( ! this.canvas.getContext( 'webgl2' ) ) return;

			this.renderer = new THREE.WebGLRenderer( { canvas: this.canvas, antialias: true } );

		}

		const width = this.stage.clientWidth || 1;
		const height = this.stage.clientHeight || 1;
		this.renderer.setPixelRatio( window.devicePixelRatio || 1 );
		this.renderer.setSize( width, height, false );
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.redraw();

	}

	redraw() {

		if ( ! this.renderer ) return;

		const { yaw, pitch, distance } = this.orbit;
		this.camera.position.set(
			this.target.x + Math.sin( yaw ) * Math.cos( pitch ) * distance,
			Math.sin( pitch ) * distance,
			this.target.z + Math.cos( yaw ) * Math.cos( pitch ) * distance
		);
		this.camera.lookAt( this.target );
		this.renderer.render( this.scene, this.camera );

	}

	#marker() {

		const cone = new THREE.Mesh( new THREE.ConeGeometry( 3, 8, 4 ), new THREE.MeshBasicMaterial( { color: COLORS.player } ) );
		cone.rotation.x = Math.PI / 2;
		const group = new THREE.Group();
		group.add( cone );
		group.visible = false;

		return group;

	}

	#bindPointer() {

		this.stage.addEventListener( 'pointerdown', ( event ) => {

			this.drag = { x: event.clientX, y: event.clientY };
			this.stage.classList.add( 'is-dragging' );
			this.stage.setPointerCapture?.( event.pointerId );

		} );
		this.stage.addEventListener( 'pointermove', ( event ) => {

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
		this.stage.addEventListener( 'pointerup', release );
		this.stage.addEventListener( 'pointercancel', release );
		this.stage.addEventListener( 'wheel', ( event ) => {

			event.preventDefault();
			const factor = event.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
			this.orbit.distance = Math.min( DISTANCE.max, Math.max( DISTANCE.min, this.orbit.distance * factor ) );
			this.redraw();

		}, { passive: false } );
		window.addEventListener( 'resize', () => {

			if ( ! this.element.hidden ) this.shown();

		} );

	}

}
