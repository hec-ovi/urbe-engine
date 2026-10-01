import * as THREE from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { DynamicLighting } from 'three/addons/lighting/DynamicLighting.js';
import DynamicLightsNode from 'three/addons/tsl/lighting/DynamicLightsNode.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { ReachedPointLightDataNode } from './LightReach.js';

/**
 * Which lighting system the renderer runs, decided once after `renderer.init()`
 * because that is when the WebGPU-to-WebGL2 fallback has already happened.
 *
 * WebGPU gets Forward+ clustering: the frustum is binned on the GPU and a
 * fragment loops only over its own cluster, so hundreds of street fixtures cost
 * one compute dispatch instead of one BRDF evaluation each. The binning kernel
 * needs scatter writes, which the WebGL2 backend's transform-feedback compute
 * cannot express, so there the lights are batched into uniform arrays instead:
 * still linear per fragment, but a light appearing or leaving never recompiles
 * a material, which is what streaming a city needs.
 *
 * Neither system folds a batched or clustered light's id into its shader cache
 * key, so the whole city's fixtures can come and go for free. What does carry
 * ids is a per-material `lightsNode`, which is why room lighting is built from
 * a fixed pool (see RoomLights).
 *
 * The system is chosen after `init()`, but `init()` is where three builds the
 * render lists that hand every material its scene lights node, and it builds
 * them around whatever lighting the renderer holds at that moment. So the
 * renderer is given a `LightingSlot` before `init()` (`LightingSystem.prepare`)
 * and the chosen system goes into that slot. Without it the lists keep three's
 * default lighting, which gives every material one light node per city light,
 * each of them updated on every draw.
 */
export class LightingSystem {

	/** Before `renderer.init()`: the slot the system is installed into. */
	static prepare( renderer ) {

		renderer.lighting = new LightingSlot();

		return renderer;

	}

	/** @returns { capacity } how many fixtures may be lit at once */
	static install( renderer, tier ) {

		const webgpu = renderer.backend.isWebGPUBackend === true;
		const system = webgpu
			? new SceneClusteredLighting( tier.clusteredLights, 32, 24, 64 )
			: new MaterialLitDynamicLighting( {
				maxPointLights: tier.batchedLights,
				maxSpotLights: 8,
				maxDirectionalLights: 2,
				maxHemisphereLights: 4
			} );

		if ( renderer.lighting instanceof LightingSlot ) renderer.lighting.use( system );
		else renderer.lighting = system;

		if ( tier.roomStrips > 0 ) installAreaLights();

		return { capacity: webgpu ? tier.clusteredLights : tier.batchedLights };

	}

}

let areaLights = false;

/**
 * Installs the LTC tables every area light shades with, once for the run. A
 * material lit by a `RectAreaLight` cannot compile without them on either
 * backend, and the tiers without room strips never install them for rooms, so
 * whatever lights with one calls this first.
 */
export function installAreaLights() {

	if ( areaLights ) return;
	THREE.RectAreaLightNode.setLTC( RectAreaLightTexturesLib.init() );
	areaLights = true;

}

/**
 * The renderer's lighting from its construction: three's default until a
 * system is installed, that system after. The render lists built at `init()`
 * hold this object, so they reach whatever is installed later.
 */
export class LightingSlot extends THREE.Lighting {

	constructor() {

		super();
		this.system = null;

	}

	use( system ) {

		this.system = system;

		return this;

	}

	createNode( lights = [] ) {

		return this.system ? this.system.createNode( lights ) : super.createNode( lights );

	}

	getNode( scene ) {

		return this.system ? this.system.getNode( scene ) : super.getNode( scene );

	}

}

/**
 * Batched lights that keep what a material lights itself with, their point
 * lights costing a fragment only the lights that reach it (LightReach).
 *
 * Three 0.185.1 hands a material's environment, ambient occlusion and light
 * map to its lights node as `materialLightings`, and its own LightsNode builds
 * them beside the scene's lights. DynamicLightsNode replaces that method with
 * one that builds only the batched lights, so under it every material loses
 * its environment reflections and its occlusion: the street goes darker, and a
 * surface whose occlusion held its light down goes brighter. This builds them
 * again, the nodes the default LightsNode would have built.
 */
class MaterialLitDynamicLightsNode extends DynamicLightsNode {

	static get type() {

		return 'MaterialLitDynamicLightsNode';

	}

	constructor( options ) {

		super( options );
		// Three builds the point lights' data node on first sight of one; this
		// one stands in its place from the start.
		this._dataNodes.set( 'PointLight', new ReachedPointLightDataNode( this.maxPointLights ) );

	}

	setupLightsNode( builder ) {

		return [ ...( builder.context.materialLightings ?? [] ), ...super.setupLightsNode( builder ) ];

	}

}

class MaterialLitDynamicLighting extends DynamicLighting {

	createNode( lights = [] ) {

		return new MaterialLitDynamicLightsNode( this.options ).setLights( lights );

	}

}

/**
 * Clustered lighting with a lights node of its own per scene. Three's Lighting
 * keeps its scene nodes in one map every Lighting shares, so whichever lighting
 * asked for a scene's node first would decide it for all of them.
 */
class SceneClusteredLighting extends ClusteredLighting {

	#nodes = new WeakMap();

	getNode( scene ) {

		if ( scene.isScene !== true && scene.isGroup !== true ) return super.getNode( scene );

		let node = this.#nodes.get( scene );
		if ( node === undefined ) this.#nodes.set( scene, node = this.createNode() );

		return node;

	}

}
