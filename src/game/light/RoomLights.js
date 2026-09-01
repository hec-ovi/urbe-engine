import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import { RoomFill } from './RoomFill.js';

const RESHUFFLE_INTERVAL = 0.2;
/** Housing depth of a published strip or cove, in metres. */
const STRIP_WIDTH = 0.06;
const UP = new THREE.Vector3( 0, 1, 0 );

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
 * So the sets are a fixed pool. Each slot owns the same light objects for the
 * life of the run, and entering a room re-points them: same ids, same shader,
 * one set of materials compiled once. The rooms move through the slots, never
 * the other way round. Rooms in view without a slot take the dim set, which is
 * fill only, so a corridor seen through a doorway is lit air rather than a hole.
 *
 * Flux is conserved: whatever the direct lights do not carry stays in the fill,
 * which is the term that gives a wall its bounce gradient.
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

		this.dim = slot( 0, 0 );

	}

	/** Every light object the pool owns, for the frame's matrix update. */
	#all() {

		return [ this.dim, ...this.slots ];

	}

	/**
	 * The material a room's mesh wears while it holds `binding`. Cloned once per
	 * binding and key, so the whole run compiles (slots + 1) x keys shaders.
	 */
	materialFor( binding, key ) {

		let material = binding.materials.get( key );

		if ( ! material ) {

			material = this.factory.build( key ).clone();
			material.name = `${key}|room${binding.index}`;
			material.lightsNode = binding.lightsNode;
			binding.materials.set( key, material );

		}

		return material;

	}

	/**
	 * @param rooms every room currently in view, nearest first
	 * @param position the player's feet
	 */
	update( rooms, position, delta ) {

		this.timer += delta;

		if ( this.timer < RESHUFFLE_INTERVAL ) return;

		this.timer = 0;

		const near = rooms.slice( 0, this.slots.length );

		for ( let i = 0; i < this.slots.length; i ++ ) {

			const binding = this.slots[ i ];
			const room = near[ i ];

			if ( binding.room !== room ) {

				binding.room?.wear( this.dim, this );
				binding.room = room ?? null;
				room?.wear( binding, this );

			}

			this.#write( binding, room );

		}

		for ( const room of rooms.slice( this.slots.length ) ) {

			if ( room.binding !== this.dim ) room.wear( this.dim, this );

		}

		this.#writeDim( rooms.slice( this.slots.length ) );

		for ( const binding of this.#all() ) refresh( binding );

	}

	/** Points one slot's lights at the room holding it. */
	#write( binding, room ) {

		if ( ! room ) {

			binding.fill.intensity = 0;
			for ( const light of binding.spots ) light.intensity = 0;
			for ( const light of binding.strips ) light.intensity = 0;
			return;

		}

		const spots = room.fixtures.filter( ( f ) => f.kind === 'spot' );
		const strips = room.fixtures.filter( ( f ) => f.kind !== 'spot' );

		place( binding.spots, spots, aimSpot );
		place( binding.strips, strips, aimStrip );

		binding.fill.position.copy( room.center ).add( UP );
		RoomFill.apply( binding.fill, room, room.flux, room.color );

	}

	/** One shared fill for the rooms in view that hold no slot. */
	#writeDim( rooms ) {

		if ( ! rooms.length ) {

			this.dim.fill.intensity = 0;
			return;

		}

		let flux = 0;
		let area = 0;
		_color.setRGB( 0, 0, 0, THREE.LinearSRGBColorSpace );
		_albedo.setRGB( 0, 0, 0, THREE.LinearSRGBColorSpace );
		_floor.setRGB( 0, 0, 0, THREE.LinearSRGBColorSpace );

		for ( const room of rooms ) {

			flux += room.flux;
			area += room.area;
			_color.r += room.color.r * room.flux;
			_color.g += room.color.g * room.flux;
			_color.b += room.color.b * room.flux;
			_albedo.add( room.albedo );
			_floor.add( room.floorAlbedo );

		}

		if ( flux > 0 ) _color.multiplyScalar( 1 / flux );
		_albedo.multiplyScalar( 1 / rooms.length );
		_floor.multiplyScalar( 1 / rooms.length );

		this.dim.fill.position.copy( rooms[ 0 ].center ).add( UP );
		RoomFill.apply( this.dim.fill, { area, albedo: _albedo, floorAlbedo: _floor }, flux, _color );

	}

}

/** One light set with ids that never change, plus the materials wearing it. */
function slot( spotCount, stripCount ) {

	const fill = new THREE.HemisphereLight( 0xffffff, 0xffffff, 0 );
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

	const members = [ fill, ...spots, ...strips ];

	return {
		index: _slots ++,
		fill, spots, strips, members,
		lightsNode: lights( members ),
		materials: new Map(),
		room: null
	};

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
	light.target.position.copy( fixture.position ).add( fixture.facing === 'up' ? UP : _down );
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
	light.rotation.set(
		fixture.facing === 'up' ? - Math.PI / 2 : Math.PI / 2,
		THREE.MathUtils.degToRad( fixture.angleDeg ),
		0,
		'YXZ'
	);
	light.power = fixture.lumens;

}

/** Lights outside the scene graph never get a matrix update of their own. */
function refresh( binding ) {

	for ( const light of binding.members ) light.updateMatrixWorld( true );

}

let _slots = 0;
const _down = new THREE.Vector3( 0, - 1, 0 );
const _color = new THREE.Color();
const _albedo = new THREE.Color();
const _floor = new THREE.Color();
