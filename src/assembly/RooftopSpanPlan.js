const ACCESS_CLEARANCE = 1;

/**
 * Builds Connections' complete rooftop fitting request from finished Exterior
 * blueprints. Assembly owns this pass because the attachment and obstacle data
 * exists only after every shell has been generated.
 */
export function rooftopSpanRequest( atlas, buildings, { seed, params } = {} ) {

	const usable = buildings.filter( ( entry ) => entry.blueprint?.roof?.outline?.length >= 3 );
	const request = {
		seed: seed ?? `${atlas.meta.seed}:rooftop-spans`,
		attachments: usable.flatMap( ( entry ) => attachmentsOf( entry ) ),
		volumes: [
			...usable.map( ( entry ) => buildingVolume( entry ) ),
			...usable.flatMap( ( entry ) => accessVolume( entry ) ),
			...usable.flatMap( ( entry ) => equipmentVolumes( entry ) )
		]
	};

	if ( params ) request.params = params;

	return request;

}

function attachmentsOf( { buildingId, blueprint } ) {

	return ( blueprint.roof.artifacts ?? [] ).flatMap( ( artifact ) =>
		( artifact.mastAssembly?.externalAttachments ?? [] ).map( ( attachment ) => ( {
			buildingId,
			attachment
		} ) )
	);

}

function buildingVolume( { buildingId, blueprint } ) {

	const quiet = ( blueprint.roof.artifacts ?? [] ).length === 0;

	return {
		id: `${buildingId}-${quiet ? 'quiet-' : ''}building`,
		kind: 'building',
		buildingId,
		footprint: blueprint.roof.outline,
		bottom: 0,
		top: blueprint.roof.elevation
	};

}

function accessVolume( { buildingId, blueprint } ) {

	const bulkhead = blueprint.roof.bulkhead;
	if ( ! bulkhead ) return [];

	const axis = bulkhead.axis;
	const normal = [ - axis[ 1 ], axis[ 0 ] ];

	return [ {
		id: `${buildingId}-roof-access`,
		kind: 'access',
		buildingId,
		footprint: rectangle( bulkhead.center, axis, normal, bulkhead.width, bulkhead.depth ),
		bottom: blueprint.roof.elevation,
		top: metric( blueprint.roof.elevation + bulkhead.housingHeight ),
		clearance: ACCESS_CLEARANCE
	} ];

}

function equipmentVolumes( { buildingId, blueprint } ) {

	const equipment = ( blueprint.roof.artifacts ?? [] ).filter( ( artifact ) => ! artifact.mastAssembly );
	const kindCounts = new Map();
	for ( const artifact of equipment ) kindCounts.set( artifact.kind, ( kindCounts.get( artifact.kind ) ?? 0 ) + 1 );

	return equipment
		.map( ( artifact ) => {

			const angle = artifact.rotationDeg * Math.PI / 180;
			const axis = [ Math.cos( angle ), Math.sin( angle ) ];
			const normal = [ - axis[ 1 ], axis[ 0 ] ];

			return {
				id: `${buildingId}-${kindCounts.get( artifact.kind ) === 1 ? artifact.kind : artifact.id.replaceAll( ':', '-' )}`,
				kind: 'equipment',
				buildingId,
				footprint: stableRectangle( artifact.center, axis, normal, artifact.size[ 0 ], artifact.size[ 1 ] ),
				bottom: blueprint.roof.elevation,
				top: metric( blueprint.roof.elevation + artifact.size[ 2 ] )
			};

		} );

}

function rectangle( center, axis, normal, width, depth ) {

	return [
		point( center, axis, normal, - width / 2, - depth / 2 ),
		point( center, axis, normal, width / 2, - depth / 2 ),
		point( center, axis, normal, width / 2, depth / 2 ),
		point( center, axis, normal, - width / 2, depth / 2 )
	];

}

/** CCW rectangle with a stable lowest-X, then lowest-Z equipment corner first. */
function stableRectangle( center, axis, normal, width, depth ) {

	const points = rectangle( center, axis, normal, width, depth );
	let first = 0;

	for ( let i = 1; i < points.length; i ++ ) {

		if ( points[ i ][ 0 ] < points[ first ][ 0 ]
			|| ( points[ i ][ 0 ] === points[ first ][ 0 ] && points[ i ][ 1 ] < points[ first ][ 1 ] ) ) first = i;

	}

	return [ ...points.slice( first ), ...points.slice( 0, first ) ];

}

function point( center, axis, normal, along, across ) {

	return [
		metric( center[ 0 ] + axis[ 0 ] * along + normal[ 0 ] * across ),
		metric( center[ 1 ] + axis[ 1 ] * along + normal[ 1 ] * across )
	];

}

function metric( value ) {

	const rounded = Math.round( value * 1000 ) / 1000;

	return Object.is( rounded, - 0 ) ? 0 : rounded;

}
