import { Color, Group, InstancedMesh, Matrix4 } from 'three/webgpu';
import { cityGltfLoader } from '../../data/CityGltfLoader.js';
import { mapConcurrent } from '../../city/BuildingsLoader.js';
import { KitPieceDraw } from '../../city/kit/KitPieceDraw.js';
import { byteHash } from '../native/NativeStreetChecks.js';
import { streetPieceBoxes } from './StreetPieceBoxes.js';

const LOAD_CONCURRENCY = 8;
const WHITE = new Color( 1, 1, 1 );
const _matrix = new Matrix4();

export const streamError = ( message, cause ) =>
	Object.assign( new Error( `E_NATIVE_STREET_STREAM: ${message}` ), { code: 'E_NATIVE_STREET_STREAM', ...( cause ? { cause } : {} ) } );

/**
 * The city's whole street vocabulary, loaded once.
 *
 * Every piece in `kit.json` is read through the source, checked against the
 * size and hash the kit publishes for it and decoded once. What comes out is
 * one instanced draw per piece primitive for the entire city: admitting a cell
 * writes matrices into draws that already exist, so the draw count follows the
 * kit and not how much street is standing.
 *
 * Decoded geometry is kept exactly as the producer quantized it. The piece's
 * own node transform rides in the instance matrix instead, which is what keeps
 * one copy of every piece in memory however many placements use it.
 */
export class StreetPieces {

	/**
	 * @param kit the manifest's `kit`, already identity-checked with it
	 * @param source the verified street source, for piece bytes
	 * @param materials the native street material factory
	 */
	constructor( { kit, source, materials, loader = cityGltfLoader() } ) {

		this.kit = kit;
		this.source = source;
		this.materials = materials;
		this.loader = loader;
		this.pieces = new Map();
		this.abort = new AbortController();
		this.group = new Group();
		this.group.name = 'street-pieces';
		// One mesh per distinct surface, for the renderer to compile against.
		// Warming every draw would compile the same 28 programs 1,178 times.
		this.warmGroup = new Group();
		this.warmGroup.name = 'street-pieces:warm';
		this.ready = this.#load();

	}

	/** One draw per piece primitive, for the whole city. */
	get drawCount() {

		let total = 0;
		for ( const piece of this.pieces.values() ) for ( const part of piece.parts ) total += part.draw.meshes.length;
		return total;

	}

	/** How many copies of every piece are standing. */
	get instanceCount() {

		let total = 0;
		for ( const piece of this.pieces.values() ) for ( const part of piece.parts ) total += part.draw.count;
		return total;

	}

	/** This piece's cuboids, in piece coordinates; empty when it does not collide. */
	boxesOf( pieceId ) {

		return this.pieces.get( pieceId )?.boxes ?? [];

	}

	/**
	 * Draws one more copy of a piece.
	 * @param handles the caller's release list, appended in place
	 */
	admit( placement, world, handles ) {

		const piece = this.pieces.get( placement.piece );
		if ( ! piece ) throw streamError( `no piece ${placement.piece} in this kit` );

		for ( const part of piece.parts ) {

			handles.push( part.draw.add( _matrix.multiplyMatrices( world, part.base ), WHITE, { slot: - 1 } ) );
			// A draw that outgrows its buffers builds new meshes for them.
			if ( part.meshes !== part.draw.meshes ) shadows( part );

		}

	}

	release( handle ) {

		handle.draw.remove( handle );

	}

	dispose() {

		this.abort.abort();
		for ( const piece of this.pieces.values() ) {

			for ( const part of piece.parts ) part.draw.dispose();
			for ( const geometry of piece.geometries ) geometry.dispose();

		}
		this.pieces.clear();
		for ( const mesh of this.warmGroup.children ) mesh.dispose();
		this.warmGroup.clear();
		this.group.clear();
		this.group.removeFromParent();

	}

	async #load() {

		const loaded = await mapConcurrent( this.kit.pieces, LOAD_CONCURRENCY, entry => this.#piece( entry ) );
		const warmed = new Set();

		for ( const piece of loaded ) {

			this.pieces.set( piece.id, piece );
			for ( const part of piece.parts ) {

				this.group.add( part.draw.group );
				shadows( part );
				for ( const [ index, mesh ] of part.draw.meshes.entries() ) {

					const surface = part.surfaces[ index ].bucket;
					if ( warmed.has( surface ) ) continue;
					warmed.add( surface );
					this.warmGroup.add( warmMesh( mesh ) );

				}

			}

		}

		return this;

	}

	async #piece( entry ) {

		const bytes = await this.source.readPiece( entry.id, this.abort.signal );
		if ( bytes.byteLength !== entry.bytes ) throw streamError( `${entry.id}: ${bytes.byteLength} bytes, the kit publishes ${entry.bytes}` );
		if ( await byteHash( bytes ) !== entry.sha256 ) throw streamError( `${entry.id}: byte hash mismatch` );

		const { scene } = await this.loader.parseAsync( bytes, '' );
		scene.updateMatrixWorld( true );
		const parts = new Map(), geometries = [], resources = new Set(), originals = new Set();
		const triangles = [];
		let count = 0;

		try {

			scene.traverse( mesh => {

				if ( ! mesh.isMesh ) return;
				const surfaceId = mesh.material?.userData?.streetNativeSurface;
				const collides = mesh.geometry.userData.streetCollision;
				if ( ! entry.surfaces.includes( surfaceId ) || typeof collides !== 'boolean' ) {

					throw streamError( `${entry.id}: missing native surface or collision authority` );

				}
				originals.add( mesh.material );
				const material = this.materials.build( surfaceId );
				this.materials.assertGeometry( material, mesh.geometry );
				for ( const resource of this.materials.resources( material ) ) resources.add( resource.ready );

				const indices = mesh.geometry.index?.count ?? mesh.geometry.getAttribute( 'position' ).count;
				if ( indices % 3 ) throw streamError( `${entry.id}: incomplete triangles` );
				count += indices / 3;
				geometries.push( mesh.geometry );
				if ( collides && entry.hasCollision ) pieceTriangles( mesh, triangles );

				const key = mesh.matrixWorld.elements.join( ',' );
				if ( ! parts.has( key ) ) parts.set( key, { base: mesh.matrixWorld.clone(), surfaces: [] } );
				parts.get( key ).surfaces.push( { bucket: surfaceId, geometry: mesh.geometry, material, collides } );

			} );

			if ( count !== entry.triangles ) throw streamError( `${entry.id}: ${count} triangles, the kit publishes ${entry.triangles}` );
			await Promise.all( resources );
			if ( this.abort.signal.aborted ) throw streamError( `${entry.id}: cancelled` );

		} catch ( error ) {

			for ( const geometry of geometries ) geometry.dispose();
			throw error;

		} finally {

			for ( const material of originals ) material.dispose();

		}

		return {
			id: entry.id,
			geometries,
			parts: [ ...parts.values() ].map( part => ( {
				base: part.base, surfaces: part.surfaces, draw: new KitPieceDraw( `street:${entry.id}`, part.surfaces )
			} ) ),
			boxes: entry.hasCollision ? streetPieceBoxes( triangles, entry.bounds ) : []
		};

	}

}

/** Paint and scans lie flat on the road; only bodies cast shadows. */
function shadows( part ) {

	part.meshes = part.draw.meshes;
	for ( const [ index, mesh ] of part.meshes.entries() ) mesh.castShadow = part.surfaces[ index ].collides;

}

/** Piece-local vertices of one mesh, appended nine numbers per triangle. */
function pieceTriangles( mesh, out ) {

	const position = mesh.geometry.getAttribute( 'position' ), index = mesh.geometry.index;
	const matrix = mesh.matrixWorld.elements;

	for ( let i = 0; i < ( index?.count ?? position.count ); i ++ ) {

		const at = index ? index.getX( i ) : i;
		const x = position.getX( at ), y = position.getY( at ), z = position.getZ( at );
		out.push(
			matrix[ 0 ] * x + matrix[ 4 ] * y + matrix[ 8 ] * z + matrix[ 12 ],
			matrix[ 1 ] * x + matrix[ 5 ] * y + matrix[ 9 ] * z + matrix[ 13 ],
			matrix[ 2 ] * x + matrix[ 6 ] * y + matrix[ 10 ] * z + matrix[ 14 ]
		);

	}

}

/** The same geometry, material and instance buffers the real draw uses. */
function warmMesh( mesh ) {

	const warm = new InstancedMesh( mesh.geometry, mesh.material, 0 );
	warm.name = `${mesh.name}:warm`;
	warm.instanceMatrix = mesh.instanceMatrix;
	warm.instanceColor = mesh.instanceColor;
	warm.castShadow = mesh.castShadow;
	warm.receiveShadow = true;
	warm.frustumCulled = false;

	return warm;

}
