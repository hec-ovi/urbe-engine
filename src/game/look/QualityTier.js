const TIERS = [ 'low', 'medium', 'high', 'ultra' ];

/**
 * What each tier turns on. `low` is not a broken `high`: it keeps physical
 * light units, the computed room fill, the fog floor and selective bloom,
 * which is most of what the reference frames are made of, and gives up the
 * per-fragment luxuries.
 *
 * Every effect downstream reads this descriptor, never the backend, so the
 * WebGL2 fallback is one default choice rather than a second pipeline.
 */
const PRESETS = {
	low: {
		bloom: { strength: 0.9, radius: 0.35 },
		haze: true,
		roomSlots: 2,
		roomSpots: 4,
		roomStrips: 0,
		clusteredLights: 512,
		batchedLights: 32,
		fogBlur: false,
		probeSize: 64,
		probeInterval: 0
	},
	medium: {
		bloom: { strength: 1.1, radius: 0.45 },
		haze: true,
		roomSlots: 3,
		roomSpots: 4,
		roomStrips: 1,
		clusteredLights: 1024,
		batchedLights: 48,
		fogBlur: false,
		probeSize: 128,
		probeInterval: 90
	},
	high: {
		bloom: { strength: 1.2, radius: 0.5 },
		haze: true,
		roomSlots: 4,
		roomSpots: 4,
		roomStrips: 2,
		clusteredLights: 1024,
		batchedLights: 48,
		fogBlur: true,
		probeSize: 128,
		probeInterval: 60
	},
	ultra: {
		bloom: { strength: 1.2, radius: 0.55 },
		haze: true,
		roomSlots: 6,
		roomSpots: 4,
		roomStrips: 2,
		clusteredLights: 1024,
		batchedLights: 48,
		fogBlur: true,
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
