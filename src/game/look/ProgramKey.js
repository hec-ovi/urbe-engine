/**
 * What the renderer builds one program for, read off a renderable the way the
 * renderer itself reads it.
 *
 * Two keys, because two things are cached. The renderer keeps one built node
 * graph per material, vertex layout and, for an instanced or batched draw, per
 * object; `programKey` names that, so a warm-up prepares exactly the graphs a
 * frame will ask for. The backend keeps one compiled program per distinct
 * shader code, which the object's identity never enters; `codeKey` names that,
 * so one keeper can pin a program however many draws wear it.
 */
export function programKey( node ) {

	const { object, layout } = parts( node );

	return `${layout}|${object}`;

}

export function codeKey( node ) {

	return parts( node ).layout;

}

function parts( node ) {

	const materials = Array.isArray( node.material ) ? node.material : [ node.material ];
	const geometry = node.geometry;
	const attributes = Object.keys( geometry?.attributes ?? {} ).sort().map( ( name ) => {

		const attribute = geometry.attributes[ name ];
		const data = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;

		return [
			name, attribute.itemSize, attribute.normalized ? 'n' : '', data.array?.constructor?.name ?? '',
			attribute.isInterleavedBufferAttribute ? `${data.stride}/${attribute.offset}` : ''
		].join( ':' );

	} );
	const morphs = Object.keys( geometry?.morphAttributes ?? {} ).sort();
	const kind = [
		node.isInstancedMesh, node.isBatchedMesh, node.isSkinnedMesh, node.isPoints, node.isLine, node.isSprite,
		node.instanceColor, node._colorsTexture, geometry?.isInstancedBufferGeometry, geometry?.getIndex?.(), node.receiveShadow
	].map( ( flag ) => ( flag ? 1 : 0 ) ).join( '' );
	const layout = `${materials.map( ( material ) => material?.uuid ?? 'none' ).join( '+' )}|${kind}|${attributes.join( ',' )}|${morphs.join( ',' )}`;

	// What the renderer folds into the graph's key besides the code: the object
	// itself for an instanced or batched draw, whose textures the graph binds.
	const object = [
		node.isInstancedMesh || node.isBatchedMesh || node.count > 1 ? node.uuid : '',
		node._matricesTexture?.uuid ?? '',
		node._colorsTexture?.uuid ?? '',
		node.skeleton ? node.skeleton.bones.length : ''
	].join( ':' );

	return { layout, object };

}
