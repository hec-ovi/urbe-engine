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
 * fixed slots. The slot objects never change identity; walking only copies a
 * new fixture's values into them, so the renderer keeps every material's
 * lighting cache key and pipeline.
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
		this.lights = Array.from(
			{ length: Math.min( capacity, fixtures.length ) },
			() => new THREE.PointLight()
		);
		this.selection = this.lights.map( ( _, index ) => index );
		this.fixtureDim = fixtures.map( () => 1 );
		this.ranked = fixtures.map( ( _, index ) => ( { index, distance: 0 } ) );
		this.timer = RESHUFFLE_INTERVAL;
		this.dim = 1;

		for ( let slot = 0; slot < this.lights.length; slot ++ ) {

			const light = this.lights[ slot ];
			light.castShadow = false;
			this.group.add( light );
			this.#assign( slot, slot );

		}

	}

	/**
	 * How much of each fixture's published flux is actually being emitted: 1
	 * after dusk, 0 in full day. The lamps are switched, never re-authored, so
	 * relative brightness across the city is the same at every hour.
	 */
	setDim( dim ) {

		this.dim = dim;

		for ( let slot = 0; slot < this.lights.length; slot ++ ) this.#power( slot );

	}

	/**
	 * One fixture switched on its own, on top of the hour: a venue's sign goes
	 * dark when the simulation has nobody working there.
	 */
	setFixtureDim( index, dim ) {

		if ( ! this.fixtures[ index ] || this.fixtureDim[ index ] === dim ) return;

		this.fixtureDim[ index ] = dim;
		const slot = this.selection.indexOf( index );

		if ( slot >= 0 ) this.#power( slot );

	}

	#assign( slot, index ) {

		const light = this.lights[ slot ];
		const fixture = this.fixtures[ index ];

		this.selection[ slot ] = index;
		light.position.copy( fixture.position );
		light.color.copy( fixture.color );
		light.distance = fixture.range;
		light.decay = 2;
		this.#power( slot );

	}

	#power( slot ) {

		const index = this.selection[ slot ];
		this.lights[ slot ].power = this.fixtures[ index ].lumens * this.dim * this.fixtureDim[ index ];

	}

	get count() {

		return this.lights.length;

	}

	update( position, delta ) {

		if ( this.fixtures.length <= this.lights.length ) return;

		this.timer += delta;

		if ( this.timer < RESHUFFLE_INTERVAL ) return;

		this.timer = 0;

		for ( const entry of this.ranked ) {

			entry.distance = this.fixtures[ entry.index ].position.distanceToSquared( position );

		}

		this.ranked.sort( ( a, b ) => a.distance - b.distance || a.index - b.index );

		for ( let slot = 0; slot < this.lights.length; slot ++ ) {

			const index = this.ranked[ slot ].index;

			if ( this.selection[ slot ] !== index ) this.#assign( slot, index );

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
