import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import { RoomFillNode } from './RoomFillNode.js';

const RESHUFFLE_INTERVAL = 0.2;
/** Housing depth of a published strip or cove, in metres. */
const STRIP_WIDTH = 0.06;
/**
 * How far past its reach a spot's cutoff stands.
 *
 * Three's window term falls to zero **at** `distance`, so a downlight whose
 * reach is its own height above the floor delivers nothing to the floor
 * directly under it. A fixture's reach is the surface it lights, so the cutoff
 * has to sit beyond it: at this margin the surface keeps about 95 percent of
 * the inverse-square value, and the light still ends where the room does.
 */
const REACH_MARGIN = 2.5;
/**
 * A line source this close to the surface it faces is indirect: the cove
 * tucked under a soffit blows a hot line on the slab and returns nothing to
 * the room, and the bounce off that slab is already in the room's fill, so
 * spending a rect light on it spends it twice. Those coves are also the
 * brightest records a room publishes, so without this they take every rect
 * slot and the wall joints, which are the grazing light the panel relief
 * reads against, never get one.
 */
const INDIRECT_REACH = 0.3;
const UP = new THREE.Vector3( 0, 1, 0 );
/** Map decode promises ride on a symbol, which a material copy does not carry over. */
const RESOURCES = Symbol.for( 'urbe.material-resources' );

/**
 * Interior rooms lit by the fixtures the interior box published for them.
 *
 * A material's own `lightsNode` replaces the scene-wide one, so a room's walls
 * compile against a handful of lights instead of the whole city's, and a
 * fixture appearing anywhere else in the world cannot invalidate them. The trap
 * is that a lights node hashes each light's **id** into the shader cache key,
 * so a set built fresh per room would compile a shader per room and stutter at
 * every doorway.
 *
 * So the lights are a fixed pool. Each slot owns the same spot and strip
 * objects for the life of the run, and entering a room re-points them: same
 * ids, same shader. The rooms move through the slots, never the other way
 * round. Every module and furniture surface in the city is drawn by one batch
 * per material, so those materials wear one lights node holding every slot's
 * lights: whichever rooms hold a slot are lit, and the batch never recompiles.
 *
 * The pool is handed out by need, not one slot per room. A toilet of eight
 * square metres and a sales floor of two thousand publish very different
 * numbers of fixtures, so each room takes its share of the pool and whatever
 * the small rooms cannot use goes to the room the player is nearest, which is
 * the one they are standing in.
 *
 * Flux is conserved: whatever the direct lights do not carry stays in the fill,
 * which is the term that gives a wall its bounce gradient. That fill is a
 * room's own, so it rides on each copy (RoomFillNode) rather than in the pool,
 * where one room's bounce would light the whole city.
 */
export class RoomLights {

	/**
	 * @param factory PbrMaterialFactory, for the base material of each key
	 * @param tier quality descriptor (roomSlots, roomSpots, roomStrips, roomShadow)
	 */
	constructor( factory, tier ) {

		this.factory = factory;
		this.slots = [];
		/** The shadow map one room light carries, or 0 where the tier pays for none. */
		this.shadowSize = tier.roomShadow ?? 0;
		this.timer = RESHUFFLE_INTERVAL;

		for ( let i = 0; i < tier.roomSlots; i ++ ) {

			this.slots.push( slot( tier.roomSpots, tier.roomStrips ) );

		}

		/** The pool itself, flat: any light can be pointed at any room in view. */
		this.spots = this.slots.flatMap( ( binding ) => binding.spots );
		// One caster, and it is the first light of the pool, which is the
		// brightest fixture of the room the player is standing in.
		if ( this.shadowSize && this.spots.length ) {

			const caster = this.spots[ 0 ];
			caster.shadow.mapSize.setScalar( this.shadowSize );
			caster.shadow.bias = - 0.002;
			caster.shadow.camera.near = 0.2;

		}
		this.strips = this.slots.flatMap( ( binding ) => binding.strips );
		this.rooms = [];
		this.position = new THREE.Vector3();

		/** The one lights node every room material wears, and those materials. */
		this.pool = {
			lightsNode: lights( [ ...this.slots.flatMap( ( binding ) => binding.members ), new RoomFillNode() ] ),
			materials: new Map()
		};

	}

	/**
	 * The material a room surface wears: the source, or the key's catalog
	 * material, cloned once per identity and lit by the pool. A key may name
	 * the variant the interior box asked for after a `#`: a patterned ceiling
	 * and a plain one are one database entry and two looks.
	 */
	materialFor( key, source = null ) {

		const identity = source ?? key;
		let material = this.pool.materials.get( identity );

		if ( ! material ) {

			const [ entry, variant ] = key.split( '#' );

			// A node material, not a copy of the standard one: `lightsNode` is a
			// node-material property, and the conversion the renderer does for a
			// standard material drops it, which leaves the room lit by the
			// city's own lights, which is to say not at all.
			const base = source ?? this.factory.build( entry, variant );
			material = ( base.isMeshBasicMaterial ? new THREE.MeshBasicNodeMaterial() : new THREE.MeshPhysicalNodeMaterial() ).copy( base );
			// Three's NodeMaterial.copy does not copy inherited material accessors
			// or symbol-keyed properties.
			material.alphaTest = base.alphaTest;
			if ( base[ RESOURCES ] ) material[ RESOURCES ] = base[ RESOURCES ];
			material.name = `${base.name || key}|room`;
			// An unlit source stays unlit.
			if ( ! base.isMeshBasicMaterial ) material.lightsNode = this.pool.lightsNode;
			this.pool.materials.set( identity, material );

		}

		return material;

	}

	/** Source clones belong to whoever loaded the source; catalog clones stay cached. */
	releaseSources( sources ) {

		for ( const source of sources ) {

			this.pool.materials.get( source )?.dispose();
			this.pool.materials.delete( source );

		}

	}

	/** A dropped room must not remain referenced by a live light. */
	releaseRooms( rooms ) {

		const gone = new Set( rooms );
		const kept = this.rooms.filter( ( room ) => ! gone.has( room ) );

		if ( kept.length === this.rooms.length ) return;

		this.rooms = kept;
		this.#write();

	}

	/**
	 * @param rooms every room currently in view, nearest first
	 */
	update( rooms, position, delta ) {

		this.timer += delta;

		if ( this.timer < RESHUFFLE_INTERVAL ) return;

		this.timer = 0;
		this.rooms = rooms.slice( 0, this.slots.length );
		this.position.copy( position );
		this.#write();

	}

	/** Points the pool at the rooms in view, each room taking its share of it. */
	#write() {

		// Where the tier carries no line sources, a strip still has to light the
		// room it was published for, so it competes for a spot instead: the
		// stretched highlight is lost, the room's own light is not.
		const line = this.strips.length > 0;

		const spots = share( this.rooms, this.spots.length, ( room ) => byFlux( line ? room.fixtures.filter( isSpot ) : room.fixtures ) );

		place( this.spots, spots, aimSpot );
		// A caster with nothing to light still renders its map every frame.
		if ( this.shadowSize && this.spots.length ) this.spots[ 0 ].castShadow = Boolean( spots[ 0 ] );
		place(
			this.strips,
			line ? share( this.rooms, this.strips.length, ( room ) => byReach( room.fixtures.filter( ( one ) => ! isSpot( one ) ), this.position ) ) : [],
			aimStrip
		);

		for ( const binding of this.slots ) refresh( binding );
		// A slot no longer names one room, so what it holds is whatever of the
		// pool its own lights were given.
		for ( const [ at, binding ] of this.slots.entries() ) binding.room = this.rooms[ at ] ?? null;

	}

}

const isSpot = ( fixture ) => fixture.kind === 'spot';

/**
 * How much of the pool each room gets, and which of its fixtures.
 *
 * Every room in view keeps one light, so none of them goes black, and the rest
 * of the pool is handed out nearest first, each room capped by what it
 * publishes. A toilet with two fixtures therefore takes two and the sales
 * floor the player is standing in takes everything the small rooms around it
 * cannot use, which is what sizing the share by the fixtures a room hangs
 * amounts to.
 */
function share( rooms, capacity, rank ) {

	const wanted = rooms.map( rank );
	const taken = wanted.map( () => 0 );
	let spare = capacity;

	for ( let at = 0; at < wanted.length && spare > 0; at ++ ) {

		if ( ! wanted[ at ].length ) continue;
		taken[ at ] = 1;
		spare --;

	}
	for ( let at = 0; at < wanted.length && spare > 0; at ++ ) {

		const more = Math.min( spare, wanted[ at ].length - taken[ at ] );
		taken[ at ] += more;
		spare -= more;

	}

	return wanted.flatMap( ( list, at ) => list.slice( 0, taken[ at ] ) );

}

/** A room's spots, brightest first. */
function byFlux( fixtures ) {

	return fixtures.slice().sort( ( a, b ) => b.lumens - a.lumens );

}

/**
 * A room's line sources worth a rect light: the ones that face into the room
 * rather than into the surface they are tucked against, nearest the player
 * first, because a stretched highlight is only worth a slot where it is seen.
 */
function byReach( fixtures, position ) {

	return fixtures
		.filter( ( one ) => ! ( one.facing === 'up' && one.reach !== undefined && one.reach < INDIRECT_REACH ) )
		.sort( ( a, b ) => a.position.distanceToSquared( position ) - b.position.distanceToSquared( position ) );

}

/** One light set with ids that never change. */
function slot( spotCount, stripCount ) {

	const spots = [];
	const strips = [];

	for ( let i = 0; i < spotCount; i ++ ) {

		const light = new THREE.SpotLight( 0xffffff, 0, 1, Math.PI / 4, 0.5, 2 );
		light.castShadow = false;
		spots.push( light );

	}

	for ( let i = 0; i < stripCount; i ++ ) {

		strips.push( new THREE.RectAreaLight( 0xffffff, 0, 1, STRIP_WIDTH ) );

	}

	return { spots, strips, members: [ ...spots, ...strips ], room: null };

}

/** Assigns chosen fixtures to the pool, darkening whatever is left over. */
function place( pool, chosen, aim ) {

	for ( let i = 0; i < pool.length; i ++ ) {

		const light = pool[ i ];
		const fixture = chosen[ i ];

		if ( ! fixture ) {

			light.intensity = 0;
			continue;

		}

		light.color.copy( fixture.color );
		light.position.copy( fixture.position );
		aim( light, fixture );

	}

}

/**
 * A published spot states its full beam spread, so its candela is the flux over
 * the cone's own solid angle. `power` would assume a 120 degree cone and get a
 * 100 degree downlight wrong by a third.
 */
function aimSpot( light, fixture ) {

	const angle = THREE.MathUtils.degToRad( fixture.beamDeg ) / 2;
	const steradians = 2 * Math.PI * ( 1 - Math.cos( angle ) );

	light.angle = angle;
	light.penumbra = fixture.diffuse;
	light.distance = fixture.range * REACH_MARGIN;
	light.decay = 2;
	light.intensity = fixture.lumens / Math.max( 0.1, steradians );
	light.target.position.copy( fixture.position ).add( fixture.direction ?? ( fixture.facing === 'up' ? UP : _down ) );
	light.target.updateMatrixWorld();

}

/**
 * A strip or a cove is a line source, and the stretched highlight it leaves is
 * the shape the reference interiors are full of. `RectAreaLight.intensity` is
 * nits, so the published lumens go through `power`, which does the area
 * conversion once the light is sized.
 */
function aimStrip( light, fixture ) {

	light.width = Math.max( 0.1, fixture.length );
	light.height = STRIP_WIDTH;
	light.rotation.copy( stripEuler( fixture ) );
	light.power = fixture.lumens;

}

/** Published world lens axis and emitting normal become a rect light's local X and -Z. */
export function stripEuler( fixture ) {

	const angle = THREE.MathUtils.degToRad( fixture.angleDeg ?? 0 );
	const axis = fixture.axis?.clone() ?? new THREE.Vector3( Math.cos( angle ), 0, Math.sin( angle ) );
	const normal = fixture.direction?.clone() ?? new THREE.Vector3( 0, fixture.facing === 'up' ? 1 : - 1, 0 );
	const z = normal.normalize().negate();
	axis.addScaledVector( z, - axis.dot( z ) ).normalize();
	const y = new THREE.Vector3().crossVectors( z, axis ).normalize();
	return new THREE.Euler().setFromRotationMatrix( new THREE.Matrix4().makeBasis( axis, y, z ) );

}

/** Lights outside the scene graph never get a matrix update of their own. */
function refresh( binding ) {

	for ( const light of binding.members ) light.updateMatrixWorld( true );

}

const _down = new THREE.Vector3( 0, - 1, 0 );
