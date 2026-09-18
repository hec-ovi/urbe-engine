import { bounds, fail, hashValue, jsonHash, pathValue, record, strings, vector } from './NativeStreetChecks.js';

/** Validate the identities and ownership the runtime actually consumes. */
export async function checkStreetMetadata( manifest, blueprint, blueprintHash ) {
	const meta = manifest?.meta, ground = manifest?.ground, delegated = manifest?.delegated;
	const atlas = blueprint.data, original = atlas?.volumetric?.ground;
	if ( meta?.version !== '0.3.0' || meta.architectureVersion !== '0.26.0' || meta.reservationVersion !== '2.1.0'
		|| meta.designVersion !== 'native-1.0.0' || meta.units !== 'meters' || typeof meta.generatorVersion !== 'string' || ! meta.generatorVersion
		|| ! Number.isSafeInteger( meta.seed ) || ! hashValue( meta.blueprintHash ) || ! hashValue( meta.nativeCatalogHash )
		|| atlas?.meta?.version !== meta.architectureVersion || atlas.streets?.construction?.planningReservations?.version !== meta.reservationVersion ) fail( 'Unsupported street source versions' );
	if ( ! [ 'json-file-bytes', 'json-stringify-utf8' ].includes( meta.blueprintEncoding ) ) fail( 'Invalid blueprintEncoding' );
	const sourceHash = meta.blueprintEncoding === 'json-file-bytes' ? blueprintHash : await jsonHash( atlas );
	if ( sourceHash !== meta.blueprintHash ) fail( 'Street blueprint hash mismatch' );
	if ( manifest.materials?.mode !== 'native-reference' || ! record( manifest.materials.binding ) ) fail( 'Missing native material snapshot' );
	if ( await jsonHash( manifest.materials.binding ) !== meta.nativeCatalogHash ) fail( 'Native material snapshot hash mismatch' );
	if ( ! Array.isArray( original ) || ! record( ground?.replacements ) || ! Array.isArray( ground.owners ) || ! record( delegated ) ) fail( 'Invalid street ground ownership' );
	const replacements = indices( ground.replacements.groundIndices, original.length, 'replacement indices' );
	const retained = indices( delegated.remainingGroundIndices, original.length, 'retained indices' );
	if ( replacements.size + retained.size !== original.length || [ ...replacements ].some( index => retained.has( index ) ) ) fail( 'Street ground does not partition the source' );
	const modules = strings( ground.replacements.moduleOwnerIds, 'module replacements' );
	const groundIds = new Set(), sourceIds = new Set();
	for ( const owner of ground.owners ) {
		if ( typeof owner?.id !== 'string' || ! owner.id || groundIds.has( owner.id ) || typeof owner.ownerId !== 'string' || ! owner.ownerId
			|| ! replacements.has( owner.sourceIndex ) || sourceIds.has( owner.sourceIndex ) ) fail( 'Invalid or duplicate street ground owner' );
		groundIds.add( owner.id ); sourceIds.add( owner.sourceIndex );
	}
	if ( sourceIds.size !== replacements.size ) fail( 'A replaced ground record has no owner' );
	for ( const index of replacements ) if ( original[ index ].moduleBlockId !== undefined && ! modules.has( original[ index ].moduleBlockId ) ) fail( 'Missing replaced module owner' );
	for ( const index of retained ) if ( modules.has( original[ index ].moduleBlockId ) ) fail( 'Retained ground belongs to a replaced module' );
	if ( ! record( ground.cover ) || ! Number.isFinite( ground.cover.missingArea ) || ! Number.isFinite( ground.cover.outsideArea )
		|| ground.cover.missingArea < 0 || ground.cover.outsideArea < 0 || ground.cover.missingArea > 0.000001 || ground.cover.outsideArea > 0.000001 ) fail( 'Street coverage is incomplete' );
	const highways = atlas.streets.highwayStructures, stations = atlas.transit?.subwayStations;
	if ( ! Array.isArray( highways ) || ! Array.isArray( stations ) || delegated.highways?.source !== 'streets.highwayStructures'
		|| delegated.stations?.source !== 'transit.subwayStations' || delegated.highways.count !== highways.length ) fail( 'Invalid delegated infrastructure' );
	const stationIds = strings( delegated.stations.stationIds, 'station identities' );
	if ( stationIds.size !== stations.length || stations.some( station => ! stationIds.has( station.id ) ) ) fail( 'Delegated station identities differ' );
	if ( await jsonHash( highways ) !== delegated.highways.hash || await jsonHash( stations ) !== delegated.stations.hash ) fail( 'Delegated infrastructure hash mismatch' );
	const kit = manifest.kit, placements = manifest.placements, files = manifest.files;
	if ( ! record( files ) || ! pathValue( files.kit ) || ! pathValue( files.placements ) ) fail( 'Invalid street bundle file paths' );
	if ( kit?.version !== '1.0.0' || kit.units !== 'meters' || kit.module !== 8 || ! Array.isArray( kit.pieces ) || ! kit.pieces.length
		|| placements?.version !== '1.0.0' || ! Number.isFinite( placements.cellSize ) || placements.cellSize <= 0
		|| ! Array.isArray( placements.placements ) || ! placements.placements.length || ! Array.isArray( manifest.features ) ) fail( 'Missing street kit, placements or features' );
	const ids = new Set(), paths = new Set();
	for ( const piece of kit.pieces ) {
		if ( typeof piece?.id !== 'string' || ! piece.id || ids.has( piece.id ) || ! pathValue( piece.file ) || paths.has( piece.file ) || ! hashValue( piece.sha256 )
			|| ! bounds( piece.bounds ) || typeof piece.hasCollision !== 'boolean' || ! Number.isSafeInteger( piece.bytes ) || piece.bytes < 1
			|| ! Number.isSafeInteger( piece.triangles ) || piece.triangles < 1 ) fail( 'Invalid street kit piece' );
		ids.add( piece.id ); paths.add( piece.file );
		for ( const id of strings( piece.surfaces, 'piece surfaces' ) ) if ( ! Object.hasOwn( manifest.materials.binding.surfaces ?? {}, id ) ) fail( 'Piece references missing surface' );
	}
	for ( const placement of placements.placements ) {
		if ( ! ids.has( placement?.piece ) || ! vector( placement.position, 3 ) || ! Number.isFinite( placement.rotationY )
			|| ! Array.isArray( placement.cell ) || placement.cell.length !== 2
			|| placement.cell.some( ( value, axis ) => value !== Math.floor( placement.position[ axis * 2 ] / placements.cellSize ) )
			|| typeof placement.ownerId !== 'string' || ! placement.ownerId
			|| ( placement.scale !== undefined && ( ! vector( placement.scale, 3 ) || placement.scale.some( value => value <= 0 ) ) ) ) fail( 'Invalid street placement' );
		strings( placement.ownerIds, 'placement owner IDs' );
	}
	ids.clear();
	for ( const feature of manifest.features ) {
		if ( typeof feature?.id !== 'string' || ! feature.id || ids.has( feature.id ) || ! bounds( feature.bounds ) || ! Array.isArray( feature.footprint )
			|| feature.footprint.length < 3 || ! feature.footprint.every( point => vector( point, 2 ) ) ) fail( 'Invalid street feature reservation' );
		ids.add( feature.id );
	}
}

function indices( values, length, field ) {
	if ( ! Array.isArray( values ) || values.some( n => ! Number.isSafeInteger( n ) || n < 0 || n >= length ) || new Set( values ).size !== values.length ) fail( `Invalid ${field}` );
	return new Set( values );
}
