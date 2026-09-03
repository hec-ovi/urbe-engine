import * as THREE from 'three/webgpu';
import { Shelters } from './Shelters.js';
import { StationEntrances } from './StationEntrances.js';
import { StationVolumes } from './StationVolumes.js';
import { Buses } from './Buses.js';
import { RailVehicles } from './RailVehicles.js';

/** Peak on a full city is a dozen buses in service; this is headroom over it. */
const BUS_CAPACITY = 24;

/**
 * Transit life on the street and under it: a shelter and a lit sign on every
 * bus stop, the buses that the timetable has running right now, a portal over
 * every station entrance, and the shaft, passage and platform room behind it.
 * One thing to build, one group to add, one list of glows, one collider set and
 * one call per frame.
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
		const volumes = new StationVolumes( atlas, factory ).build();

		this.buses = new Buses( {
			routes: networks?.transit?.routes ?? [],
			factory,
			capacity
		} );
		this.trains = new RailVehicles( {
			routes: networks?.transit?.routes ?? [], kind: 'train', factory, capacity
		} );
		this.subways = new RailVehicles( {
			routes: networks?.transit?.routes ?? [], kind: 'subway', factory, capacity
		} );

		this.group = new THREE.Group();
		this.group.name = 'transit';
		this.group.add(
			shelters.group,
			entrances.group,
			volumes.group,
			this.buses.group,
			this.trains.group,
			this.subways.group
		);

		this.glows = [ ...shelters.glows, ...entrances.glows, ...volumes.glows ];
		this.colliders = new Map( [
			[ 'transit:shelters', shelters.collider ],
			[ 'transit:entrances', entrances.collider ],
			[ 'transit:stations', volumes.collider ]
		] );

	}

	/** Transit vehicles on screen right now. */
	get count() {

		return this.buses.count + this.trains.count + this.subways.count;

	}

	/**
	 * @param player the player's feet, in world metres
	 * @param daySeconds seconds since midnight, the clock's own unit
	 */
	update( player, daySeconds ) {

		this.buses.update( player, daySeconds );
		this.trains.update( player, daySeconds );
		this.subways.update( player, daySeconds );

	}

}
