/** Geometry is cell-owned; materials and their maps belong to the factory. */
export function releaseShell( cell ) {

	cell.disposeModelInstances?.();
	const geometries = new Set();
	const materials = new Set();
	cell.group.traverse( node => {
		if ( node.geometry ) geometries.add( node.geometry );
		for ( const material of Array.isArray( node.material ) ? node.material : [ node.material ] ) {
			if ( material?.userData?.ownedScenicMaterial ) materials.add( material );
		}
	} );
	for ( const pieces of cell.shellColliders?.values() ?? [] ) {

		for ( const geometry of Array.isArray( pieces ) ? pieces : [ pieces ] ) if ( geometry ) geometries.add( geometry );

	}
	for ( const door of cell.doors ?? [] ) {

		for ( const leaf of door.pivots ) if ( leaf.colliderGeometry ) geometries.add( leaf.colliderGeometry );

	}
	for ( const geometry of geometries ) geometry.dispose();
	for ( const material of materials ) material.dispose();
	cell.group.removeFromParent();

}
