import * as THREE from 'three/webgpu';
import { lights, NodeUpdateType, objectGroup, uniform } from 'three/tsl';
import { kelvinColor } from '../light/Color.js';
import { installAreaLights } from '../light/LightingSystem.js';

/** A drawn car or landing surface names the shaft whose lens lights it here. */
export const CAB = Symbol.for( 'urbe.lift-cab' );
/** Map decode promises ride on a symbol, which a material copy does not carry over. */
const RESOURCES = Symbol.for( 'urbe.material-resources' );
export const CAB_KELVIN = 3800;
/** The bounce a car's walls take from its own floor and ceiling. */
const BOUNCE_GROUND = 0x77716a;
const BOUNCE_LEVEL = 22;

/**
 * The light every lift car is lit by, one set for all of them.
 *
 * A car's surfaces are lit by the lens in its own ceiling and a bounce, and
 * nothing else of the city. A lights node of the car's own does that, but three
 * folds each light's id into the key of every graph that wears it, so a car
 * with lights of its own builds a graph per surface that no other car can use:
 * nine a car, seventy-two for a tower of eight shafts, in the one frame the
 * tower's cars first come into view, and all of it again whenever the tower is
 * let go and opened. The landing leaves, which the car's lens also lights,
 * were the same once per shaft.
 *
 * So there is one lens for every car, and its place is read per draw: the
 * position, the size and the output of the lens hang on the shaft (`lens`), a
 * drawn surface names its shaft through `CAB`, and the lens light reads them
 * off the object being drawn, the way the renderer reads a mesh's own matrix.
 * Every car surface wears one shared material per source, every landing leaf
 * too, so each is one graph for the whole run, prepared with the load and
 * pinned. A surface that names no shaft is lit by no lens.
 *
 * The bounce is a hemisphere of the lens colour over the car's floor, the
 * same for every car, so it stays a plain light: the lens colour on what faces
 * up, a warm grey on what faces down.
 */
export class CabLights {

	constructor() {

		// An area light shades with LTC tables, which the lower tiers never
		// install for their rooms, so the cars make sure of them themselves.
		installAreaLights();
		this.lens = new CabLensNode();
		this.bounce = new THREE.HemisphereLight( kelvinColor( CAB_KELVIN ), BOUNCE_GROUND, BOUNCE_LEVEL );
		// Kept outside the scene's lights: only the cars wear it, and its
		// direction is where it stands, straight up from the world's origin.
		this.bounce.updateMatrixWorld( true );
		/** The lights a car's surfaces wear, and only those. */
		this.carLights = lights( [ this.lens, this.bounce ] );
		this.cars = new Map();
		this.landings = new Map();
		/** The display's segments: one unlit material and the two strokes, for every car. */
		this.display = {
			material: new THREE.MeshBasicMaterial( { color: 0x08202a, toneMapped: false } ),
			across: new THREE.BoxGeometry( .026, .004, .003 ),
			upright: new THREE.BoxGeometry( .004, .026, .003 )
		};

	}

	/** The material a car surface wears: its source lit by the lens and the bounce alone, or the source itself where it is unlit. */
	car( material ) {

		if ( ! lit( material ) ) return material;
		if ( ! this.cars.has( material ) ) this.cars.set( material, copy( material, this.carLights ) );

		return this.cars.get( material );

	}

	/** The material a landing leaf wears: its source's own lights and the car's lens with them. */
	landing( material ) {

		if ( ! lit( material ) ) return material;
		if ( ! this.landings.has( material ) ) {

			this.landings.set( material, copy( material, lights( [ ...( material.lightsNode?.getLights() ?? [] ), this.lens ] ) ) );

		}

		return this.landings.get( material );

	}

}

/**
 * A lift car's lens, read per draw.
 *
 * Three's rect area light takes its place, its size and its output from one
 * light object once per render. Here those are uniforms of the object group,
 * written for each drawn surface from the lens of the shaft it names, so every
 * car and landing shares the graph and is lit by its own car's ceiling.
 */
class CabLensNode extends THREE.RectAreaLightNode {

	static get type() {

		return 'CabLensNode';

	}

	constructor() {

		super( new THREE.RectAreaLight() );
		// Nothing is read off the light object per render: every value is the drawn surface's.
		this.updateType = NodeUpdateType.NONE;
		this.colorNode = uniform( new THREE.Color() ).setGroup( objectGroup )
			.onObjectUpdate( ( { object }, self ) => {

				self.value.copy( lensOf( object ).color );

			} );
		this.viewPosition = uniform( new THREE.Vector3() ).setGroup( objectGroup )
			.onObjectUpdate( ( { object, camera }, self ) => {

				self.value.copy( lensOf( object ).position ).applyMatrix4( camera.matrixWorldInverse );

			} );
		this.halfWidth = uniform( new THREE.Vector3() ).setGroup( objectGroup )
			.onObjectUpdate( ( { object, camera }, self ) => {

				const lens = lensOf( object );
				halfAxis( self.value, _across, lens.quaternion, lens.width, camera );

			} );
		this.halfHeight = uniform( new THREE.Vector3() ).setGroup( objectGroup )
			.onObjectUpdate( ( { object, camera }, self ) => {

				const lens = lensOf( object );
				halfAxis( self.value, _along, lens.quaternion, lens.height, camera );

			} );

	}

	update() {}

	setupDirectRectArea( builder ) {

		return { ...super.setupDirectRectArea( builder ), lightPosition: this.viewPosition };

	}

}

/**
 * A shaft's lens as the light reads it: where it hangs, which way it faces,
 * its size and its output. Dark until the shaft's car has stood.
 */
export function cabLens() {

	return {
		position: new THREE.Vector3(),
		quaternion: new THREE.Quaternion(),
		width: 1,
		height: 1,
		color: new THREE.Color( 0, 0, 0 )
	};

}

const DARK = cabLens();

function lensOf( object ) {

	return object?.[ CAB ]?.lens ?? DARK;

}

/** Half of one side of the lens, in the camera's frame, as three's rect light writes it. */
function halfAxis( target, axis, quaternion, length, camera ) {

	return target.copy( axis ).applyQuaternion( quaternion ).transformDirection( camera.matrixWorldInverse ).multiplyScalar( length / 2 );

}

function lit( material ) {

	return material?.isNodeMaterial === true && ! material.isMeshBasicNodeMaterial;

}

function copy( material, lightsNode ) {

	const own = material.clone();
	// Three's NodeMaterial.copy does not copy inherited material accessors or
	// symbol-keyed properties, and a warm-up reads a map's readiness off the latter.
	own.alphaTest = material.alphaTest;
	if ( material[ RESOURCES ] ) own[ RESOURCES ] = material[ RESOURCES ];
	own.name = `${material.name || material.type}|cab`;
	own.lightsNode = lightsNode;

	return own;

}

const _across = new THREE.Vector3( 1, 0, 0 );
const _along = new THREE.Vector3( 0, 1, 0 );
