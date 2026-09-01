import { float, positionWorld, select, uniform } from 'three/tsl';

const CEILING_INSET = 0.05; // cut just below the floor's ceiling, meters
const NO_SLICE = 1e6; // cut far above any building: nothing discarded

/**
 * Horizontal slice through the building: every material discards fragments
 * above the chosen floor's ceiling, so that floor reads from above. Driven by
 * the exterior blueprint's floor table (index, elevation, height; basements
 * negative). Fragment-level TSL cut: exact on merged interior meshes and on
 * per-floor shell nodes alike, one shared uniform, no shader rebuilds, and it
 * runs identically on the WebGPU and WebGL2 backends.
 */
export class FloorSlicer {

	constructor( floors ) {

		this.floors = [ ...floors ].sort( ( a, b ) => a.index - b.index );
		this.cut = uniform( NO_SLICE );

	}

	/** Wires the slice cut into a material; call once per material. */
	attach( material ) {

		material.opacityNode = select( positionWorld.y.greaterThan( this.cut ), float( 0 ), float( 1 ) );
		material.alphaTestNode = float( 0.5 );

	}

	/** Options for a select control: full building plus one entry per floor. */
	options() {

		return [
			{ value: 'full', label: 'full building' },
			...this.floors.map( ( f ) => ( {
				value: String( f.index ),
				label: `floor ${f.index}${f.kind ? ` (${f.kind})` : ''}`
			} ) )
		];

	}

	/** @param value 'full' or a floor index as string */
	apply( value ) {

		const floor = this.floors.find( ( f ) => String( f.index ) === value );

		this.cut.value = floor
			? floor.elevation + floor.height - CEILING_INSET
			: NO_SLICE;

	}

}
