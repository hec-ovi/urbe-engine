const TIERS = [ 'low', 'medium', 'high', 'ultra' ];

// Tiers bound texture dimensions and lighting cost while retaining authored PBR channels.
const MATERIAL_MAPS = Object.freeze( [ 'basecolor', 'normal', 'roughness', 'metallic', 'ao', 'emission' ] );
const PRESETS = {
	low: {
		textureMaxSize: 1024,
		bloom: { strength: 0, radius: 0.0 },
		haze: false,
		roomSlots: 2,
		roomSpots: 4,
		roomStrips: 0,
		clusteredLights: 512,
		batchedLights: 32,
		probeSize: 0,
		probeInterval: 120,
		materialMaps: MATERIAL_MAPS,
		materialVariants: 2,
		textureAnisotropy: 2
	},
	medium: {
		textureMaxSize: 1024,
		bloom: { strength: 0.35, radius: 0.03 },
		haze: false,
		roomSlots: 3,
		roomSpots: 4,
		roomStrips: 1,
		clusteredLights: 1024,
		batchedLights: 48,
		probeSize: 64,
		probeInterval: 90,
		materialMaps: MATERIAL_MAPS,
		materialVariants: 4,
		textureAnisotropy: 4
	},
	high: {
		textureMaxSize: 2048,
		bloom: { strength: 0.35, radius: 0.04 },
		haze: false,
		roomSlots: 4,
		roomSpots: 4,
		roomStrips: 2,
		clusteredLights: 1024,
		batchedLights: 48,
		probeSize: 64,
		probeInterval: 60,
		materialMaps: MATERIAL_MAPS,
		materialVariants: 6,
		textureAnisotropy: 8
	},
	ultra: {
		textureMaxSize: 4096,
		bloom: { strength: 0.4, radius: 0.06 },
		haze: false,
		roomSlots: 6,
		roomSpots: 4,
		roomStrips: 2,
		clusteredLights: 1024,
		batchedLights: 48,
		probeSize: 128,
		probeInterval: 40,
		materialMaps: MATERIAL_MAPS,
		materialVariants: 12,
		textureAnisotropy: 8
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
