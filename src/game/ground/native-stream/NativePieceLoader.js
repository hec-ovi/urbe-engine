import { Box3, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const streamError = message => Object.assign( new Error( message ), { code: 'E_NATIVE_STREET_STREAM' } );

/** Decodes producer geometry, replacing only its declared material references. */
export class NativePieceLoader {

	constructor( source, materials ) {
		this.source = source;
		this.materials = materials;
		this.loader = new GLTFLoader();
	}

	async load( piece, signal ) {
		const bytes = await this.source.readPiece( piece.id, signal );
		const { scene } = await this.loader.parseAsync( bytes, '' );
		const originals = new Set(), resources = new Set(), surfaces = new Set();
		let triangles = 0, collision = false;
		try {
			scene.traverse( mesh => {
				if ( ! mesh.isMesh ) return;
				if ( Array.isArray( mesh.material ) ) throw streamError( `${piece.id}: expected one native surface per mesh` );
				originals.add( mesh.material );
				const id = mesh.material.userData.streetNativeSurface;
				if ( ! piece.surfaceIds.includes( id ) || typeof mesh.userData.streetCollision !== 'boolean' ) {
					throw streamError( `${piece.id}: missing native surface or collision authority` );
				}
				const material = this.materials.build( id );
				this.materials.assertGeometry( material, mesh.geometry );
				const count = mesh.geometry.index?.count ?? mesh.geometry.getAttribute( 'position' ).count;
				if ( count % 3 ) throw streamError( `${piece.id}: incomplete triangles` );
				triangles += count / 3;
				collision ||= mesh.userData.streetCollision;
				surfaces.add( id );
				mesh.material = material;
				mesh.castShadow = mesh.userData.streetCollision;
				mesh.receiveShadow = true;
				for ( const resource of this.materials.resources( material ) ) resources.add( resource.ready );
			} );
			if ( triangles !== piece.triangles || collision !== piece.hasCollision || surfaces.size !== piece.surfaceIds.length ) {
				throw streamError( `${piece.id}: geometry differs from manifest` );
			}
			const actual = new Box3().setFromObject( scene, true );
			const min = new Vector3().fromArray( piece.bounds.min ), max = new Vector3().fromArray( piece.bounds.max );
			const precision = Math.max( 0.0001, ...piece.bounds.min.map( Math.abs ), ...piece.bounds.max.map( Math.abs ) ) * 1e-6 + 0.0001;
			if ( actual.isEmpty() || ! [ ...actual.min.toArray(), ...actual.max.toArray() ].every( Number.isFinite )
				|| actual.min.distanceTo( min ) > precision || actual.max.distanceTo( max ) > precision ) {
				throw streamError( `${piece.id}: decoded bounds differ from manifest` );
			}
			await Promise.all( resources );
			if ( signal?.aborted ) throw streamError( `${piece.id}: cancelled` );
			scene.name = `native-street:${piece.id}`;
			return scene;
		} catch ( error ) {
			releaseNativePiece( scene );
			throw error;
		} finally {
			for ( const material of originals ) material.dispose();
		}
	}
}

export function releaseNativePiece( group ) {
	const geometries = new Set();
	group.removeFromParent();
	group.traverse( mesh => { if ( mesh.geometry ) geometries.add( mesh.geometry ); } );
	for ( const geometry of geometries ) geometry.dispose();
}
