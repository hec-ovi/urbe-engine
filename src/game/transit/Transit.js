import * as THREE from 'three/webgpu';
import { Shelters } from './Shelters.js';
import { StationEntrances } from './StationEntrances.js';
import { Buses } from './Buses.js';

/** Peak on a full city is a dozen buses in service; this is headroom over it. */
const BUS_CAPACITY = 24;

/**
 * Transit life on the street: a shelter and a lit sign on every bus stop, the
 * buses that the timetable has running right now, and a stair down into every
 * station entrance. One thing to build, one group to add, one list of glows,
 * one collider set and one call per frame.
 *
 * Every part is data driven and every part degrades to nothing: a blueprint
 * with no bus stops builds no shelters and no buses, and one with no stations
 * builds no entrances.
 */
export class Transit {

	/**
	 * @param atlas CityBlueprint per ../../../../atlas/CONTRACT.md
	 * @param networks `networks` per ../../../../connections/CONTRACT.md
	 * @param factory PbrMaterialFactory
	 * @param capacity how many buses may be on screen at once
	 */
	constructor( { atlas, networks, factory, capacity = BUS_CAPACITY } ) {

		const shelters = new Shelters( atlas, factory ).build();
		const entrances = new StationEntrances( atlas, factory ).build();

		this.buses = new Buses( {
			routes: networks?.transit?.routes ?? [],
			factory,
			capacity
		} );

		this.group = new THREE.Group();
		this.group.name = 'transit';
		this.group.add( shelters.group, entrances.group, this.buses.group );

		this.glows = [ ...shelters.glows, ...entrances.glows ];
		this.colliders = new Map( [
			[ 'transit:shelters', shelters.collider ],
			[ 'transit:entrances', entrances.collider ]
		] );

	}

	/** Buses on screen right now. */
	get count() {

		return this.buses.count;

	}

	/**
	 * @param player the player's feet, in world metres
	 * @param daySeconds seconds since midnight, the clock's own unit
	 */
	update( player, daySeconds ) {

		this.buses.update( player, daySeconds );

	}

}
