const TIERS = [ 'low', 'medium', 'high', 'ultra' ];

// Tiers bound texture dimensions and lighting cost while retaining authored PBR channels.
// `msaa` is the scene pass's sample count and `maxPixelRatio` caps the device
// pixel ratio the frame renders at; GPU time scales with both.
const MATERIAL_MAPS = Object.freeze( [ 'basecolor', 'normal', 'roughness', 'metallic', 'ao', 'emission' ] );
const PRESETS = {
	low: {
		textureMaxSize: 1024,
		bloom: { strength: 0, radius: 0.0 },
		haze: false,
		// Three slots light the rooms of one live floor from their own fixtures,
		// and the pool they add up to is shared out by what each room publishes.
		roomSlots: 3,
		roomSpots: 4,
		roomStrips: 0,
		// One spot on the room the player stands in may cast (RoomLights).
		// Low and medium pay a small map. High and ultra do not: the pass is
		// one the warm-up does not build, so it would compile in play.
		roomShadow: 512,
		// The sun's one map, in texels, and the metres of ground it spans
		// around the camera (light/SunShadow.js). Low keeps a short square.
		sunShadow: 512,
		sunShadowReach: 48,
		clusteredLights: 512,
		batchedLights: 32,
		// Glossy ground and metals need something to reflect on every tier;
		// a small probe costs a few milliseconds every two minutes.
		probeSize: 32,
		probeInterval: 120,
		materialMaps: MATERIAL_MAPS,
		textureAnisotropy: 4,
		msaa: 0,
		maxPixelRatio: 1
	},
	medium: {
		textureMaxSize: 1024,
		bloom: { strength: 0.35, radius: 0.03 },
		haze: false,
		roomSlots: 3,
		roomSpots: 4,
		roomStrips: 1,
		roomShadow: 1024,
		sunShadow: 1024,
		sunShadowReach: 80,
		clusteredLights: 1024,
		batchedLights: 48,
		probeSize: 64,
		probeInterval: 90,
		materialMaps: MATERIAL_MAPS,
		textureAnisotropy: 4,
		msaa: 0,
		maxPixelRatio: 1
	},
	high: {
		textureMaxSize: 2048,
		bloom: { strength: 0.35, radius: 0.04 },
		haze: false,
		roomSlots: 4,
		roomSpots: 4,
		roomStrips: 2,
		roomShadow: 0,
		sunShadow: 2048,
		sunShadowReach: 140,
		clusteredLights: 1024,
		batchedLights: 48,
		probeSize: 64,
		probeInterval: 60,
		materialMaps: MATERIAL_MAPS,
		textureAnisotropy: 8,
		msaa: 4,
		maxPixelRatio: 1.5
	},
	ultra: {
		textureMaxSize: 4096,
		bloom: { strength: 0.4, radius: 0.06 },
		haze: false,
		roomSlots: 6,
		roomSpots: 4,
		roomStrips: 2,
		roomShadow: 0,
		sunShadow: 4096,
		sunShadowReach: 200,
		clusteredLights: 1024,
		batchedLights: 48,
		probeSize: 128,
		probeInterval: 40,
		materialMaps: MATERIAL_MAPS,
		textureAnisotropy: 8,
		msaa: 4,
		maxPixelRatio: 2
	}
};

export class QualityTier {

	static names() {

		return [ ...TIERS ];
	}

	/** The tier a backend defaults to when the run did not name one. */
	static defaultFor( backend ) {

		return backend === 'webgpu' ? 'medium' : 'low';

	}

	/** @returns { name, ...PRESETS[name] } */
	static describe( name, backend ) {

		const tier = TIERS.includes( name ) ? name : QualityTier.defaultFor( backend );

		return { name: tier, ...PRESETS[ tier ] };

	}

}
