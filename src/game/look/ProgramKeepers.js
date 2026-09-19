import { BatchedMesh, BufferAttribute, BufferGeometry, Color, InstancedMesh, SkinnedMesh, Sprite } from 'three/webgpu';
import { codeKey } from './ProgramKey.js';

const WHITE = new Color( 1, 1, 1 );

/**
 * One small renderable per program, wearing a copy of its material, kept for
 * the life of the warm-up so the program is never dropped.
 *
 * The renderer counts the draws that use a program and frees it with the last
 * of them. A batch that grows disposes its material to be rebuilt against its
 * new buffers, a floor that leaves takes its materials with it, and either is
 * the last user of a program: the next draw that wants it compiles it again,
 * on the frame that wanted it. A keeper is a user that never leaves. Its
 * material is a copy, so the world's own disposals never reach it, and it
 * compiles to the same code, so the program it holds is the one the world's
 * draws find.
 */
export class ProgramKeepers {

	constructor() {

		this.keepers = new Map();

	}

	get size() {

		return this.keepers.size;

	}

	/**
	 * @param node a renderable whose program has just been built
	 * @returns the keeper made for that program's code, to prepare like any
	 *   renderable, or null when one already stands or none can be made
	 */
	keep( node ) {

		const key = codeKey( node );
		if ( this.keepers.has( key ) ) return null;

		let keeper = null;
		try {

			keeper = keeperOf( node );

		} catch ( error ) {

			console.warn( `warmup: no keeper for ${node.name || node.type}: ${error?.message ?? error}` );
			return null;

		}
		this.keepers.set( key, keeper );

		return keeper;

	}

}

function keeperOf( node ) {

	const material = Array.isArray( node.material ) ? node.material.map( clone ) : clone( node.material );
	let keeper;

	if ( node.isBatchedMesh ) {

		const indexed = Boolean( node.geometry.getIndex() );
		keeper = new BatchedMesh( 1, 3, indexed ? 3 : 0, material );
		const instance = keeper.addInstance( keeper.addGeometry( triangleLike( node.geometry, indexed ) ) );
		if ( node._colorsTexture ) keeper.setColorAt( instance, WHITE );

	} else if ( node.isInstancedMesh ) {

		keeper = new InstancedMesh( node.geometry, material, 1 );
		if ( node.instanceColor ) keeper.setColorAt( 0, WHITE );

	} else if ( node.isSkinnedMesh ) {

		keeper = new SkinnedMesh( node.geometry, material );
		keeper.bind( node.skeleton, node.bindMatrix );

	} else if ( node.isSprite ) {

		keeper = new Sprite( material );

	} else {

		keeper = new node.constructor( node.geometry, material );

	}

	keeper.name = `keeper:${node.name || node.type}`;
	keeper.castShadow = node.castShadow;
	keeper.receiveShadow = node.receiveShadow;
	keeper.frustumCulled = false;

	return keeper;

}

function clone( material ) {

	return material.clone();

}

/** One triangle in the same vertex layout, which is all a batch's program reads. */
function triangleLike( geometry, indexed ) {

	const triangle = new BufferGeometry();

	for ( const [ name, attribute ] of Object.entries( geometry.attributes ) ) {

		triangle.setAttribute( name, new BufferAttribute(
			new attribute.array.constructor( 3 * attribute.itemSize ), attribute.itemSize, attribute.normalized
		) );

	}
	if ( indexed ) triangle.setIndex( [ 0, 1, 2 ] );

	return triangle;

}
