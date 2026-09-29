import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DoorMotion } from './DoorMotion.js';
import { DoorColliders } from '../physics/DoorColliders.js';
import { FillChannel } from './kit/FillChannel.js';

/** What Interior publishes an apartment entrance as: its width and height ranges, in metres. */
const WIDTH = [ 0.7, 2.4 ];
const HEIGHT = [ 2.1, 3 ];

/**
 * The private apartment doors of the floors in view, the ones E can open.
 *
 * Interior publishes each floor's apartment entrances beside its layout, as a
 * pair of pocket leaves and the fixed parts around them, never as static
 * placements, so a floor's build stands them as moving copies of their own
 * (`buildApartmentDoors`) and this registry makes them doors while that floor
 * is shown: a moving collider per leaf, and a place in the targets the
 * Interactor offers. They never join the city's street doors, its entrances,
 * a parcel's street access or anybody's street goals.
 *
 * A floor hidden and shown again, or let go and built again, keeps each door
 * as it was left, open or shut, for as long as its building is open.
 */
export class ApartmentDoors {

	constructor( physics ) {

		this.physics = physics;
		/** The doors of every floor shown now, which the Interactor targets and moves. */
		this.doors = [];
		this.bands = new Map();
		/** How each door of an open building was left, by door id. */
		this.states = new Map();

	}

	/**
	 * Makes one shown floor's doors solid and openable, each leaf colliding as
	 * its own triangles. A floor shown twice is shown once.
	 */
	show( bandId, doors ) {

		if ( this.bands.has( bandId ) ) return;
		this.bands.set( bandId, doors );

		try {

			for ( const door of doors ) {

				const state = this.states.get( door.id );
				if ( state ) {

					door.open = state.open;
					door.wanted = state.wanted;

				}
				door.motion.apply( door.pivots, door.open );

				for ( const leaf of door.pivots ) {

					const parts = leaf.pivot.children.map( ( mesh ) => mesh.geometry.clone() );
					leaf.colliderGeometry = mergeGeometries( parts, false );
					for ( const part of parts ) part.dispose();
					if ( ! leaf.colliderGeometry ) throw apartmentError( `${door.id} has no collision mesh` );

				}

			}

			new DoorColliders( this.physics, doors );
			this.doors.push( ...doors );

		} catch ( error ) {

			this.hide( bandId );
			throw error;

		}

	}

	/** Takes a floor's doors out of the world, remembering how each was left. */
	hide( bandId ) {

		const doors = this.bands.get( bandId );
		if ( ! doors ) return;
		this.bands.delete( bandId );

		for ( const door of doors ) {

			this.states.set( door.id, { open: door.open, wanted: door.wanted } );

			for ( const leaf of door.pivots ) {

				if ( leaf.collision ) this.physics.remove( leaf.collision );
				leaf.collision = null;
				leaf.colliderGeometry?.dispose();
				leaf.colliderGeometry = null;

			}

		}

		const removed = new Set( doors );
		this.doors = this.doors.filter( ( door ) => ! removed.has( door ) );

	}

	/** Forgets how the doors of a building were left, once the building is let go. */
	forget( parcelId ) {

		for ( const id of this.states.keys() ) {

			if ( id.startsWith( `${parcelId}:` ) ) this.states.delete( id );

		}

	}

}

/**
 * One floor's apartment doors, built aside with the rest of its content.
 *
 * Each leaf and fixed part is a copy of its published module with its scale
 * baked into the vertices, so the moving groups and their colliders always
 * have unit scale, and the maps keep their metres after it. The copies belong
 * to the floor and go with it; none of them enters the floor's static boxes or
 * the shared module draws. A door is lit by the fill of the two rooms it
 * stands between, in a channel of its own that goes with the floor too.
 *
 * An entrance that cannot stand, one that is not a pair of pocket leaves in a
 * doorway of a door's size or names a module the catalog does not hold, fails
 * the whole build with `E_APARTMENT_DOOR`, unless `refused` is given: then
 * that entrance alone is left out, its doorway standing open, `refused` hears
 * why, and the rest of the floor builds.
 *
 * @param record the floor record, with the `apartmentEntrances` Interior publishes for it
 * @param modules the city module catalog
 * @param fills Map<roomId, Vector4> the rooms' fills, and `shared` the floor's own
 * @param refused ( entrance, error ) => void, heard for each entrance left out
 * @returns a group holding the copies; its `userData.apartmentDoors` are the doors
 */
export function buildApartmentDoors( record, modules, { fills = new Map(), shared = null, refused = null } = {} ) {

	const group = new THREE.Group();
	group.name = `apartment-doors:${record.id}`;
	const doors = [];
	const channels = [];
	group.userData.apartmentDoors = doors;
	group.userData.apartmentFillChannels = channels;

	try {

		for ( const entrance of record.apartmentEntrances ?? [] ) {

			const parts = new THREE.Group();
			let channel = null;

			try {

				validate( entrance );

				const along = new THREE.Vector3( Math.cos( entrance.leaves[ 0 ].rotationY ), 0, - Math.sin( entrance.leaves[ 0 ].rotationY ) );
				const motion = new DoorMotion( entrance.motion );
				const commonFill = fills.get( entrance.corridorRoom ) ?? shared;
				const privateFill = fills.get( entrance.privateRoom ) ?? commonFill;
				channel = commonFill ? new FillChannel( 1 ) : null;
				channel?.set( 0, commonFill.clone().add( privateFill ).multiplyScalar( 0.5 ) );

				const leaves = entrance.leaves.map( ( part, index ) => {

					const pivot = mount( part, record.elevation, modules, channel );
					parts.add( pivot );
					const leaf = { pivot, index };
					motion.prepare( leaf, along );
					return leaf;

				} );
				motion.validateLeaves( leaves );

				for ( const part of entrance.fixed ) parts.add( mount( part, record.elevation, modules, channel ) );

				doors.push( {
					id: `${record.id}:${entrance.id}`,
					parcelId: record.parcelId,
					floor: record.floor,
					role: 'apartment',
					kind: 'apartment',
					unit: entrance.unit,
					number: entrance.number,
					name: `apartment ${entrance.number}`,
					corridorRoom: entrance.corridorRoom,
					privateRoom: entrance.privateRoom,
					// At floor level: the Interactor aims at a door's handle height above it.
					center: new THREE.Vector3( entrance.position[ 0 ], record.elevation, entrance.position[ 1 ] ),
					motion,
					pivots: leaves,
					open: 0,
					wanted: 0
				} );

			} catch ( error ) {

				parts.traverse( ( node ) => node.geometry?.dispose() );
				channel?.dispose();
				if ( ! refused ) throw error;
				refused( entrance, error );
				continue;

			}

			if ( channel ) channels.push( channel );
			// The parts join the floor's group loose, as the doors' pivots expect.
			for ( const part of [ ...parts.children ] ) group.add( part );

		}

		return group;

	} catch ( error ) {

		group.traverse( ( node ) => node.geometry?.dispose() );
		for ( const channel of channels ) channel.dispose();
		throw error;

	}

}

/** An entrance as Interior's contract publishes it: a pair of pocket leaves in a doorway of a door's size. */
function validate( entrance ) {

	if ( entrance.role !== 'apartment' ) throw apartmentError( `${entrance.id} is not an apartment entrance` );
	if ( entrance.motion?.kind !== 'pocket' ) throw apartmentError( `${entrance.id} does not publish pocket leaves` );
	if ( ! within( entrance.width, WIDTH ) || ! within( entrance.height, HEIGHT ) ) throw apartmentError( `${entrance.id} is not a door's size` );
	if ( ! Array.isArray( entrance.leaves ) || entrance.leaves.length !== 2 || entrance.leaves.some( ( leaf ) => ! leaf ) ) {

		throw apartmentError( `${entrance.id} does not publish two leaves` );

	}
	if ( ! Array.isArray( entrance.fixed ) ) throw apartmentError( `${entrance.id} publishes no fixed parts` );

}

function within( value, [ low, high ] ) {

	return Number.isFinite( value ) && value >= low && value <= high;

}

/** One published part, standing at its floor as a group of scaled copies of its module's surfaces. */
function mount( part, elevation, modules, channel ) {

	const surfaces = modules.surfacesOf( part.module );
	if ( ! surfaces.length ) throw apartmentError( `missing module ${part.module}` );

	const group = new THREE.Group();
	group.position.set( part.position[ 0 ], part.position[ 1 ] + elevation, part.position[ 2 ] );
	group.rotation.y = part.rotationY;

	for ( const { geometry, material } of surfaces ) {

		const copy = geometry.clone().scale( ...part.scale );
		metricUvs( copy, geometry, part.scale );
		const mesh = new THREE.Mesh( copy, material );
		channel?.attach( mesh );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		group.add( mesh );

	}

	return group;

}

/**
 * These are ordinary moving meshes, not copies in a shared draw that carry
 * their repeat beside them, so the maps stay in metres by stretching each
 * face's UVs by the scale baked into it: a floor or ceiling face by its width
 * and depth, a wall face by its run along the ground and its height.
 */
function metricUvs( copy, source, scale ) {

	const uv = copy.getAttribute( 'uv' );
	const normals = source.getAttribute( 'normal' );
	if ( ! uv || ! normals ) return;

	for ( let i = 0; i < uv.count; i ++ ) {

		const up = Math.abs( normals.getY( i ) ) > 0.99;
		const u = up ? scale[ 0 ] : Math.hypot( normals.getZ( i ) * scale[ 0 ], normals.getX( i ) * scale[ 2 ] );
		const v = up ? scale[ 2 ] : scale[ 1 ];
		uv.setXY( i, uv.getX( i ) * u, uv.getY( i ) * v );

	}

}

function apartmentError( message ) {

	return Object.assign( new Error( `E_APARTMENT_DOOR: ${message}` ), { code: 'E_APARTMENT_DOOR' } );

}
