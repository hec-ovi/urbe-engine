import * as THREE from 'three/webgpu';

const RESHUFFLE_INTERVAL = 0.25;
/** How far out a fixture still counts as filling the air the player is in. */
const AIR_RADIUS = 45;
const HANDOFF_SECONDS = 0.5;
/** Ground cell a fixture is binned in, so a question about one place reads only the fixtures near it. */
const CELL = 64;

/**
 * Every exterior fixture the city built, as a real light in photometric units:
 * `power` is the published luminous flux in lumens, `distance` its useful
 * radius, `decay` always 2. Nothing here invents a brightness, so relative
 * levels are correct across the whole city and one exposure works everywhere.
 *
 * They are unshadowed point lights on purpose: that is exactly the set
 * clustered lighting bins on the GPU, so the count costs a compute dispatch
 * rather than a BRDF evaluation per fragment. Where the backend batches
 * instead of clustering the capacity is small, and the fixtures that light the
 * player's surroundings most take fixed slots: flux over squared distance, so
 * a 24,000 lm street lamp across the road outranks a room strip behind the
 * glass beside it. The slot objects never change identity; walking only copies
 * a new fixture's values into them, so the renderer keeps every material's
 * lighting cache key and pipeline.
 */
export class CityLights {

	/**
	 * @param fixtures [{ position: Vector3, lumens, color: Color, range }]
	 * @param capacity how many may be lit at once
	 */
	constructor( fixtures, capacity, { streamed = false } = {} ) {

		this.fixtures = [ ...fixtures ];
		this.capacity = capacity;
		this.group = new THREE.Group();
		this.group.name = 'city-lights';
		this.lights = Array.from(
			{ length: streamed ? capacity : Math.min( capacity, fixtures.length ) },
			() => new THREE.PointLight()
		);
		this.selection = this.lights.map( ( _, index ) => index );
		this.fixtureDim = fixtures.map( () => 1 );
		this.grid = new FixtureGrid( this.fixtures );
		this.timer = RESHUFFLE_INTERVAL;
		this.dim = 1;
		this.clock = 0;
		this.initialized = false;
		this.weights = this.lights.map( () => 1 );
		this.handoffs = this.lights.map( () => null );

		for ( let slot = 0; slot < this.lights.length; slot ++ ) {

			const light = this.lights[ slot ];
			light.castShadow = false;
			this.group.add( light );
			this.#assign( slot, slot );

		}

	}

	/** Replaces resident fixtures while retaining every prepared light slot. */
	setFixtures( fixtures ) {

		const dim = new Map( this.fixtures.map( ( fixture, index ) => [ fixture, this.fixtureDim[ index ] ] ) );
		const retained = this.selection.map( index => this.fixtures[ index ] );
		this.fixtures = [ ...fixtures ];
		this.fixtureDim = fixtures.map( fixture => dim.get( fixture ) ?? 1 );
		this.grid = new FixtureGrid( this.fixtures );
		this.timer = RESHUFFLE_INTERVAL;
		const indices = new Map( fixtures.map( ( fixture, index ) => [ fixture, index ] ) );
		for ( let slot = 0; slot < this.lights.length; slot ++ ) {
			this.handoffs[ slot ] = null;
			this.weights[ slot ] = 1;
			this.#assign( slot, indices.get( retained[ slot ] ) ?? -1 );
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
		if ( ! fixture ) {

			light.power = 0;
			light.distance = 1;
			return;

		}
		light.position.copy( fixture.position );
		light.color.copy( fixture.color );
		light.distance = fixture.range;
		light.decay = 2;
		this.#power( slot );

	}

	#power( slot ) {

		const index = this.selection[ slot ];
		this.lights[ slot ].power = this.fixtures[ index ] ? this.fixtures[ index ].lumens * this.dim * this.fixtureDim[ index ] * this.weights[ slot ] : 0;

	}

	get count() {

		return this.lights.length;

	}

	update( position, delta ) {
		this.clock += delta;
		this.#advanceHandoffs();

		this.timer += delta;

		if ( this.timer < RESHUFFLE_INTERVAL ) return;

		this.timer = 0;

		const retained = new Set( [ ...this.selection, ...this.handoffs.filter( Boolean ).map( item => item.index ) ] );
		const ranked = this.#brightest( position, retained );
		for ( const entry of ranked ) if ( this.initialized && retained.has( entry.index ) ) entry.light /= 0.85;

		ranked.sort( ( a, b ) => b.light - a.light || a.index - b.index );

		const desired = ranked.slice( 0, this.lights.length ).map( item => item.index );
		if ( ! this.initialized ) {
			for ( let slot = 0; slot < this.lights.length; slot++ ) this.#assign( slot, desired[ slot ] ?? -1 );
			this.initialized = true;
			return;
		}
		const occupied = new Set( this.selection );
		for ( const pending of this.handoffs ) if ( pending ) occupied.add( pending.index );
		const incoming = desired.filter( index => ! occupied.has( index ) );
		for ( let slot = 0; slot < this.lights.length && incoming.length; slot++ ) {
			if ( this.handoffs[ slot ] || desired.includes( this.selection[ slot ] ) ) continue;
			this.handoffs[ slot ] = { index: incoming.shift(), start: this.clock, assigned: false };
		}

	}

	/**
	 * Every fixture that could rank among the slots, with the light it sends
	 * the point (flux over squared distance): the grid is read a ring of cells
	 * at a time until as many fixtures as there are slots surely outshine
	 * anything past the rings read, which the brightest fixture in the city
	 * would do standing just beyond them. Only those, and the ones the slots
	 * hold now, are ranked, so the ranking is the one a scan of the whole city
	 * gives.
	 */
	#brightest( position, retained ) {

		const read = [];
		const lights = [];
		/** How many read fixtures outshine the edge of each ring's reach, by the first ring they do. */
		const within = [];
		const peak = this.grid.peak;
		let surely = 0;
		let floor = 0;

		for ( let ring = 0; this.grid.reaches( position, ring ); ring ++ ) {

			this.grid.ring( position, ring, ( index ) => {

				const fixture = this.fixtures[ index ];
				const light = lightAt( fixture, position );
				read.push( index );
				lights.push( light );
				// Past a reach r nothing unread sends more than peak / r², so this
				// fixture is sure to count from the first ring reaching that far.
				if ( light > 0 ) {

					const first = Math.ceil( Math.sqrt( peak / light ) / CELL );
					within[ first ] = ( within[ first ] ?? 0 ) + 1;

				}

			} );
			// A fixture read in a later ring is past this one, so it cannot count here.
			surely += within[ ring ] ?? 0;
			if ( ring > 0 && surely >= this.lights.length ) {

				floor = peak / ( ring * CELL ) ** 2;
				break;

			}

		}

		const ranked = [];
		const kept = new Set();
		for ( let at = 0; at < read.length; at ++ ) {

			if ( lights[ at ] < floor ) continue;
			ranked.push( { index: read[ at ], light: lights[ at ] } );
			kept.add( read[ at ] );

		}
		for ( const index of retained ) {

			if ( this.fixtures[ index ] && ! kept.has( index ) ) ranked.push( { index, light: lightAt( this.fixtures[ index ], position ) } );

		}

		return ranked;

	}

	#advanceHandoffs() {
		for ( let slot = 0; slot < this.lights.length; slot++ ) {
			const pending = this.handoffs[ slot ];
			if ( ! pending ) continue;
			const progress = Math.min( 1, ( this.clock - pending.start ) / HANDOFF_SECONDS );
			if ( progress < 0.5 ) this.weights[ slot ] = 1 - progress * 2;
			else {
				this.weights[ slot ] = ( progress - 0.5 ) * 2;
				if ( ! pending.assigned ) { this.#assign( slot, pending.index ); pending.assigned = true; }
			}
			this.#power( slot );
			if ( progress === 1 ) this.handoffs[ slot ] = null;
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

		this.grid.near( position, AIR_RADIUS, ( index ) => {

			const fixture = this.fixtures[ index ];

			if ( fixture.position.distanceToSquared( position ) > AIR_RADIUS * AIR_RADIUS ) return;

			const weight = lightAt( fixture, position );

			target.r += fixture.color.r * weight;
			target.g += fixture.color.g * weight;
			target.b += fixture.color.b * weight;
			total += weight;

		} );

		if ( total > 0 ) target.multiplyScalar( 1 / total );

		return { color: target, lux: total / ( 4 * Math.PI ) };

	}

}

/** The light a fixture sends a point: its flux over the squared distance, never nearer than two metres. */
function lightAt( fixture, position ) {

	return fixture.lumens / Math.max( 4, fixture.position.distanceToSquared( position ) );

}

/** Fixture indices binned by ground cell, and the brightest flux among them. */
class FixtureGrid {

	constructor( fixtures ) {

		this.cells = new Map();
		this.peak = fixtures.reduce( ( peak, fixture ) => Math.max( peak, fixture.lumens ), 0 );
		this.bounds = { i0: Infinity, i1: - Infinity, j0: Infinity, j1: - Infinity };
		fixtures.forEach( ( fixture, index ) => {

			const i = cellOf( fixture.position.x ), j = cellOf( fixture.position.z );
			const key = keyOf( i, j );
			if ( ! this.cells.has( key ) ) this.cells.set( key, [] );
			this.cells.get( key ).push( index );
			this.bounds.i0 = Math.min( this.bounds.i0, i );
			this.bounds.i1 = Math.max( this.bounds.i1, i );
			this.bounds.j0 = Math.min( this.bounds.j0, j );
			this.bounds.j1 = Math.max( this.bounds.j1, j );

		} );

	}

	/** Each fixture in the cells a disc of this radius around the point touches. */
	near( position, radius, visit ) {

		for ( let i = cellOf( position.x - radius ), i1 = cellOf( position.x + radius ); i <= i1; i ++ ) {

			for ( let j = cellOf( position.z - radius ), j1 = cellOf( position.z + radius ); j <= j1; j ++ ) this.#visit( i, j, visit );

		}

	}

	/** Each fixture in the square ring of cells `ring` cells out from the point's own cell. */
	ring( position, ring, visit ) {

		const i = cellOf( position.x ), j = cellOf( position.z );
		if ( ring === 0 ) return this.#visit( i, j, visit );
		for ( let step = - ring; step <= ring; step ++ ) {

			this.#visit( i + step, j - ring, visit );
			this.#visit( i + step, j + ring, visit );

		}
		for ( let step = 1 - ring; step < ring; step ++ ) {

			this.#visit( i - ring, j + step, visit );
			this.#visit( i + ring, j + step, visit );

		}

	}

	/** Whether that ring, or any ring inside it, still holds a cell with fixtures. */
	reaches( position, ring ) {

		const { i0, i1, j0, j1 } = this.bounds;
		const i = cellOf( position.x ), j = cellOf( position.z );

		return i0 <= i1 && ring <= Math.max( i - i0, i1 - i, j - j0, j1 - j, 0 );

	}

	#visit( i, j, visit ) {

		for ( const index of this.cells.get( keyOf( i, j ) ) ?? [] ) visit( index );

	}

}

function cellOf( metres ) {

	return Math.floor( metres / CELL );

}

function keyOf( i, j ) {

	return `${i}:${j}`;

}
