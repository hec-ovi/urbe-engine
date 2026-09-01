import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { takeTriangles, centroidAt } from './Triangles.js';
import { kelvinColor } from '../light/Color.js';

/** How far outside its shaft a door leaf may sit and still belong to it. */
const DOOR_REACH = 0.5;
/** Cab travel, in metres a second: a real lift in a low-rise building. */
const SPEED = 1.6;
/** And how long its doors take to run open or shut. */
const DOOR_TIME = 1.4;
/** Where the call panel floats: a pace out from the door, at hand height. */
const PANEL_OUT = 0.7;
const PANEL_HEIGHT = 1.1;
const CAB_CLEAR = 0.12;
const CAB_HEIGHT = 2.4;
const CAB_KEY = 'cyberpunk/metal/rich';
const CAB_LIGHT_KEY = 'cyberpunk/light-fixture/mid';
const CAB_KELVIN = 3800;
/** Looked at directly inside a small box, so it sits above street exposure. */
const CAB_EMISSIVE = 40;

/**
 * The lifts, made rideable.
 *
 * The interior box publishes the shafts and where each floor's doors are, and
 * the GLB already carries those doors as geometry, so nothing here invents a
 * lift: the published leaves are cut out of the floor band they arrived in and
 * given a slide, and a cab is built inside the shaft the shafts document
 * describes. Which triangles belong to which shaft is decided by where they
 * are, not by a convention about edge numbering, so the door plane and the way
 * it faces are read off the geometry itself.
 *
 * Riding is a call and a choice: E at a landing brings the cab and opens it, E
 * inside takes the next floor the shaft serves. While the cab moves it carries
 * whoever is standing in it, because the player is a character controller and
 * not something a moving collider can push.
 */
export class Elevators {

	constructor( factory ) {

		this.factory = factory;
		this.shafts = [];
		this.byBuilding = new Map();

	}

	/**
	 * The shafts of one building, from its floor documents. Called as the
	 * interior streams in; the same building twice replaces its shafts.
	 */
	add( parcelId, floors, group ) {

		const shafts = new Map();

		for ( const floor of floors ) {

			for ( const lift of floor.core?.elevators ?? [] ) {

				if ( ! shafts.has( lift.id ) ) shafts.set( lift.id, new Shaft( parcelId, lift, this.factory ) );

				shafts.get( lift.id ).serve( floor );

			}

		}

		const list = [ ...shafts.values() ];

		for ( const shaft of list ) group.add( shaft.build() );

		this.byBuilding.set( parcelId, list );
		this.shafts.push( ...list );

		return list;

	}

	/** Drops a building's shafts when its interior is let go. */
	remove( parcelId ) {

		const list = this.byBuilding.get( parcelId ) ?? [];

		this.byBuilding.delete( parcelId );
		this.shafts = this.shafts.filter( ( shaft ) => ! list.includes( shaft ) );

	}

	/**
	 * Takes this band's published door leaves into the shafts that own them.
	 * @returns the geometry left over, which is everything that is not a door.
	 */
	claim( parcelId, floor, geometry, material, group ) {

		const stops = ( this.byBuilding.get( parcelId ) ?? [] )
			.map( ( shaft ) => shaft.stopAt( floor ) )
			.filter( Boolean );

		if ( ! stops.length ) return geometry;

		const position = geometry.getAttribute( 'position' );
		const mine = stops.map( () => [] );
		const rest = [];

		for ( let i = 0; i < position.count; i += 3 ) {

			centroidAt( position, i, _centroid, _a, _b, _c );

			const slot = stops.findIndex( ( stop ) => stop.holds( _centroid ) );

			( slot < 0 ? rest : mine[ slot ] ).push( i );

		}

		stops.forEach( ( stop, i ) => {

			const leaves = stop.takeLeaves( geometry, mine[ i ], material );

			if ( leaves.length ) group.add( ...leaves );

		} );

		const left = takeTriangles( geometry, rest );
		geometry.dispose();

		return left;

	}

	/** Every landing and cab panel in reach, for the crosshair to choose from. */
	panels( feet, radius ) {

		const out = [];

		for ( const shaft of this.shafts ) out.push( ...shaft.panels( feet, radius ) );

		return out;

	}

	/** @param body PlayerBody, carried when it is standing in a moving cab. */
	update( delta, body ) {

		for ( const shaft of this.shafts ) shaft.update( delta, body );

	}

}

/** One lift: its cab, its landings, and where the cab is right now. */
class Shaft {

	constructor( parcelId, lift, factory ) {

		this.parcelId = parcelId;
		this.id = `${parcelId}:${lift.id}`;
		this.rect = lift.rect;
		this.factory = factory;
		this.stops = [];
		this.at = 0;
		this.target = 0;
		this.cab = null;

	}

	serve( floor ) {

		this.stops.push( new Stop( this, floor ) );

	}

	stopAt( floor ) {

		return this.stops.find( ( stop ) => stop.floor === floor ) ?? null;

	}

	/** The cab: a box open on the door side, with its own light in it. */
	build() {

		this.stops.sort( ( a, b ) => a.elevation - b.elevation );
		this.at = this.stops[ 0 ]?.elevation ?? 0;
		this.target = this.at;

		const group = new THREE.Group();
		group.name = `elevator:${this.id}`;

		const w = this.rect.w - CAB_CLEAR * 2;
		const d = this.rect.d - CAB_CLEAR * 2;
		const shell = [
			slab( w, 0.08, d, 0, 0.04, 0 ),
			slab( w, 0.06, d, 0, CAB_HEIGHT, 0 ),
			slab( 0.06, CAB_HEIGHT, d, - w / 2, CAB_HEIGHT / 2, 0 ),
			slab( 0.06, CAB_HEIGHT, d, w / 2, CAB_HEIGHT / 2, 0 ),
			slab( w, CAB_HEIGHT, 0.06, 0, CAB_HEIGHT / 2, - d / 2 )
		];

		const body = new THREE.Mesh(
			BufferGeometryUtils.mergeGeometries( shell, false ),
			this.factory.build( CAB_KEY )
		);
		const lamp = new THREE.Mesh(
			slab( w * 0.5, 0.04, d * 0.5, 0, CAB_HEIGHT - 0.08, 0 ),
			this.factory.variant( CAB_LIGHT_KEY, { emissiveScale: CAB_EMISSIVE, emissive: kelvinColor( CAB_KELVIN ) } )
		);

		this.cab = group;
		group.add( body, lamp );
		group.position.set( this.rect.x, this.at, this.rect.z );

		return group;

	}

	get moving() {

		return Math.abs( this.target - this.at ) > 1e-3;

	}

	/** Whether a point stands on the cab floor. */
	holds( point ) {

		return point.y >= this.at - 0.4 && point.y < this.at + CAB_HEIGHT
			&& Math.abs( point.x - this.rect.x ) < this.rect.w / 2
			&& Math.abs( point.z - this.rect.z ) < this.rect.d / 2;

	}

	panels( feet, radius ) {

		const out = [];

		for ( const stop of this.stops ) {

			if ( stop.panel && stop.panel.distanceTo( feet ) < radius ) {

				out.push( { kind: 'elevator', shaft: this, stop, center: stop.panel, inside: false } );

			}

		}

		if ( this.holds( feet ) ) {

			out.push( {
				kind: 'elevator', shaft: this, stop: null, inside: true,
				center: new THREE.Vector3( this.rect.x, this.at + PANEL_HEIGHT, this.rect.z )
			} );

		}

		return out;

	}

	/** E on a landing calls the cab; E inside takes the next floor served. */
	press( target ) {

		if ( this.moving ) return;

		if ( target.inside ) {

			const here = this.stops.findIndex( ( stop ) => Math.abs( stop.elevation - this.at ) < 0.05 );

			this.target = this.stops[ ( here + 1 ) % this.stops.length ].elevation;

		} else {

			this.target = target.stop.elevation;

		}

	}

	/** What the prompt says about this lift right now. */
	label( target ) {

		if ( this.moving ) return 'the lift is moving';

		return target.inside ? 'E  next floor' : 'E  call the lift';

	}

	update( delta, body ) {

		// The doors are shut whenever the cab is not standing at that landing.
		for ( const stop of this.stops ) {

			stop.setOpen( ! this.moving && Math.abs( stop.elevation - this.at ) < 0.05, delta );

		}

		if ( ! this.moving ) return;

		const step = Math.sign( this.target - this.at ) * SPEED * delta;
		const dy = Math.abs( step ) >= Math.abs( this.target - this.at ) ? this.target - this.at : step;
		const riding = this.holds( body.feet );

		this.at += dy;
		this.cab.position.y = this.at;

		// A character controller is not pushed by a moving collider, so the
		// floor moving under the player has to be applied to the player.
		if ( riding ) body.teleport( _lift.copy( body.feet ).setY( body.feet.y + dy ) );

	}

}

/** One landing: the published door leaves at one floor, and their slide. */
class Stop {

	constructor( shaft, floor ) {

		this.shaft = shaft;
		this.floor = floor.floor;
		this.elevation = floor.elevation;
		this.height = floor.height;
		this.open = 0;
		this.wanted = 0;
		this.leaves = [];
		this.panel = null;

	}

	/** A triangle of this floor standing in or just outside this shaft. */
	holds( point ) {

		return point.y >= this.elevation - 0.2 && point.y < this.elevation + this.height
			&& Math.abs( point.x - this.shaft.rect.x ) < this.shaft.rect.w / 2 + DOOR_REACH
			&& Math.abs( point.z - this.shaft.rect.z ) < this.shaft.rect.d / 2 + DOOR_REACH;

	}

	/**
	 * Splits the claimed triangles into two leaves and hangs them on sliders.
	 * The door plane, which way it faces and how wide it is all come off the
	 * geometry, so no convention about which edge of a shaft rect is the front
	 * has to be right.
	 */
	takeLeaves( geometry, starts, material ) {

		if ( ! starts.length ) return [];

		const box = new THREE.Box3();
		const position = geometry.getAttribute( 'position' );

		for ( const start of starts ) {

			for ( let v = 0; v < 3; v ++ ) box.expandByPoint( _a.fromBufferAttribute( position, start + v ) );

		}

		const size = box.getSize( new THREE.Vector3() );
		const centre = box.getCenter( new THREE.Vector3() );
		// The door is thin one way and wide the other; the thin axis is the way
		// it faces and the wide one is the way its leaves run.
		const acrossX = size.x >= size.z;
		const width = acrossX ? size.x : size.z;
		const facing = new THREE.Vector3(
			acrossX ? 0 : Math.sign( centre.x - this.shaft.rect.x ) || 1,
			0,
			acrossX ? Math.sign( centre.z - this.shaft.rect.z ) || 1 : 0
		);

		const left = [];
		const right = [];

		for ( const start of starts ) {

			centroidAt( position, start, _centroid, _a, _b, _c );
			( ( acrossX ? _centroid.x : _centroid.z ) < ( acrossX ? centre.x : centre.z ) ? left : right ).push( start );

		}

		for ( const [ side, indices ] of [ [ - 1, left ], [ 1, right ] ] ) {

			const part = takeTriangles( geometry, indices );

			if ( ! part ) continue;

			const pivot = new THREE.Group();
			pivot.userData.slide = acrossX
				? new THREE.Vector3( side * width / 2, 0, 0 )
				: new THREE.Vector3( 0, 0, side * width / 2 );
			pivot.add( new THREE.Mesh( part, material ) );
			this.leaves.push( pivot );

		}

		this.panel = centre.clone().addScaledVector( facing, PANEL_OUT ).setY( this.elevation + PANEL_HEIGHT );

		return this.leaves;

	}

	setOpen( wanted, delta ) {

		this.wanted = wanted ? 1 : 0;

		if ( this.open === this.wanted ) return;

		const step = delta / DOOR_TIME;
		this.open = this.wanted > this.open
			? Math.min( 1, this.open + step )
			: Math.max( 0, this.open - step );

		for ( const leaf of this.leaves ) leaf.position.copy( leaf.userData.slide ).multiplyScalar( this.open );

	}

}

/** An axis-aligned slab of geometry, in metres, around the cab's own origin. */
function slab( w, h, d, x, y, z ) {

	const box = new THREE.BoxGeometry( w, h, d );
	box.deleteAttribute( 'uv1' );
	box.translate( x, y, z );

	return box.toNonIndexed();

}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _lift = new THREE.Vector3();
