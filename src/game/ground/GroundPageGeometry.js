import * as THREE from 'three/webgpu';

import { frameYield } from '../../app/FrameYield.js';

/** Exact indexed world geometry, expanded cooperatively into ordinary material meshes. */
export async function groundPageGeometry( tiles, wanted ) {

	const materials = new Map();
	for ( const tile of tiles.values() ) {

		tile.group.updateMatrixWorld( true );
		tile.group.traverse( mesh => {

			if ( ! mesh.isMesh || ! mesh.geometry.getAttribute( 'position' ).count ) return;
			const key = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}`;
			if ( ! materials.has( key ) ) materials.set( key, { source: mesh, meshes: [], vertices: 0, indices: 0 } );
			const bucket = materials.get( key ), copies = mesh.isInstancedMesh ? mesh.count : 1;
			bucket.meshes.push( mesh );
			bucket.vertices += mesh.geometry.getAttribute( 'position' ).count * copies;
			bucket.indices += ( mesh.geometry.index?.count ?? mesh.geometry.getAttribute( 'position' ).count ) * copies;

		} );

	}
	const group = new THREE.Group();
	let deadline = performance.now() + 4;
	const checkpoint = async () => { await frameYield(); deadline = performance.now() + 4; return wanted(); };
	try {

		for ( const bucket of materials.values() ) {

			if ( ! wanted() ) { disposePageGeometry( group ); return null; }
			const positions = new Float32Array( bucket.vertices * 3 ), normals = new Float32Array( bucket.vertices * 3 );
			const uvs = new Float32Array( bucket.vertices * 2 );
			const indices = bucket.vertices > 65535 ? new Uint32Array( bucket.indices ) : new Uint16Array( bucket.indices );
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
			geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
			geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
			geometry.setIndex( new THREE.BufferAttribute( indices, 1 ) );
			const mesh = new THREE.Mesh( geometry, bucket.source.material );
			mesh.name = `ground:page:${bucket.source.material.name || bucket.source.material.uuid}`;
			mesh.castShadow = bucket.source.castShadow;
			mesh.receiveShadow = bucket.source.receiveShadow;
			group.add( mesh );
			const bounds = new THREE.Box3(), point = new THREE.Vector3();
			const transform = new THREE.Matrix4(), instance = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
			let vertexOffset = 0, indexOffset = 0;
			for ( const source of bucket.meshes ) {

				const p = source.geometry.getAttribute( 'position' ), n = source.geometry.getAttribute( 'normal' ), uv = source.geometry.getAttribute( 'uv' );
				const sourceIndex = source.geometry.index;
				for ( let copy = 0; copy < ( source.isInstancedMesh ? source.count : 1 ); copy ++ ) {

					transform.copy( source.matrixWorld );
					if ( source.isInstancedMesh ) { source.getMatrixAt( copy, instance ); transform.multiply( instance ); }
					normalMatrix.getNormalMatrix( transform );
					const m = transform.elements, nm = normalMatrix.elements;
					for ( let i = 0; i < p.count; i ++ ) {

						const vertex = vertexOffset + i, offset = vertex * 3;
						const x = p.getX( i ), y = p.getY( i ), z = p.getZ( i );
						positions[ offset ] = m[ 0 ] * x + m[ 4 ] * y + m[ 8 ] * z + m[ 12 ];
						positions[ offset + 1 ] = m[ 1 ] * x + m[ 5 ] * y + m[ 9 ] * z + m[ 13 ];
						positions[ offset + 2 ] = m[ 2 ] * x + m[ 6 ] * y + m[ 10 ] * z + m[ 14 ];
						point.fromArray( positions, offset ); bounds.expandByPoint( point );
						const nx = n.getX( i ), ny = n.getY( i ), nz = n.getZ( i );
						normals[ offset ] = nm[ 0 ] * nx + nm[ 3 ] * ny + nm[ 6 ] * nz;
						normals[ offset + 1 ] = nm[ 1 ] * nx + nm[ 4 ] * ny + nm[ 7 ] * nz;
						normals[ offset + 2 ] = nm[ 2 ] * nx + nm[ 5 ] * ny + nm[ 8 ] * nz;
						uvs[ vertex * 2 ] = uv.getX( i ); uvs[ vertex * 2 + 1 ] = uv.getY( i );
						if ( ( vertex & 1023 ) === 0 && performance.now() >= deadline && ! await checkpoint() ) { disposePageGeometry( group ); return null; }

					}
					for ( let i = 0; i < ( sourceIndex?.count ?? p.count ); i ++ ) {

						indices[ indexOffset ++ ] = vertexOffset + ( sourceIndex ? sourceIndex.getX( i ) : i );
						if ( ( indexOffset & 1023 ) === 0 && performance.now() >= deadline && ! await checkpoint() ) { disposePageGeometry( group ); return null; }

					}
					vertexOffset += p.count;

				}

			}
			geometry.boundingBox = bounds;
			geometry.boundingSphere = bounds.getBoundingSphere( new THREE.Sphere() );

		}
		return group;

	} catch ( error ) { disposePageGeometry( group ); throw error; }

}

export function disposePageGeometry( group ) {

	group.removeFromParent();
	group.traverse( mesh => { mesh.geometry?.dispose(); } );

}
