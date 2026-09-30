import * as THREE from 'three/webgpu';
import { skinRows } from './VatSkin.js';

export const FRAMES = 32;

/**
 * Where each clip's rows sit in a bake: `{ start, frames, once }` per clip, in
 * order. A loop's rows sample its first `frames` steps, the next being its
 * first again; a clip played `once` samples its whole length, its last row
 * its final pose. Without a layout every clip is a FRAMES-row loop.
 *
 * @param layout `[{ frames?, once? }]` per clip, or null
 */
export function clipRows( count, layout = null ) {

	let start = 0;
	return Array.from( { length: count }, ( _, index ) => {

		const frames = layout?.[ index ]?.frames ?? FRAMES;
		const rows = { start, frames, once: Boolean( layout?.[ index ]?.once ) };
		start += frames;
		return rows;

	} );

}

/**
 * The two rows a pose buffer blends for a clip at `frame` (0 to FRAMES, how
 * far through the clip, whatever its row count) and how far between them:
 * written into `out` as `[ first row + blend, second row ]`.
 */
export function rowsAt( rows, frame, out ) {

	const { start, frames, once } = rows;
	let at = frame / FRAMES;
	if ( once ) {

		at = Math.min( Math.max( at, 0 ), 1 ) * ( frames - 1 );
		const whole = Math.min( Math.floor( at ), frames - 1 );
		out[ 0 ] = start + at;
		out[ 1 ] = start + Math.min( whole + 1, frames - 1 );

	} else {

		at = ( ( at % 1 ) + 1 ) % 1 * frames;
		const whole = Math.floor( at );
		out[ 0 ] = start + at;
		out[ 1 ] = start + ( whole + 1 ) % frames;

	}
	return out;

}

/**
 * Bakes a skinned mesh's animation clips into vertex animation buffers: one
 * row per frame, one vec4 per vertex, positions in one buffer and normals in
 * the other. Each clip is a run of rows (`clipRows`), as many as its layout
 * gives it, so a clip is a row offset and a row count.
 *
 * This is what lets the whole crowd render as a single instanced draw with no
 * skeletons and no per-character CPU work at all. Baking happens once at load:
 * the skeleton is posed for each row and its bone matrices kept, and every
 * vertex is skinned against them on plain arrays (VatSkin.js), the arithmetic
 * three's own skinning does without an object per vertex, which makes a body
 * a fraction of a second. It runs a frame row at a time and asks the frame
 * budget between rows.
 */
export class VatBaker {

	/**
	 * @param root the loaded character scene (holds the skeleton)
	 * @param meshes SkinnedMesh list to bake, all sharing that skeleton
	 * @param clips AnimationClip list, baked in order
	 * @param slice the frame budget asked between rows, or null to run whole
	 * @param layout each clip's rows and whether it plays once (`clipRows`)
	 * @returns per mesh `{ mesh, vertexCount, rows, position, normal, clips }`, `clips` the `clipRows`
	 */
	static async bake( root, meshes, clips, slice = null, layout = null ) {

		const mixer = new THREE.AnimationMixer( root );
		const actions = clips.map( ( clip ) => mixer.clipAction( clip ) );
		const runs = clipRows( clips.length, layout );
		const rows = runs.reduce( ( sum, run ) => sum + run.frames, 0 );

		const targets = meshes.map( ( mesh ) => {

			const count = mesh.geometry.getAttribute( 'position' ).count;
			const source = morphed( mesh ) ? null : skinSource( mesh );

			return {
				mesh,
				count,
				source,
				palette: source ? new Float64Array( source.bones * 16 ) : null,
				position: new Float32Array( count * rows * 4 ),
				normal: new Float32Array( count * rows * 4 )
			};

		} );

		for ( let c = 0; c < clips.length; c ++ ) {

			actions.forEach( ( a ) => a.stop() );
			play( actions[ c ], runs[ c ] );

			for ( let f = 0; f < runs[ c ].frames; f ++ ) {

				mixer.setTime( sampleTime( runs[ c ], f, clips[ c ].duration ) );
				root.updateMatrixWorld( true );

				const row = runs[ c ].start + f;

				if ( slice ) await slice.step();

				for ( const target of targets ) {

					if ( ! target.source ) {

						skinMorphed( target, row );
						continue;

					}
					pose( target.mesh, target.palette );
					skinRow( target, row );

				}

			}

		}

		mixer.stopAllAction();

		return targets.map( ( target ) => ( {
			mesh: target.mesh,
			vertexCount: target.count,
			rows,
			position: target.position,
			normal: target.normal,
			clips: runs
		} ) );

	}


	/**
	 * One joint's transform in the same frames the bake poses a body in, as the
	 * top three rows of the matrix that carries the joint's rest space into the
	 * mesh's: what a part riding only on that joint needs instead of a row per
	 * vertex. Rows are laid out as a pose buffer of three "vertices" per frame.
	 *
	 * @param mesh the skinned mesh whose space the rows carry into
	 * @param layout each clip's rows, as `bake` takes it
	 * @returns `{ rows, data, clips }`, data a Float32Array of rows * 3 vec4s, clips the `clipRows`
	 */
	static async bakeJoint( root, mesh, name, clips, slice = null, layout = null ) {

		const bone = mesh.skeleton.bones.find( ( entry ) => entry.name === name );
		if ( ! bone ) throw new Error( `the rig has no ${name} to bake` );
		const mixer = new THREE.AnimationMixer( root );
		const actions = clips.map( ( clip ) => mixer.clipAction( clip ) );
		const runs = clipRows( clips.length, layout );
		const rows = runs.reduce( ( sum, run ) => sum + run.frames, 0 );
		const data = new Float32Array( rows * 12 );
		const carry = new THREE.Matrix4();

		for ( let c = 0; c < clips.length; c ++ ) {

			actions.forEach( ( a ) => a.stop() );
			play( actions[ c ], runs[ c ] );

			for ( let f = 0; f < runs[ c ].frames; f ++ ) {

				mixer.setTime( sampleTime( runs[ c ], f, clips[ c ].duration ) );
				root.updateMatrixWorld( true );
				if ( slice ) await slice.step();
				// Into the mesh's bind space, as getVertexPosition puts a skinned vertex.
				carry.multiplyMatrices( mesh.bindMatrixInverse, bone.matrixWorld );
				const e = carry.elements;
				const row = ( runs[ c ].start + f ) * 12;
				for ( let r = 0; r < 3; r ++ ) data.set( [ e[ r ], e[ 4 + r ], e[ 8 + r ], e[ 12 + r ] ], row + r * 4 );

			}

		}

		mixer.stopAllAction();
		return { rows, data, clips: runs };

	}

}

/** Starts a clip for baking: a loop repeats, a clip played once holds its final pose at its end. */
function play( action, run ) {

	action.reset();
	action.setLoop( run.once ? THREE.LoopOnce : THREE.LoopRepeat, run.once ? 1 : Infinity );
	action.clampWhenFinished = run.once;
	action.play();

}

/** The clip time a row samples: a loop's rows stop a step short of its end, which is its start. */
function sampleTime( run, frame, duration ) {

	return run.once ? ( frame / Math.max( 1, run.frames - 1 ) ) * duration : ( frame / run.frames ) * duration;

}

/** A mesh whose shape keys move it; three's own per-vertex read then does the skinning. */
function morphed( mesh ) {

	return Boolean( mesh.geometry.morphAttributes.position?.length && mesh.morphTargetInfluences );

}

/**
 * What skinning reads off the geometry, once: each vertex's position in the
 * bind space (`bind · p`), its authored normal turned by `bind`'s 3×3, its four
 * joints and weights, and the bind matrix inverse.
 */
function skinSource( mesh ) {

	const geometry = mesh.geometry;
	const position = geometry.getAttribute( 'position' );
	const normal = geometry.getAttribute( 'normal' );
	const joints = geometry.getAttribute( 'skinIndex' );
	const weights = geometry.getAttribute( 'skinWeight' );
	const count = position.count;
	const bind = mesh.bindMatrix.elements;
	const source = {
		count,
		bones: mesh.skeleton.bones.length,
		base: new Float64Array( count * 3 ),
		nb: new Float64Array( count * 3 ),
		joints: new Uint16Array( count * 4 ),
		weights: new Float64Array( count * 4 ),
		unbind: Float64Array.from( mesh.bindMatrixInverse.elements )
	};
	const point = new THREE.Vector3();

	for ( let i = 0; i < count; i ++ ) {

		point.fromBufferAttribute( position, i ).applyMatrix4( mesh.bindMatrix );
		point.toArray( source.base, i * 3 );
		const x = normal.getX( i ), y = normal.getY( i ), z = normal.getZ( i );
		source.nb[ i * 3 ] = bind[ 0 ] * x + bind[ 4 ] * y + bind[ 8 ] * z;
		source.nb[ i * 3 + 1 ] = bind[ 1 ] * x + bind[ 5 ] * y + bind[ 9 ] * z;
		source.nb[ i * 3 + 2 ] = bind[ 2 ] * x + bind[ 6 ] * y + bind[ 10 ] * z;
		source.joints.set( [ joints.getX( i ), joints.getY( i ), joints.getZ( i ), joints.getW( i ) ], i * 4 );
		source.weights.set( [ weights.getX( i ), weights.getY( i ), weights.getZ( i ), weights.getW( i ) ], i * 4 );

	}

	return source;

}

const bone = new THREE.Matrix4();

/** The pose's bone matrices, as three's own skinning multiplies them. */
function pose( mesh, palette ) {

	const { bones, boneInverses } = mesh.skeleton;

	for ( let b = 0; b < bones.length; b ++ ) {

		if ( bones[ b ] ) bone.multiplyMatrices( bones[ b ].matrixWorld, boneInverses[ b ] );
		else bone.identity();
		bone.toArray( palette, b * 16 );

	}

}

function skinRow( target, row ) {

	const out = target.count * 4;

	skinRows(
		target.source, target.palette, 1,
		target.position.subarray( row * out, ( row + 1 ) * out ), target.normal.subarray( row * out, ( row + 1 ) * out )
	);

}

const vertex = new THREE.Vector3();
const normal = new THREE.Vector3();
const skin = new THREE.Matrix4();
const boundSkin = new THREE.Matrix4();

/** One row of a shape-keyed mesh, read through three with its keys where the pose left them. */
function skinMorphed( target, row ) {

	const mesh = target.mesh;
	mesh.skeleton.update();
	const stride = row * target.count * 4;

	for ( let i = 0; i < target.count; i ++ ) {

		mesh.getVertexPosition( i, vertex );
		vertex.toArray( target.position, stride + i * 4 );
		skinNormal( mesh, i, normal );
		normal.toArray( target.normal, stride + i * 4 );

	}

}

/** The renderer's linear-blend skin transform applied to one authored normal. */
function skinNormal( mesh, index, target ) {

	const geometry = mesh.geometry;
	const joints = geometry.getAttribute( 'skinIndex' );
	const weights = geometry.getAttribute( 'skinWeight' );
	const boneMatrices = mesh.skeleton.boneMatrices;
	const elements = skin.elements;
	elements.fill( 0 );

	for ( let slot = 0; slot < 4; slot ++ ) {

		const weight = weights.getComponent( index, slot );
		const offset = joints.getComponent( index, slot ) * 16;

		for ( let element = 0; element < 16; element ++ ) {

			elements[ element ] += boneMatrices[ offset + element ] * weight;

		}

	}

	boundSkin.multiplyMatrices( mesh.bindMatrixInverse, skin ).multiply( mesh.bindMatrix );
	target.fromBufferAttribute( geometry.getAttribute( 'normal' ), index ).transformDirection( boundSkin );

}
