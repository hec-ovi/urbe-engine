const DEFAULTS = {
	world: 'city-urbe-tiny',
	out: '/out/city-tiny',
	backend: 'webgpu',
	startHour: 21,
	timeScale: 1,
	crowd: 200,
	cars: 18,
	stress: 0,
	streetDensity: 1
};

const LANE_MODES = [ 'paint', 'glow', 'debug' ];

/**
 * One game run, described entirely by the URL query:
 * ?mode=game[&world=city-urbe-tiny][&out=/out/city-tiny][&backend=webgpu|webgl]
 * [&hour=21][&crowd=160][&cars=18][&density=1][&lanes=glow|debug]
 */
export class GameConfig {

	static fromUrl() {

		const q = new URLSearchParams( window.location.search );
		const int = ( key, fallback, lo, hi ) => {

			const value = parseInt( q.get( key ), 10 );

			return Number.isFinite( value ) ? Math.min( hi, Math.max( lo, value ) ) : fallback;

		};

		const float = ( key, fallback, lo, hi ) => {

			const value = parseFloat( q.get( key ) );

			return Number.isFinite( value ) ? Math.min( hi, Math.max( lo, value ) ) : fallback;

		};

		const world = q.get( 'world' ) ?? DEFAULTS.world;

		return {
			world,
			blueprintUrl: `/atlas/${world}.json`,
			outBase: q.get( 'out' ) ?? DEFAULTS.out,
			backend: q.get( 'backend' ) === 'webgl' ? 'webgl' : DEFAULTS.backend,
			startHour: int( 'hour', DEFAULTS.startHour, 0, 23 ),
			timeScale: DEFAULTS.timeScale,
			maxCrowd: int( 'crowd', DEFAULTS.crowd, 0, 600 ),
			maxCars: int( 'cars', DEFAULTS.cars, 0, 120 ),
			// The simulation's researched share of the population out on the
			// street, scaled (../simulation/CONTRACT.md params.streetDensity).
			streetDensity: float( 'density', DEFAULTS.streetDensity, 0, 8 ),
			// Debug only: repeats each real street agent N times over nearby
			// walk edges to load-test the crowd renderer. Never on by default.
			stress: int( 'stress', DEFAULTS.stress, 0, 40 ),
			// Debug only: `debug` paints every lane of the road graph end to
			// end, `glow` restores the teal emissive centreline strips. Normal
			// runs get painted road markings.
			laneMode: LANE_MODES.includes( q.get( 'lanes' ) ) ? q.get( 'lanes' ) : 'paint'
		};

	}

}
