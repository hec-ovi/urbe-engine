import { Float32BufferAttribute } from 'three/webgpu';
import { bake, INTERIOR_PREFIX } from './BuildingsLoader.js';
import { materialKey, partition } from './InteriorRooms.js';
import { materialPacketOf } from './InteriorMaterials.js';

/** Static interior and imported furniture triangles, with source PBR kept outside the catalog. */
export function cutInterior( scene, outlines ) {

	scene.updateMatrixWorld( true );
	const surfaces = [];
	const materials = new Map();
	scene.traverse( node => {

		if ( ! node.isMesh ) return;
		let imported = false;
		for ( let parent = node; parent; parent = parent.parent ) imported ||= ( parent.userData.name ?? parent.name )?.startsWith( 'asset:' );
		if ( ! imported && ! node.name?.startsWith( INTERIOR_PREFIX ) ) return;
		if ( imported && ( node.isSkinnedMesh || node.morphTargetInfluences?.some( value => value !== 0 ) ) ) {

			throw new Error( 'Interior furniture must have a static exported pose' );

		}
		const geometry = imported ? bakeSource( node ) : bake( node );
		const list = Array.isArray( node.material ) ? node.material : [ node.material ];
		const groups = Array.isArray( node.material ) ? geometry.groups : [ { start: 0, count: geometry.attributes.position.count, materialIndex: 0 } ];
		for ( const group of groups ) {

			const material = list[ group.materialIndex ];
			const attributes = {};
			for ( const [ name, attribute ] of Object.entries( geometry.attributes ) ) {

				let array;
				if ( ! attribute.isInterleavedBufferAttribute && ! attribute.normalized && attribute.array instanceof Float32Array ) {

					array = attribute.array.subarray( group.start * attribute.itemSize, ( group.start + group.count ) * attribute.itemSize );

				} else {

					array = new Float32Array( group.count * attribute.itemSize );
					for ( let i = 0; i < group.count; i ++ ) for ( let c = 0; c < attribute.itemSize; c ++ ) {

						array[ i * attribute.itemSize + c ] = attribute.getComponent( group.start + i, c );

					}

				}
				attributes[ name ] = { array, itemSize: attribute.itemSize };

			}
			const { position, normal, uv, ...extra } = attributes;
			if ( imported ) materials.set( material.uuid, material );
			surfaces.push( {
				key: imported ? material.name : materialKey( material ),
				...( imported ? { sourceId: material.uuid } : {} ),
				position: position.array, normal: normal.array, uv: uv.array,
				...( Object.keys( extra ).length ? { attributes: extra } : {} )
			} );

		}
		geometry.dispose();

	} );
	return { ...partition( surfaces, outlines ), materials: materialPacketOf( [ ...materials.values() ] ) };

}

/** Preserve every source attribute, including reflected winding and tangent handedness. */
function bakeSource( mesh ) {

	const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
	geometry.applyMatrix4( mesh.matrixWorld );
	if ( ! geometry.attributes.normal ) geometry.computeVertexNormals();
	if ( ! geometry.attributes.uv ) geometry.setAttribute( 'uv', new Float32BufferAttribute( new Float32Array( geometry.attributes.position.count * 2 ), 2 ) );
	if ( mesh.matrixWorld.determinant() < 0 ) {

		for ( const attribute of Object.values( geometry.attributes ) ) {

			for ( let i = 0; i < attribute.count; i += 3 ) for ( let c = 0; c < attribute.itemSize; c ++ ) {

				const value = attribute.getComponent( i + 1, c );
				attribute.setComponent( i + 1, c, attribute.getComponent( i + 2, c ) );
				attribute.setComponent( i + 2, c, value );

			}

		}
		const tangent = geometry.attributes.tangent;
		if ( tangent ) for ( let i = 0; i < tangent.count; i ++ ) tangent.setW( i, - tangent.getW( i ) );

	}
	return geometry;

}
