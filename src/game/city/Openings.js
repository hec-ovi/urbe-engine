import * as THREE from 'three/webgpu';
import { signedArea } from '../ground/Polygons.js';

/**
 * Exterior blueprint openings placed in the world. A floor gives a world-space
 * outline ring; an opening gives an edge index, an offset along it, a width, a
 * sill and a height. That is enough to put a rectangle exactly in the wall,
 * which is what both the entrance door and the lit windows need.
 */
export function openingRect( floor, opening ) {

	const ring = floor.outline;
	const a = ring[ opening.edge ];
	const b = ring[ ( opening.edge + 1 ) % ring.length ];

	if ( ! a || ! b ) return null;

	const dx = b[ 0 ] - a[ 0 ];
	const dz = b[ 1 ] - a[ 1 ];
	const length = Math.hypot( dx, dz );

	if ( length < 1e-6 ) return null;

	const ux = dx / length;
	const uz = dz / length;
	const outward = signedArea( ring ) > 0 ? 1 : - 1;
	const y0 = floor.elevation + ( opening.sill ?? 0 );

	return {
		start: new THREE.Vector3( a[ 0 ] + ux * opening.offset, y0, a[ 1 ] + uz * opening.offset ),
		end: new THREE.Vector3(
			a[ 0 ] + ux * ( opening.offset + opening.width ),
			y0,
			a[ 1 ] + uz * ( opening.offset + opening.width )
		),
		normal: new THREE.Vector3( uz * outward, 0, - ux * outward ),
		y0,
		y1: y0 + opening.height,
		width: opening.width,
		height: opening.height
	};

}
