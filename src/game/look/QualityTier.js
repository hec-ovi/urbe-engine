const TIERS = [ 'low', 'medium', 'high', 'ultra' ];

/**
 * What each tier turns on. Bloom is tuned against the measured glow profile of
 * a street lamp, not by eye: its halo falls under a tenth of the source's peak
 * within about five source radii and never reaches a fifth of the frame.
 *
 * `low` is not a broken `high`: it keeps physical light units, the computed
 * room fill, the fog floor and selective bloom, which is most of what the
 * reference frames are made of, and gives up the per-fragment luxuries.
 *
 * Every effect downstream reads this descriptor, never the backend, so the
 * WebGL2 fallback is one default choice rather than a second pipeline.
 */
const PRESETS = {
	low: {
		bloom: { strength: 0.5, radius: 0.0 },
		haze: true,
		roomSlots: 2,
		roomSpots: 4,
		roomStrips: 0,
		clusteredLights: 512,
		batchedLights: 32,
		probeSize: 64,
		probeInterval: 120
	},
	medium: {
		bloom: { strength: 0.6, radius: 0.1 },
		haze: true,
		roomSlots: 3,
		roomSpots: 4,
		roomStrips: 1,
		clusteredLights: 1024,
		batchedLights: 48,
		probeSize: 128,
		probeInterval: 90
	},
	high: {
		bloom: { strength: 0.6, radius: 0.1 },
		haze: true,
		roomSlots: 4,
		roomSpots: 4,
		roomStrips: 2,
		clusteredLights: 1024,
		batchedLights: 48,
		probeSize: 128,
		probeInterval: 60
	},
	ultra: {
		bloom: { strength: 0.6, radius: 0.15 },
		haze: true,
		roomSlots: 6,
		roomSpots: 4,
		roomStrips: 2,
		clusteredLights: 1024,
		batchedLights: 48,
		probeSize: 256,
		probeInterval: 40
	}
};

export class QualityTier {

	static names() {

		return [ ...TIERS ];
	}

	/** The tier a backend defaults to when the run did not name one. */
	static defaultFor( backend ) {

		return backend === 'webgpu' ? 'high' : 'low';

	}

	/** @returns { name, ...PRESETS[name] } */
	static describe( name, backend ) {

		const tier = TIERS.includes( name ) ? name : QualityTier.defaultFor( backend );

		return { name: tier, ...PRESETS[ tier ] };

	}

}
