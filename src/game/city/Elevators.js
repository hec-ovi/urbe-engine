import * as THREE from 'three/webgpu';
import { LIFT_CAR } from '../../../../interior/src/geometry/lift-spec.ts';
import { takeTriangles, centroidAt } from './Triangles.js';
import { CAB, CAB_KELVIN, CabLights, cabLens } from './CabLight.js';
import { kelvinColor } from '../light/Color.js';

/** The published modules the shafts own: the car that rides and the leaves that slide. */
const CAR_MODULE = 'lift-car';
const DOORS_MODULE = 'lift-doors';
/** How far outside its shaft a door leaf may sit and still belong to it. */
const DOOR_REACH = 0.5;

/** And how long its doors take to run open or shut. */
const DOOR_TIME = 1.4;
/** The call plate sits proud of the real wall lining, at hand height. */
const PANEL_OUT = 0.15;
const PANEL_HEIGHT = 1.1;
/** The call plate: past the jamb, a hand wide, standing a little proud of the wall. */
const PLATE_OFF = 0.25;
const PLATE_WIDTH = 0.12;
const PLATE_HEIGHT = 0.18;
const PLATE_PROUD = 0.015;
const CAB_HEIGHT = 2.4;
/** How thick the cab floor stands, under the surface it carries. */
const CAB_FLOOR = 0.15;
/** And how far it keeps off the shaft walls. */
const CAB_CLEARANCE = 0.05;
/** A landing leaf is a few centimetres of sheet; a body needs more to stop against. */
const LEAF_DEPTH = 0.12;
const CAB_LIGHT_KEY = 'cyberpunk/light-fixture/mid';
/** How far off a cabin button, and a landing's call button, the crosshair may be. */
const BUTTON_AIM = 0.06;
const CALL_AIM = 0.15;
/** How far a car's published size may be off the spec's and still be the authored car. */
const FIT_TOLERANCE = 0.01;
/** The car's area light hangs just under its lens, facing the floor. */
const LENS_DROP = 0.015;
const FACE_DOWN = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), - Math.PI / 2 );

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
 * The call button on a landing's plate calls the cab; a call made while it
 * travels waits until it has arrived and stood unattended for a few seconds.
 * Inside, the car's own panel is the control, at the coordinates Interior's
 * `LIFT_CAR` spec authors it: E acts on the button under the crosshair (next
 * or previous floor, open or close, travel or reset), and Page Up and Page
 * Down choose a floor anywhere in the car. The car shows the chosen floor. A
 * body standing in the doorway holds the doors open and the cab where it is.
 * While the cab moves it carries whoever is standing in it, because the player
 * is a character controller and not something a moving collider can push.
 *
 * A shaft is also a hole through every floor it serves, and the published
 * modules carry no collision of their own, so the shaft stands its own: the
 * shut leaves of each landing close that floor's opening until they have run
 * fully open, and the waiting car stands its floor, walls, front cheeks and
 * roof, in the core's rotation. The car goes while it is travelling, because
 * then the rider is being carried rather than standing on anything.
 *
 * A world assembled with an older, smaller car is read at the size its own
 * catalog publishes: the spec's walls, floor and roof scale to it, and the
 * panel, front cheeks and display it never had are left out, so E anywhere in
 * it travels to the chosen floor as it always did.
 */
export class Elevators {

	/**
	 * @param colliders `{ solid( id, boxes ), drop( id ) }`, the port the shafts
	 *   put their own cuboids through; null leaves them drawn and not solid
	 */
	constructor( factory, colliders = null ) {

		this.factory = factory;
		this.colliders = colliders;
		this.shafts = [];
		this.byBuilding = new Map();
		/** What every car and landing is lit and drawn with, one set for the run (CabLight.js). */
		this.cabs = new CabLights();

	}

	/** The port the shafts put their cuboids through, once the stream has one. */
	bind( colliders ) {

		this.colliders = colliders;

	}

	/**
	 * The shafts of one building, from its floor documents. Called as the
	 * interior streams in; the same building twice replaces its shafts.
	 */
	add( parcelId, floors, group ) {

		this.remove( parcelId );
		const shafts = new Map();

		for ( const floor of floors ) {

			for ( const lift of floor.core?.elevators ?? [] ) {

				if ( ! shafts.has( lift.id ) ) shafts.set( lift.id, new Shaft( parcelId, lift, this.factory, this.colliders, this.stream, floor.coreAngleDeg ?? 0, this.cabs ) );

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

		for ( const shaft of list ) shaft.clear();
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
			.filter( ( stop ) => stop?.owns( placement.position ) )
			.sort( ( a, b ) => Number( b.shaft.liftId === placement.connector ) - Number( a.shaft.liftId === placement.connector )
				|| a.distanceTo( placement.position ) - b.distanceTo( placement.position ) );

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

	/** The cars one building's shafts have stood, which ride outside any floor's content. */
	cars( parcelId ) {

		return ( this.byBuilding.get( parcelId ) ?? [] ).map( ( shaft ) => shaft.car ).filter( Boolean );

	}

	/**
	 * A building's cars are drawn while its floors are: a car stands in a
	 * closed core, so from further out there is nothing of it to see.
	 */
	draw( parcelId, drawn ) {

		for ( const shaft of this.byBuilding.get( parcelId ) ?? [] ) if ( shaft.cab ) shaft.cab.visible = drawn;

	}

	/**
	 * One of everything a lift draws, detached and lit by no car, for a warm-up
	 * to prepare before any shaft stands: the car's surfaces, a segment of its
	 * display, a landing's leaves, its call plate and button. Every car and
	 * landing wears these same materials (CabLight.js), so once this is
	 * prepared no shaft builds a graph of its own.
	 *
	 * @param modules the city module catalog
	 * @returns a group, or null when the catalog publishes no lift
	 */
	specimen( modules ) {

		if ( ! modules?.has?.( CAR_MODULE ) ) return null;
		const group = new THREE.Group();
		group.name = 'elevator:specimen';

		for ( const { geometry, material } of modules.surfacesOf( CAR_MODULE ) ) group.add( new THREE.Mesh( geometry, this.cabs.car( material ) ) );
		group.add( new THREE.Mesh( this.cabs.display.across, this.cabs.display.material ) );

		// What only a landing draws is cut and built for this, as a landing does.
		const own = [];
		const leaves = modules.has( DOORS_MODULE ) ? modules.surfacesOf( DOORS_MODULE ) : [];
		for ( const { geometry, material } of leaves ) {

			const part = takeTriangles( geometry, halfOf( geometry, 1 ) ) ?? takeTriangles( geometry, halfOf( geometry, - 1 ) );
			if ( part ) own.push( new THREE.Mesh( part, this.cabs.landing( material ) ) );

		}
		if ( leaves.length ) own.push( ...callPlate( leaves[ 0 ].material, this.factory ).children );
		for ( const mesh of own ) mesh.userData.specimen = true;
		if ( own.length ) group.add( ...own );

		return group;

	}

	/** Lets go of the geometry a specimen cut for itself; what every lift shares stays. */
	discard( specimen ) {

		specimen?.traverse( ( node ) => {

			if ( node.userData.specimen ) node.geometry.dispose();

		} );
		specimen?.removeFromParent();

	}

	/** Every landing and cab panel in reach, for the crosshair to choose from. */
	panels( feet, radius ) {

		const out = [];

		for ( const shaft of this.shafts ) out.push( ...shaft.panels( feet, radius ) );

		return out;

	}

	/** Cabin membership also lets floor keys work away from its panel. */
	cabinAt( feet ) { return this.shafts.find( shaft => shaft.holds( feet ) ) ?? null; }

	/** @param body PlayerBody, carried when it is standing in a moving cab. */
	update( delta, body ) {

		for ( const shaft of this.shafts ) shaft.update( delta, body );

	}

}

/** One lift: its cab, its landings, and where the cab is right now. */
class Shaft {

	constructor( parcelId, lift, factory, colliders, stream, angleDeg, cabs ) {

		this.parcelId = parcelId;
		this.stream = stream;
		this.selected = 1;
		this.called = false;
		this.colliders = colliders;
		this.id = `${parcelId}:${lift.id}`;
		this.liftId = lift.id;
		this.yaw = - angleDeg * Math.PI / 180;
		/** Metres in the cab per metre of the authored `LIFT_CAR` spec, per axis. */
		this.carScale = new THREE.Vector3( 1, 1, 1 );
		/** Whether the car is the authored one, with its panel, cheeks and display. */
		this.panelled = false;
		this.floorVersion = 0;
		this.blocked = false;
		this.pendingCalls = [];
		this.dwell = 0;
		/** The lifts' shared materials and display strokes, which no shaft owns. */
		this.cabs = cabs;
		/** The car's lens, which every surface naming this shaft is lit by (CabLight.js). */
		this.lens = cabLens();
		this.screen = null;
		// A core rect is published by its minimum corner; the shaft is its middle.
		this.rect = lift.rect;
		this.centre = { x: lift.rect.x + lift.rect.w / 2, z: lift.rect.z + lift.rect.d / 2 };
		this.factory = factory;
		this.stops = [];
		this.at = 0;
		this.target = 0;
		this.cab = null;
		this.car = null;
		/** Where the cab floor is standing solid, or null while the cab travels. */
		this.floorAt = null;
		this.floorReady = false;
		this.rider = null;
		this.riderOffset = new THREE.Vector3();

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
		this.speed = THREE.MathUtils.clamp( ( this.stops.at( - 1 ).elevation - this.stops[ 0 ].elevation ) / 18, 1.6, 6 );
		this.selected = Math.min( 1, this.stops.length - 1 );

		const group = new THREE.Group();
		group.name = `elevator:${this.id}`;
		group.position.set( this.centre.x, this.at, this.centre.z );

		this.cab = group;
		this.#standFloor();

		return group;

	}

	/** The actual rotated car floor and walls are solid at every waiting stop. */
	#standFloor() {

		if ( this.floorAt === this.at ) return;
		this.colliders?.drop( `lift:${this.id}/cab` );
		this.floorAt = this.at;
		const version = ++ this.floorVersion;
		const ready = this.colliders?.solid( `lift:${this.id}/cab`, this.cabBoxes() );
		this.floorReady = ! ready?.then;
		if ( ready?.then ) ready.then( result => {

			if ( this.floorVersion === version && this.floorAt === this.at ) this.floorReady = result !== false;

		} ).catch( error => console.warn( `lift ${this.id} floor: ${error.message}` ) );

	}

	/** Inverse yaw is shared by passenger detection and shaft-module ownership. */
	localPoint( point, target = new THREE.Vector3() ) {

		return target.set( point.x - this.centre.x, point.y - this.at, point.z - this.centre.z )
			.applyAxisAngle( _up, - this.yaw );

	}

	/** A point of the authored car, in the world where the cab stands now. */
	worldPoint( local ) {

		return new THREE.Vector3( ...local ).multiply( this.carScale ).applyAxisAngle( _up, this.yaw )
			.add( new THREE.Vector3( this.centre.x, this.at, this.centre.z ) );

	}

	/**
	 * The waiting car's solids, from the spec at the car's own scale: floor,
	 * both side walls, the back wall and the roof, and the two cheeks beside
	 * the door on a car that has them. Before the car mounts, a floor slab
	 * across the shaft.
	 */
	cabBoxes() {

		if ( ! this.car ) {

			return [ {
				center: [ this.centre.x, this.at - CAB_FLOOR / 2, this.centre.z ],
				halfExtents: [ this.rect.w / 2 - CAB_CLEARANCE, CAB_FLOOR / 2, this.rect.d / 2 - CAB_CLEARANCE ],
				rotationY: this.yaw
			} ];

		}

		const { width, depth, wall, floor, ceiling, roof, doorWidth } = LIFT_CAR;
		const cheek = ( width - 2 * wall - doorWidth ) / 2;
		const boxes = [
			[ 0, - floor / 2, 0, width, floor, depth ],
			[ - width / 2 + wall / 2, ceiling / 2, 0, wall, ceiling, depth ],
			[ width / 2 - wall / 2, ceiling / 2, 0, wall, ceiling, depth ],
			[ 0, ceiling / 2, depth / 2 - wall / 2, width - 2 * wall, ceiling, wall ],
			[ 0, ceiling + roof / 2, 0, width, roof, depth ]
		];

		if ( this.panelled ) {

			for ( const side of [ - 1, 1 ] ) boxes.push( [ side * ( doorWidth / 2 + cheek / 2 ), ceiling / 2, - depth / 2 + wall / 2, cheek, ceiling, wall ] );

		}

		return boxes.map( ( [ x, y, z, w, h, d ] ) => ( {
			center: this.worldPoint( [ x, y, z ] ).toArray(),
			halfExtents: [ w * this.carScale.x / 2, h * this.carScale.y / 2, d * this.carScale.z / 2 ],
			rotationY: this.yaw
		} ) );

	}

	/** Nothing of this shaft stays solid once its building is let go. */
	clear() {

		this.#releaseRider();
		this.colliders?.drop( `lift:${this.id}/cab` );
		this.floorAt = null;
		this.floorVersion ++;
		for ( const stop of this.stops ) stop.release();
		this.cab?.removeFromParent();

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
		this.yaw = placement.rotationY;
		car.rotation.y = this.yaw;
		car.scale.set( ...placement.scale );

		// The spec is the car Interior publishes now. A world assembled with an
		// older car is read at the size its own catalog gives that car.
		const fit = carFit( bounds.size );
		this.panelled = fit.distanceTo( _unit ) < FIT_TOLERANCE;
		this.carScale.set( ...placement.scale ).multiply( fit );

		// The car is lit by its own lens and bounce and by nothing of the city's,
		// through materials every car shares: the lens it is lit by is the one
		// its surfaces name (CabLight.js), so no car builds a graph of its own.
		for ( const { geometry, material } of surfaces ) {

			const mesh = new THREE.Mesh( geometry, this.cabs.car( material ) );
			mesh[ CAB ] = this;
			car.add( mesh );

		}
		this.car = car;
		this.cab.add( car );
		this.updateLighting();

		if ( this.panelled ) {

			this.screen = makeDisplay( this.cabs.display );
			this.screen.position.set( ...LIFT_CAR.panel.screen );
			car.add( this.screen );
			this.updateDisplay();

		}

		// Replace the conservative bootstrap floor with the authored cabin bounds.
		this.floorAt = null;
		this.#standFloor();

	}

	/** The lens rides with the car, facing down just under its ceiling, and is dark until the car stands. */
	updateLighting() {

		if ( ! this.car ) return;
		const lens = this.lens;
		lens.position.copy( this.worldPoint( [ 0, LIFT_CAR.lens.center[ 1 ] - LENS_DROP, 0 ] ) );
		lens.width = LIFT_CAR.lens.width * this.carScale.x;
		lens.height = LIFT_CAR.lens.depth * this.carScale.z;
		lens.quaternion.setFromAxisAngle( _up, this.yaw ).multiply( FACE_DOWN );
		// The lens's lumens over its area, which is what three's `power` makes of a rect light.
		kelvinColor( CAB_KELVIN, lens.color ).multiplyScalar( LIFT_CAR.lens.lumens / ( lens.width * lens.height * Math.PI ) );

	}

	get moving() {

		return Math.abs( this.target - this.at ) > 1e-3;

	}

	/** A point in the rotated passenger enclosure, not its axis-aligned bounds. */
	holds( point ) {

		const local = this.localPoint( point, _local );
		const halfX = this.car ? LIFT_CAR.width * this.carScale.x / 2 : this.rect.w / 2;
		const halfZ = this.car ? LIFT_CAR.depth * this.carScale.z / 2 : this.rect.d / 2;
		return local.y >= - 0.4 && local.y < ( this.car ? LIFT_CAR.ceiling * this.carScale.y : CAB_HEIGHT )
			&& Math.abs( local.x ) < halfX && Math.abs( local.z ) < halfZ;

	}

	/**
	 * What the crosshair can press here: inside, each button of the car's
	 * panel, which has to be aimed at; in a car without one, the car itself at
	 * hand height, as E anywhere in it; outside, the call button of every
	 * landing in reach.
	 */
	panels( feet, radius ) {

		if ( this.holds( feet ) ) {

			if ( ! this.panelled ) {

				return [ {
					kind: 'elevator', shaft: this, stop: null, inside: true,
					center: new THREE.Vector3( this.centre.x, this.at + PANEL_HEIGHT, this.centre.z )
				} ];

			}

			return LIFT_CAR.panel.buttons
				.map( ( button ) => ( {
					kind: 'elevator', shaft: this, stop: null, inside: true, action: button.action,
					aimRadius: BUTTON_AIM * this.carScale.x, center: this.worldPoint( button.position )
				} ) )
				.filter( ( target ) => target.center.distanceTo( feet ) < radius );

		}

		return this.stops
			.filter( ( stop ) => stop.panel && stop.panel.distanceTo( feet ) < radius )
			.map( ( stop ) => ( { kind: 'elevator', shaft: this, stop, center: stop.panel, inside: false, aimRadius: CALL_AIM } ) );

	}

	updateDisplay() {

		if ( this.screen ) showNumber( this.screen, this.stops[ this.selected ]?.floor ?? 0 );

	}

	/** Floor selection is bounded, so the top never wraps to the ground. */
	select( direction ) {

		if ( this.moving ) return;
		this.selected = THREE.MathUtils.clamp( this.selected + direction, 0, this.stops.length - 1 );
		this.updateDisplay();

	}

	/** Every button acts on the real selected stop; calls during travel are queued. */
	press( target ) {

		if ( target.inside && target.action === 'up' ) return this.select( 1 );
		if ( target.inside && target.action === 'down' ) return this.select( - 1 );
		if ( target.inside && target.action === 'cancel' && ! this.moving ) {

			this.selected = Math.max( 0, this.stops.findIndex( stop => Math.abs( stop.elevation - this.at ) < 0.05 ) );
			this.updateDisplay();
			return;

		}
		if ( target.inside && [ 'open', 'close' ].includes( target.action ) && ! this.moving ) {

			this.called = target.action === 'open';
			return;

		}
		const stop = target.inside ? this.stops[ this.selected ] : target.stop;
		if ( ! stop || ! this.stops.includes( stop ) ) return;
		if ( this.moving ) {

			if ( ! target.inside && this.target !== stop.elevation && ! this.pendingCalls.includes( stop ) ) this.pendingCalls.push( stop );
			return;

		}
		this.target = stop.elevation;
		this.called = true;
		this.dwell = 0;
		if ( ! target.inside ) {

			this.selected = this.stops.indexOf( stop );
			this.updateDisplay();

		}
		this.stream?.requestFloor( this.parcelId, stop.floor );

	}

	/** What the prompt says about the button under the crosshair right now. */
	label( target ) {

		if ( this.blocked ) return 'step clear of the lift doorway';

		if ( this.moving ) {

			const destination = this.stops.find( ( stop ) => Math.abs( stop.elevation - this.target ) < 0.05 )?.floor;
			if ( target.inside ) return `travelling to floor ${destination}`;
			const coming = this.target === target.stop.elevation || this.pendingCalls.includes( target.stop );
			return coming ? 'the lift is on its way' : 'E  call the lift';

		}

		if ( this.called && ! this.ready ) return 'waiting for the landing';
		if ( ! target.inside ) return `E  ${Math.abs( target.stop.elevation - this.at ) < 0.05 ? 'open' : 'call'} the lift`;

		const floor = this.stops[ this.selected ].floor;
		switch ( target.action ) {

			case 'up': return `floor ${floor}    E  next floor    PgUp / PgDn  choose`;
			case 'down': return `floor ${floor}    E  previous floor    PgUp / PgDn  choose`;
			case 'open': return 'E  open the lift doors';
			case 'close': return 'E  close the lift doors';
			case 'cancel': return 'E  back to this floor';
			default: return `floor ${floor}    PgUp / PgDn  choose    E  go`;

		}

	}

	get ready() {

		const stop = this.stops.find( one => Math.abs( one.elevation - this.at ) < 0.05 );
		return Boolean( stop ) && ( this.stream?.floorShown( this.parcelId, stop.floor ) ?? true );

	}

	update( delta, body ) {

		this.blocked = this.stops.some( stop => stop.open > 0 && stop.obstructed( body.feet ) )
			&& ( this.moving || ! this.called );
		// The doors are shut whenever the cab is not standing at that landing.
		for ( const stop of this.stops ) {

			stop.setOpen( ( this.called && this.ready && this.floorReady && ! this.moving && Math.abs( stop.elevation - this.at ) < 0.05 )
				|| ( this.blocked && stop.open > 0 && stop.obstructed( body.feet ) ), delta );

		}

		if ( ! this.moving ) {

			this.#standFloor();
			if ( this.ready && this.floorReady ) this.#releaseRider();
			if ( this.ready && ! this.holds( body.feet ) ) {

				this.stream?.releaseFloor( this.parcelId );
				this.dwell += delta;
				if ( this.dwell > 4 && this.pendingCalls.length && ! this.blocked ) this.press( { inside: false, stop: this.pendingCalls.shift() } );

			}
			return;

		}

		if ( this.stops.some( stop => stop.open > 0 ) ) return;

		if ( ! this.rider && ! body.carried && this.holds( body.feet ) ) {

			this.rider = body;
			this.riderOffset.copy( body.feet ).sub( this.cab.position );
			body.beginCarry?.( body.feet );

		}
		// Travelling: the rider is carried, so the cab floor is not standing in
		// the shaft while it passes the floors between.
		if ( this.floorAt !== null ) {

			this.colliders?.drop( `lift:${this.id}/cab` );
			this.floorAt = null;
			this.floorReady = false;

		}

		const step = Math.sign( this.target - this.at ) * this.speed * delta;
		const dy = Math.abs( step ) >= Math.abs( this.target - this.at ) ? this.target - this.at : step;

		this.at += dy;
		this.cab.position.y = this.at;
		this.updateLighting();

		// Carry at a fixed cab offset so gravity cannot accumulate between frames.
		if ( this.rider ) {

			_lift.copy( this.cab.position ).add( this.riderOffset );
			if ( this.rider.carryTo ) this.rider.carryTo( _lift );
			else this.rider.teleport( _lift );

		}

	}

	#releaseRider() {

		if ( ! this.rider ) return;
		_lift.copy( this.cab.position ).add( this.riderOffset );
		if ( this.rider.endCarry ) this.rider.endCarry( _lift );
		else this.rider.teleport( _lift );
		this.rider = null;

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
		this.sealed = false;
		/** The shut doorway, solid while the leaves are shut. */
		this.solid = null;

	}

	/** Shaft ownership follows the same rotated frame as the published core. */
	owns( position ) {

		const local = this.shaft.localPoint( _local.fromArray( position ), _local );
		return Math.abs( local.x ) < this.shaft.rect.w / 2 + DOOR_REACH
			&& Math.abs( local.z ) < this.shaft.rect.d / 2 + DOOR_REACH;

	}

	distanceTo( position ) {

		return Math.hypot( position[ 0 ] - this.shaft.centre.x, position[ 2 ] - this.shaft.centre.z );

	}

	obstructed( feet ) {

		if ( ! this.pivot || feet.y < this.elevation - 0.4 || feet.y > this.elevation + 2.2 ) return false;
		const local = this.pivot.worldToLocal( new THREE.Vector3( feet.x, feet.y, feet.z ) );
		return Math.abs( local.x ) < this.doorWidth / 2 + 0.32 / this.pivot.scale.x
			&& Math.abs( local.z ) < 0.42 / this.pivot.scale.z;

	}

	/**
	 * Hangs this landing's published leaves on their sliders.
	 *
	 * The module is authored as two leaves meeting at its own zero, so the
	 * split is that plane: everything left of it runs one way, everything right
	 * of it the other, and a pair published with a seam between them closes it
	 * shut. Which way the landing faces comes from where it sits relative to its
	 * shaft, so no convention about the published door edge has to be right.
	 *
	 * @param placement the `lift-doors` placement, in this floor's frame
	 * @param surfaces the module's own surfaces, in the module's frame
	 * @returns the pivots to add to the scene
	 */
	mount( placement, surfaces ) {

		if ( ! surfaces.length ) return [];
		this.release();

		const pivot = new THREE.Group();
		pivot.position.set(
			placement.position[ 0 ],
			this.elevation + placement.position[ 1 ],
			placement.position[ 2 ]
		);
		pivot.rotation.y = placement.rotationY;
		pivot.scale.set( ...placement.scale );

		const bounds = new THREE.Box3();
		for ( const { geometry } of surfaces ) bounds.union( boundsOf( geometry ) );
		const width = bounds.max.x - bounds.min.x;
		this.doorWidth = width;

		// Shut, the pair is one panel across the opening. It is a few centimetres
		// of sheet, so the body stops against something it cannot cross in a step.
		this.solid = doorway( placement, bounds, this.elevation );
		this.#seal( true );

		// Lit by this shaft's lens through the landing material every shaft shares.
		this.leaves = splitLeaves( surfaces, ( material ) => this.shaft.cabs.landing( material ) );
		for ( const leaf of this.leaves ) {

			for ( const mesh of leaf.children ) mesh[ CAB ] = this.shaft;
			placeLeaf( leaf, this.open );

		}

		// The call plate beside the door: the geometry the prompt points at, a
		// hand wide on the wall at chest height, past the jamb.
		const plate = callPlate( surfaces[ 0 ].material, this.shaft.factory );
		plate.position.set( width / 2 + PLATE_OFF, ( PANEL_HEIGHT - placement.position[ 1 ] ) / placement.scale[ 1 ], PANEL_OUT );
		const [ , button ] = plate.children;
		pivot.add( plate );

		for ( const leaf of this.leaves ) pivot.add( leaf );

		// Point at the visible button itself, not an invisible point in mid-air.
		pivot.updateMatrixWorld( true );
		this.panel = button.getWorldPosition( new THREE.Vector3() );
		this.pivot = pivot;

		return [ pivot ];

	}

	release() {

		this.#seal( false );
		this.pivot?.traverse( object => { if ( object.isMesh ) object.geometry.dispose(); } );
		this.pivot?.removeFromParent();
		this.solid = null;
		this.leaves = [];
		this.pivot = null;
		this.panel = null;
		this.open = 0;
		this.wanted = 0;

	}

	/** The doorway solid or open, as the leaves are. */
	#seal( shut ) {

		if ( ! this.solid ) return;

		const id = `lift:${this.shaft.id}@${this.floor}`;

		if ( shut === this.sealed ) return;
		this.sealed = shut;
		if ( shut ) this.shaft.colliders?.solid( id, [ this.solid ] );
		else this.shaft.colliders?.drop( id );

	}

	setOpen( wanted, delta ) {

		const next = wanted ? 1 : 0;

		if ( next === 0 ) this.#seal( true );
		this.wanted = next;

		if ( this.open === this.wanted ) return;

		const step = delta / DOOR_TIME;
		this.open = this.wanted > this.open
			? Math.min( 1, this.open + step )
			: Math.max( 0, this.open - step );

		for ( const leaf of this.leaves ) placeLeaf( leaf, this.open );
		// Collision only clears when the visible leaves have fully opened.
		if ( this.open >= 0.99 ) this.#seal( false );

	}

}

/**
 * A centre-opening pair of leaves hung on sliders, from a module authored as
 * two leaves meeting at its own zero: each leaf runs half the pair's width
 * outward, which clears the doorway it closes, and a pair published with a seam
 * between its leaves closes it, each leaf standing shut at the zero.
 *
 * @param surfaces the module's surfaces, in its own frame
 * @param materialFor (material) => the material a leaf wears
 * @param owned where the cut geometry is listed for disposal, if anywhere
 * @returns the leaves, each a group with `userData.shut` and `userData.slide`
 */
function splitLeaves( surfaces, materialFor, owned = null ) {

	const bounds = new THREE.Box3();
	for ( const { geometry } of surfaces ) bounds.union( boundsOf( geometry ) );
	const width = bounds.max.x - bounds.min.x;
	const leaves = [];

	for ( const side of [ - 1, 1 ] ) {

		const leaf = new THREE.Group();
		let inner = Infinity;

		for ( const { geometry, material } of surfaces ) {

			const starts = halfOf( geometry, side );
			const part = takeTriangles( geometry, starts );
			if ( ! part ) continue;
			owned?.push( part );
			const position = part.getAttribute( 'position' );
			for ( let i = 0; i < position.count; i ++ ) inner = Math.min( inner, Math.abs( position.getX( i ) ) );
			leaf.add( new THREE.Mesh( part, materialFor( material ) ) );

		}
		if ( ! leaf.children.length ) continue;
		leaf.userData.shut = new THREE.Vector3( - side * inner, 0, 0 );
		leaf.userData.slide = new THREE.Vector3( side * width / 2, 0, 0 );
		leaves.push( leaf );

	}

	return leaves;

}

/** Where a leaf stands at `open`, 0 shut and 1 open: eased in and out, as a door operator runs it. */
function placeLeaf( leaf, open ) {

	const t = open * open * ( 3 - 2 * open );
	leaf.position.lerpVectors( leaf.userData.shut, leaf.userData.slide, t );

}

/**
 * The triangles of one leaf: those whose centroid lies on that side of the
 * module's zero, and of the faces standing in the zero plane where the leaves
 * meet, the one that faces the other leaf.
 */
function halfOf( geometry, side ) {

	const position = geometry.getAttribute( 'position' );
	const starts = [];

	for ( let i = 0; i < position.count; i += 3 ) {

		centroidAt( position, i, _centroid, _a, _b, _c );
		let at = Math.sign( _centroid.x );
		if ( Math.abs( _centroid.x ) < 1e-7 ) at = - Math.sign( _b.sub( _a ).cross( _c.sub( _a ) ).x );
		if ( at === side ) starts.push( i );

	}

	return starts;

}

function boundsOf( geometry ) {

	return geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute( geometry.getAttribute( 'position' ) );

}

/**
 * The cuboid a landing's shut leaves fill, in world metres: the module's own
 * box under its placement, given enough depth to stop a body.
 */
function doorway( placement, bounds, elevation ) {

	const size = bounds.getSize( new THREE.Vector3() );
	const middle = bounds.getCenter( new THREE.Vector3() ).multiply( new THREE.Vector3( ...placement.scale ) );

	middle.applyAxisAngle( _up, placement.rotationY );

	return {
		center: [
			placement.position[ 0 ] + middle.x,
			elevation + placement.position[ 1 ] + middle.y,
			placement.position[ 2 ] + middle.z
		],
		halfExtents: [
			Math.max( 0.05, size.x * placement.scale[ 0 ] / 2 ),
			Math.max( 0.05, size.y * placement.scale[ 1 ] / 2 ),
			Math.max( LEAF_DEPTH, size.z * placement.scale[ 2 ] ) / 2
		],
		rotationY: placement.rotationY
	};

}

/** A published car's size over the spec's, per axis; the spec where the catalog gives none. */
function carFit( size ) {

	const spec = [ LIFT_CAR.width, LIFT_CAR.floor + LIFT_CAR.ceiling + LIFT_CAR.roof, LIFT_CAR.depth ];

	return new THREE.Vector3( ...spec.map( ( length, axis ) => size?.[ axis ] > 0 ? size[ axis ] / length : 1 ) );

}

/** A landing's call plate with its button, plate first, for the landing to hang beside its door. */
function callPlate( material, factory ) {

	const plate = new THREE.Group();
	plate.add( new THREE.Mesh( new THREE.BoxGeometry( PLATE_WIDTH, PLATE_HEIGHT, PLATE_PROUD * 2 ), material ) );
	const button = new THREE.Mesh( new THREE.BoxGeometry( .048, .048, .008 ),
		factory.variant( CAB_LIGHT_KEY, { emissiveLevel: 10, emissive: kelvinColor( CAB_KELVIN ) } ) );
	button.position.z = PLATE_PROUD + .004;
	plate.add( button );

	return plate;

}

/**
 * Small geometric digits stay crisp without canvas textures or external font
 * assets. Every car's display draws the same two strokes in the same material.
 */
function makeDisplay( { material, across, upright } ) {

	const group = new THREE.Group();
	const cells = [];
	const segments = [ [ 0, .03, true ], [ .015, .015, false ], [ .015, -.015, false ],
		[ 0, -.03, true ], [ -.015, -.015, false ], [ -.015, .015, false ], [ 0, 0, true ] ];
	for ( let digit = 0; digit < 4; digit ++ ) {

		const cell = new THREE.Group();
		cell.position.x = ( digit - 1.5 ) * .041;
		for ( const [ x, y, horizontal ] of segments ) {

			const mesh = new THREE.Mesh( horizontal ? across : upright, material );
			mesh.position.set( x, y, 0 );
			cell.add( mesh );

		}
		cells.push( cell ); group.add( cell );

	}
	group.userData.cells = cells;
	return group;

}

const DIGITS = { '0': [ 0, 1, 2, 3, 4, 5 ], '1': [ 1, 2 ], '2': [ 0, 1, 6, 4, 3 ],
	'3': [ 0, 1, 2, 3, 6 ], '4': [ 5, 6, 1, 2 ], '5': [ 0, 5, 6, 2, 3 ],
	'6': [ 0, 5, 6, 4, 3, 2 ], '7': [ 0, 1, 2 ], '8': [ 0, 1, 2, 3, 4, 5, 6 ],
	'9': [ 0, 1, 2, 3, 5, 6 ], '-': [ 6 ] };
function showNumber( display, value ) {

	const label = String( value ).slice( - 4 ).padStart( 4, ' ' );
	display.userData.floor = value;
	display.userData.cells.forEach( ( cell, index ) => cell.children.forEach( ( segment, bit ) => {

		segment.visible = ( DIGITS[ label[ index ] ] ?? [] ).includes( bit );

	} ) );

}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _lift = new THREE.Vector3();
const _up = new THREE.Vector3( 0, 1, 0 );
const _unit = new THREE.Vector3( 1, 1, 1 );
const _local = new THREE.Vector3();
