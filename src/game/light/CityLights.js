import * as THREE from 'three/webgpu';

const RESHUFFLE_INTERVAL = 0.25;
/** How far out a fixture still counts as filling the air the player is in. */
const AIR_RADIUS = 45;

/**
 * Every exterior fixture the city built, as a real light in photometric units:
 * `power` is the published luminous flux in lumens, `distance` its useful
 * radius, `decay` always 2. Nothing here invents a brightness, so relative
 * levels are correct across the whole city and one exposure works everywhere.
 *
 * They are unshadowed point lights on purpose: that is exactly the set
 * clustered lighting bins on the GPU, so the count costs a compute dispatch
 * rather than a BRDF evaluation per fragment. Where the backend batches
 * instead of clustering the capacity is small and the nearest fixtures take
 * the slots; toggling a light's visibility never recompiles anything, because
 * neither lighting system folds a batched or clustered light's id into its
 * shader cache key.
 */
export class CityLights {

	/**
	 * @param fixtures [{ position: Vector3, lumens, color: Color, range }]
	 * @param capacity how many may be lit at once
	 */
	constructor( fixtures, capacity ) {

		this.fixtures = fixtures;
		this.capacity = capacity;
		this.group = new THREE.Group();
		this.group.name = 'city-lights';
		this.lights = [];
		this.timer = RESHUFFLE_INTERVAL;
		this.dim = 1;

		for ( const fixture of fixtures ) {

			const light = new THREE.PointLight( fixture.color, 1, fixture.range, 2 );
			light.position.copy( fixture.position );
			light.power = fixture.lumens;
			light.castShadow = false;
			light.visible = this.lights.length < capacity;
			this.lights.push( light );
			this.group.add( light );

		}

	}

	/**
	 * How much of each fixture's published flux is actually being emitted: 1
	 * after dusk, 0 in full day. The lamps are switched, never re-authored, so
	 * relative brightness across the city is the same at every hour.
	 */
	setDim( dim ) {

		this.dim = dim;
		this.group.visible = dim > 0;

		for ( let i = 0; i < this.lights.length; i ++ ) this.lights[ i ].power = this.fixtures[ i ].lumens * dim;

	}

	get count() {

		return Math.min( this.capacity, this.lights.length );

	}

	update( position, delta ) {

		if ( this.lights.length <= this.capacity ) return;

		this.timer += delta;

		if ( this.timer < RESHUFFLE_INTERVAL ) return;

		this.timer = 0;

		const ranked = this.lights
			.map( ( light, i ) => ( { i, d: light.position.distanceToSquared( position ) } ) )
			.sort( ( a, b ) => a.d - b.d );

		for ( let rank = 0; rank < ranked.length; rank ++ ) {

			this.lights[ ranked[ rank ].i ].visible = rank < this.capacity;

		}

	}

	/**
	 * The colour of the light filling the air around a point, weighted by flux
	 * over distance. Fog colour is a consequence of the lighting rather than an
	 * art choice, and this is the source it reads.
	 * @returns { color, lux } where lux is a rough scalar for how lit the air is
	 */
	airColor( position, target = new THREE.Color() ) {

		target.setRGB( 0, 0, 0, THREE.LinearSRGBColorSpace );

		let total = 0;

		for ( const fixture of this.fixtures ) {

			const d2 = fixture.position.distanceToSquared( position );

			if ( d2 > AIR_RADIUS * AIR_RADIUS ) continue;

			const weight = fixture.lumens / Math.max( 4, d2 );

			target.r += fixture.color.r * weight;
			target.g += fixture.color.g * weight;
			target.b += fixture.color.b * weight;
			total += weight;

		}

		if ( total > 0 ) target.multiplyScalar( 1 / total );

		return { color: target, lux: total / ( 4 * Math.PI ) };

	}

}
