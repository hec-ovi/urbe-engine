import { LightingNode } from 'three/webgpu';
import { drawIndex, instanceIndex, int, ivec2, mix, normalWorld, textureLoad, textureSize, varying } from 'three/tsl';

/** A draw standing in rooms publishes its per-copy fill here (city/kit/FillChannel.js). */
const CHANNEL = Symbol.for( 'urbe.fill-channel' );

/**
 * The light a room returns to its own surfaces, read per copy.
 *
 * Every module and furniture draw in the city is lit through one lights node,
 * so a fill light in that node would reach every room at once and a sales
 * floor's bounce would light the toilets next door. Instead each copy carries
 * the fill of the room it stands in: irradiance in lux and the floor's own
 * reflectance, the same two numbers a hemisphere light was fed per room. A
 * surface facing up takes the fill, one facing down takes it bounced off the
 * floor once more, which is the gradient up a wall that reads as bounce.
 *
 * The copy's texel is looked up in the vertex stage, where the instance id
 * lives, the way a batch reads its own matrix. A mesh with no channel, such as
 * a lift car standing on its own, adds nothing.
 */
export class RoomFillNode extends LightingNode {

	static get type() {

		return 'RoomFillNode';

	}

	setup( builder ) {

		const mesh = builder.object;
		const channel = mesh[ CHANNEL ];
		if ( ! channel ) return;

		const fill = roomFillValue( mesh, builder );

		const sky = fill.xyz;
		const ground = sky.mul( fill.w );
		const weight = normalWorld.y.mul( 0.5 ).add( 0.5 );

		builder.context.irradiance.addAssign( mix( ground, sky, weight ) );

	}

}

/** Instanced crowds use their slot; a focused rig shares texel zero across its meshes. */
export function roomFillValue( mesh, builder ) {

	const channel = mesh[ CHANNEL ];
	if ( ! channel ) return null;
	const instanced = mesh.isInstancedMesh || mesh.geometry?.isInstancedBufferGeometry;
	const drawn = mesh.isBatchedMesh && builder.getDrawIndex() !== null ? drawIndex : instanced ? instanceIndex : int( 0 );
	const id = mesh.isBatchedMesh ? texel( mesh._indirectTexture, drawn ).x : drawn;
	return varying( texel( channel.texture, id ) );

}

/** One texel per id, in the square layout a batch keeps its per-copy data in. */
function texel( texture, id ) {

	const size = int( textureSize( textureLoad( texture ), 0 ).x );
	const index = int( id );

	return textureLoad( texture, ivec2( index.mod( size ), index.div( size ) ) );

}
