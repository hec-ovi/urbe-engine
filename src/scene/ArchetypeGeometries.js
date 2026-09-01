import * as THREE from 'three/webgpu';
import { MeshoptSimplifier } from 'meshoptimizer';
import { ARCHETYPES } from '../city/archetypes.js';

// Index-only LOD chains over one shared vertex array, per docs/RESEARCH.md 1.
const LOD_RATIOS = [ 1, 0.3, 0.1 ];

export const LOD_COUNT = LOD_RATIOS.length;

/**
 * Builds, per archetype, a unit box shell (1x1x1, base at y=0) and its meshopt
 * LOD index chains. Variants assemble their own geometries from this data.
 */
export class ArchetypeGeometries {

	/**
	 * @returns {Promise<Array<{ def: object, lod0: THREE.BufferGeometry,
	 *   position: THREE.BufferAttribute, normal: THREE.BufferAttribute,
	 *   lodIndices: Uint32Array[] }>>}
	 */
	static async build() {

		await MeshoptSimplifier.ready;

		return ARCHETYPES.map( ( def ) => {

			const box = new THREE.BoxGeometry( 1, 1, 1, ...def.segments );
			box.translate( 0, 0.5, 0 );
			box.deleteAttribute( 'uv' );
			box.clearGroups();

			const position = box.getAttribute( 'position' );
			const normal = box.getAttribute( 'normal' );
			const fullIndex = new Uint32Array( box.getIndex().array );

			const lodIndices = LOD_RATIOS.map( ( ratio, level ) => {

				if ( level === 0 ) return fullIndex;

				const target = Math.max( 3, Math.floor( ( fullIndex.length * ratio ) / 3 ) * 3 );
				const [ simplified ] = MeshoptSimplifier.simplify(
					fullIndex, position.array, 3, target, 0.01, [ 'LockBorder' ]
				);
				return simplified;

			} );

			return { def, lod0: box, position, normal, lodIndices };

		} );

	}

}
