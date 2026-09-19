import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import { RoomFillNode } from './RoomFillNode.js';

const RESHUFFLE_INTERVAL = 0.2;
/** Housing depth of a published strip or cove, in metres. */
const STRIP_WIDTH = 0.06;
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
 * Flux is conserved: whatever the direct lights do not carry stays in the fill,
 * which is the term that gives a wall its bounce gradient. That fill is a
 * room's own, so it rides on each copy (RoomFillNode) rather than in the pool,
 * where one room's bounce would light the whole city.
 */
export class RoomLights {

	/**
	 * @param factory PbrMaterialFactory, for the base material of each key
	 * @param tier quality descriptor (roomSlots, roomSpots, roomStrips)
	 */
	constructor( factory, tier ) {

		this.factory = factory;
		this.slots = [];
		this.timer = RESHUFFLE_INTERVAL;

		for ( let i = 0; i < tier.roomSlots; i ++ ) {

			this.slots.push( slot( tier.roomSpots, tier.roomStrips ) );

		}

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

	/** A dropped room must not remain referenced by a live light slot. */
	releaseRooms( rooms ) {

		const gone = new Set( rooms );
		for ( const binding of this.slots ) if ( gone.has( binding.room ) ) {

			binding.room = null;
			this.#write( binding, null );

		}

	}

	/**
	 * @param rooms every room currently in view, nearest first
	 */
	update( rooms, position, delta ) {

		this.timer += delta;

		if ( this.timer < RESHUFFLE_INTERVAL ) return;

		this.timer = 0;

		for ( let i = 0; i < this.slots.length; i ++ ) {

			const binding = this.slots[ i ];

			binding.room = rooms[ i ] ?? null;
			this.#write( binding, binding.room );
			refresh( binding );

		}

	}

	/** Points one slot's lights at the room holding it. */
	#write( binding, room ) {

		if ( ! room ) {

			for ( const light of binding.members ) light.intensity = 0;
			return;

		}

		// Where the tier carries no line sources, a strip still has to light the
		// room it was published for, so it competes for a spot instead: the
		// stretched highlight is lost, the room's own light is not.
		const line = binding.strips.length > 0;
		const spots = line ? room.fixtures.filter( ( f ) => f.kind === 'spot' ) : room.fixtures;
		const strips = line ? room.fixtures.filter( ( f ) => f.kind !== 'spot' ) : [];

		place( binding.spots, spots, aimSpot );
		place( binding.strips, strips, aimStrip );

	}

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

/** Assigns fixtures to a fixed pool of lights, darkening whatever is left over. */
function place( pool, fixtures, aim ) {

	const chosen = fixtures.slice().sort( ( a, b ) => b.lumens - a.lumens ).slice( 0, pool.length );

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
	light.distance = fixture.range;
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
