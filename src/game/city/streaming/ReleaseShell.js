/** Geometry is cell-owned; materials and their maps belong to the factory. */
export function releaseShell( cell ) {

	const geometries = new Set();
	cell.group.traverse( node => { if ( node.geometry ) geometries.add( node.geometry ); } );
	for ( const pieces of cell.shellColliders?.values() ?? [] ) {

		for ( const geometry of Array.isArray( pieces ) ? pieces : [ pieces ] ) geometries.add( geometry );

	}
	for ( const door of cell.doors ?? [] ) {

		for ( const leaf of door.pivots ) if ( leaf.colliderGeometry ) geometries.add( leaf.colliderGeometry );

	}
	for ( const geometry of geometries ) geometry.dispose();
	cell.group.removeFromParent();

}
