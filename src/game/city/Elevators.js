import * as THREE from 'three/webgpu';
import { takeTriangles, centroidAt } from './Triangles.js';
import { kelvinColor } from '../light/Color.js';

/** The published modules the shafts own: the car that rides and the leaves that slide. */
const CAR_MODULE = 'lift-car';
/** How far outside its shaft a door leaf may sit and still belong to it. */
const DOOR_REACH = 0.5;
/** Cab travel, in metres a second: a real lift in a low-rise building. */
const SPEED = 1.6;
/** And how long its doors take to run open or shut. */
const DOOR_TIME = 1.4;
/** Where the call panel floats: a pace out from the door, at hand height. */
const PANEL_OUT = 0.7;
const PANEL_HEIGHT = 1.1;
/** The call plate: past the jamb, a hand wide, standing a little proud of the wall. */
const PLATE_OFF = 0.25;
const PLATE_WIDTH = 0.12;
const PLATE_HEIGHT = 0.18;
const PLATE_PROUD = 0.015;
const CAB_HEIGHT = 2.4;
const CAB_LIGHT_KEY = 'cyberpunk/light-fixture/mid';
const CAB_KELVIN = 3800;
/** Looked at directly inside a small box, so it sits above street exposure. */
const CAB_EMISSIVE = 120;

/**
 * The lifts, made rideable.
 *
 * The interior box publishes the shafts in its floor documents and places the
 * car and the landing leaves as modules, so nothing here invents a lift: the
 * published car stands in a group that rides its shaft, and each landing's
 * leaves are that module split at its own centre and hung on sliders. Which
 * shaft a placement belongs to is decided by where it stands, not by a
 * convention about edge numbering.
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
	 * Lets go of the leaves claimed at one floor when its band leaves memory;
	 * the next load of that floor claims them again.
	 */
	release( parcelId, floor ) {

		for ( const shaft of this.byBuilding.get( parcelId ) ?? [] ) shaft.stopAt( floor )?.release();

	}

	/**
	 * Binds one floor's lift modules to the shaft that owns them.
	 *
	 * The car and the landing leaves move, so their copies are drawn here
	 * rather than instanced with the rest of the floor: the car is the
	 * published module standing in the group that rides the shaft, and the
	 * leaves are that module split at its own centre and hung on sliders.
	 *
	 * @param placement a `lift-car` or `lift-doors` placement, in its floor's frame
	 * @param modules the city module catalog
	 * @param group the floor's own content, which owns the leaves
	 * @returns whether a shaft took it
	 */
	mount( parcelId, floor, placement, modules, group ) {

		const stops = ( this.byBuilding.get( parcelId ) ?? [] )
			.map( ( shaft ) => shaft.stopAt( floor ) )
			.filter( ( stop ) => stop?.owns( placement.position ) );

		if ( ! stops.length ) return false;

		const [ stop ] = stops;

		if ( placement.module === CAR_MODULE ) {

			stop.shaft.mountCar( placement, modules );
			return true;

		}

		const leaves = stop.mount( placement, modules.surfacesOf( placement.module ) );

		if ( leaves.length ) group.add( ...leaves );

		return true;

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
		// A core rect is published by its minimum corner; the shaft is its middle.
		this.rect = lift.rect;
		this.centre = { x: lift.rect.x + lift.rect.w / 2, z: lift.rect.z + lift.rect.d / 2 };
		this.factory = factory;
		this.stops = [];
		this.at = 0;
		this.target = 0;
		this.cab = null;
		this.car = null;

	}

	serve( floor ) {

		this.stops.push( new Stop( this, floor ) );

	}

	stopAt( floor ) {

		return this.stops.find( ( stop ) => stop.floor === floor ) ?? null;

	}

	/** The cab: the group that rides the shaft, with its own light in it. */
	build() {

		this.stops.sort( ( a, b ) => a.elevation - b.elevation );
		// The cab waits where people come in: the ground floor when the shaft serves it, else its lowest stop.
		this.at = ( this.stops.find( ( stop ) => stop.floor === 0 ) ?? this.stops[ 0 ] )?.elevation ?? 0;
		this.target = this.at;

		const group = new THREE.Group();
		group.name = `elevator:${this.id}`;
		group.position.set( this.centre.x, this.at, this.centre.z );

		this.cab = group;

		return group;

	}

	/**
	 * Stands the published car in the cab, once per shaft: every floor places
	 * the same car at the same pose, and only one of them rides.
	 */
	mountCar( placement, modules ) {

		if ( this.car ) return;

		const bounds = modules.boundsOf( placement.module );
		const surfaces = modules.surfacesOf( placement.module );
		if ( ! bounds || ! surfaces.length ) return;

		const car = new THREE.Group();
		car.rotation.y = placement.rotationY;
		car.scale.set( ...placement.scale );

		for ( const { geometry, material } of surfaces ) car.add( new THREE.Mesh( geometry, material ) );

		const [ width, height, depth ] = bounds.size;
		car.add( new THREE.Mesh(
			slab( width * 0.5, 0.04, depth * 0.5, 0, height - 0.16, 0 ),
			this.factory.variant( CAB_LIGHT_KEY, { emissiveLevel: CAB_EMISSIVE, emissive: kelvinColor( CAB_KELVIN ) } )
		) );

		this.car = car;
		this.cab.add( car );

	}

	get moving() {

		return Math.abs( this.target - this.at ) > 1e-3;

	}

	/** Whether a point stands on the cab floor. */
	holds( point ) {

		return point.y >= this.at - 0.4 && point.y < this.at + CAB_HEIGHT
			&& Math.abs( point.x - this.centre.x ) < this.rect.w / 2
			&& Math.abs( point.z - this.centre.z ) < this.rect.d / 2;

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
				center: new THREE.Vector3( this.centre.x, this.at + PANEL_HEIGHT, this.centre.z )
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
		this.pivot = null;
		this.panel = null;

	}

	/** Whether a placement of this floor stands in or just outside this shaft. */
	owns( position ) {

		return Math.abs( position[ 0 ] - this.shaft.centre.x ) < this.shaft.rect.w / 2 + DOOR_REACH
			&& Math.abs( position[ 2 ] - this.shaft.centre.z ) < this.shaft.rect.d / 2 + DOOR_REACH;

	}

	/**
	 * Hangs this landing's published leaves on their sliders.
	 *
	 * The module is authored as two leaves meeting at its own zero, so the
	 * split is that plane: everything left of it runs one way, everything right
	 * of it the other. Which way the landing faces comes from where it sits
	 * relative to its shaft, so no convention about the published door edge has
	 * to be right.
	 *
	 * @param placement the `lift-doors` placement, in this floor's frame
	 * @param surfaces the module's own surfaces, in the module's frame
	 * @returns the pivots to add to the scene
	 */
	mount( placement, surfaces ) {

		if ( ! surfaces.length ) return [];

		const pivot = new THREE.Group();
		pivot.position.set(
			placement.position[ 0 ],
			this.elevation + placement.position[ 1 ],
			placement.position[ 2 ]
		);
		pivot.rotation.y = placement.rotationY;
		pivot.scale.set( ...placement.scale );

		const bounds = new THREE.Box3();
		for ( const { geometry } of surfaces ) bounds.union( geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute( geometry.getAttribute( 'position' ) ) );
		const width = bounds.max.x - bounds.min.x;

		for ( const side of [ - 1, 1 ] ) {

			const leaf = new THREE.Group();
			leaf.userData.slide = new THREE.Vector3( side * width / 2, 0, 0 );

			for ( const { geometry, material } of surfaces ) {

				const part = takeTriangles( geometry, halfOf( geometry, side ) );
				if ( part ) leaf.add( new THREE.Mesh( part, material ) );

			}
			if ( leaf.children.length ) this.leaves.push( leaf );

		}

		// The call plate beside the door: the geometry the prompt points at, a
		// hand wide on the wall at chest height, past the jamb.
		const plate = new THREE.Group();
		plate.position.set( width / 2 + PLATE_OFF, PANEL_HEIGHT - placement.position[ 1 ], PLATE_PROUD );
		plate.add( new THREE.Mesh(
			new THREE.BoxGeometry( PLATE_WIDTH, PLATE_HEIGHT, PLATE_PROUD * 2 ),
			surfaces[ 0 ].material
		) );
		pivot.add( plate );

		for ( const leaf of this.leaves ) pivot.add( leaf );

		// Where the prompt floats: a pace out from the leaves, on the side away
		// from the shaft.
		pivot.updateMatrixWorld( true );
		const outward = _facing.set( 0, 0, 1 ).applyAxisAngle( _up, placement.rotationY );
		const sign = Math.sign(
			( pivot.position.x - this.shaft.centre.x ) * outward.x + ( pivot.position.z - this.shaft.centre.z ) * outward.z
		) || 1;
		this.panel = new THREE.Vector3( pivot.position.x, this.elevation + PANEL_HEIGHT, pivot.position.z )
			.addScaledVector( outward, sign * PANEL_OUT );
		this.pivot = pivot;

		return [ pivot ];

	}

	release() {

		this.leaves = [];
		this.pivot = null;
		this.panel = null;

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

/** The triangles of one leaf: those whose centroid lies on that side of the module's zero. */
function halfOf( geometry, side ) {

	const position = geometry.getAttribute( 'position' );
	const starts = [];

	for ( let i = 0; i < position.count; i += 3 ) {

		centroidAt( position, i, _centroid, _a, _b, _c );
		if ( Math.sign( _centroid.x ) === side ) starts.push( i );

	}

	return starts;

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
const _facing = new THREE.Vector3();
const _up = new THREE.Vector3( 0, 1, 0 );
