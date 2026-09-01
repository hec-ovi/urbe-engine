import { QualityTier } from '../look/QualityTier.js';

const DEFAULTS = {
	world: 'city-urbe-tiny',
	out: '/out/city-tiny',
	backend: 'webgpu',
	startHour: 21,
	timeScale: 1,
	crowd: 200,
	cars: 18,
	stress: 0,
	streetDensity: 1,
	// The exposure the whole look is tuned at: what maps the city's real
	// photometric levels onto the 1-2% of white the reference frames sit at.
	// Measured, not guessed (docs/RESEARCH-LIGHTING.md 9).
	exposure: 0.024,
	// Street fog density per metre. The first block stays crisp; fog is what
	// separates the skyline into planes past it.
	fog: 0.0006
};

const LANE_MODES = [ 'paint', 'glow', 'debug' ];
const OFF_STAGES = [ 'fog', 'bloom', 'probe', 'haze', 'interiors' ];

/**
 * One game run, described entirely by the URL query:
 * ?mode=game[&world=city-urbe-tiny][&out=/out/city-tiny][&backend=webgpu|webgl]
 * [&hour=21][&crowd=160][&cars=18][&density=1][&lanes=glow|debug]
 * [&quality=low|medium|high|ultra][&exposure=0.024][&fog=0.0006][&off=fog,bloom,probe,haze,interiors]
 *
 * `off` names look stages to leave out of a run, for telling them apart on
 * screen: the street fog, the emissive bloom, the environment probe, the haze
 * geometry inside rooms, the streamed interiors themselves.
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
		const off = new Set( ( q.get( 'off' ) ?? '' ).split( ',' ).filter( ( stage ) => OFF_STAGES.includes( stage ) ) );

		return {
			world,
			off,
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
			laneMode: LANE_MODES.includes( q.get( 'lanes' ) ) ? q.get( 'lanes' ) : 'paint',
			// What the frame is allowed to spend. Unset follows the backend.
			quality: QualityTier.names().includes( q.get( 'quality' ) ) ? q.get( 'quality' ) : null,
			// Tuning only: moves the whole look one variable at a time.
			exposure: float( 'exposure', DEFAULTS.exposure, 0.005, 4 ),
			fog: float( 'fog', DEFAULTS.fog, 0, 0.05 )
		};

	}

}
