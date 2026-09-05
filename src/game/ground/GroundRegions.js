const BANDS = new Set( [ 'curb', 'border', 'furnishing', 'walking', 'frontage', 'circulation' ] );

/** Read-only views of Atlas ownership. The referenced records remain Atlas-owned. */
export class GroundRegions {

	constructor( atlas ) {

		this.records = [];
		const paving = atlas.streets?.construction?.paving;
		const covers = atlas.volumetric?.ground ?? [];
		if ( ! paving ) {

			if ( covers.some( cover => cover.construction ) ) fail( 'Ground construction has no paving records' );
			return;

		}
		if ( paving.version !== '1.0.0' ) fail( 'Unsupported paving version' );
		const layouts = indexed( paving.layouts, 'layout' );
		const frames = indexed( paving.frames, 'frame' );
		const regions = indexed( paving.regions, 'region' );
		const byRegion = new Map( [ ...regions.keys() ].map( id => [ id, [] ] ) );
		for ( const cover of covers ) {

			if ( ! cover.construction ) continue;
			const owned = byRegion.get( cover.construction.regionId );
			if ( ! owned ) fail( `Unknown paving region: ${cover.construction.regionId}` );
			owned.push( cover );

		}
		for ( const region of regions.values() ) {

			const layout = layouts.get( region.layoutId );
			const frame = frames.get( region.frameId );
			if ( ! layout || ! frame || ! BANDS.has( region.band ) ) fail( `Invalid paving region: ${region.id}` );
			const owned = byRegion.get( region.id );
			if ( owned.length ) this.records.push( Object.freeze( { region, layout, frame, covers: Object.freeze( owned ) } ) );

		}
		Object.freeze( this.records );

	}

	/** All finish parts of the requested movement band, without geometric changes. */
	footprints( band ) {

		if ( ! BANDS.has( band ) ) fail( `Unknown ground band: ${band}` );
		return Object.freeze( this.records.filter( record => record.region.band === band ) );

	}

}

function indexed( records, kind ) {

	if ( ! Array.isArray( records ) ) fail( `Missing paving ${kind} records` );
	const index = new Map();
	for ( const record of records ) {

		if ( ! record?.id || index.has( record.id ) ) fail( `Invalid or duplicate paving ${kind} id` );
		index.set( record.id, record );

	}
	return index;

}

export function fail( message ) {

	throw Object.assign( new Error( message ), { code: 'E_GROUND_CONSTRUCTION' } );

}
