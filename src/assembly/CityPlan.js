import { interiorCandidates } from './InteriorSelection.js';

/** Parse the pair-based city CLI without allowing contradictory shell modes. */
export function parseCityArgs( argv ) {

	const args = { workers: 4, interiors: 5, parcels: null, reuseShells: false, interiorParcels: null };

	if ( argv.length % 2 !== 0 ) return null;
	for ( let i = 0; i < argv.length; i += 2 ) {

		const key = argv[ i ];
		const value = argv[ i + 1 ];

		if ( key === '--blueprint' ) args.blueprint = value;
		else if ( key === '--out' ) args.out = value;
		else if ( key === '--workers' ) args.workers = Number( value );
		else if ( key === '--interiors' ) args.interiors = Number( value );
		else if ( key === '--parcel' ) args.parcels = value.split( ',' ).filter( Boolean );
		else if ( key === '--reuse-shells' && ( value === 'true' || value === 'false' ) ) args.reuseShells = value === 'true';
		else if ( key === '--interior-parcels' ) args.interiorParcels = value.split( ',' ).filter( Boolean );
		else return null;

	}

	if ( ! args.blueprint || ! args.out || ! Number.isInteger( args.workers ) || args.workers < 1 ) return null;
	if ( ! Number.isInteger( args.interiors ) || args.interiors < 0 ) return null;
	if ( args.reuseShells && args.parcels ) return null;
	if ( args.interiorParcels && ( ! args.interiorParcels.length
		|| new Set( args.interiorParcels ).size !== args.interiorParcels.length ) ) return null;

	return args;

}

/** Resolve automatic or exact manual interior candidates against the reusable shells. */
export function interiorPlan( atlas, questlines, shells, args ) {

	const known = new Set( atlas.parcels.map( ( parcel ) => parcel.id ) );
	const available = new Set( shells );
	const requested = args.interiorParcels ?? [];

	return {
		candidates: args.interiorParcels ?? interiorCandidates( atlas, questlines, shells ),
		target: args.interiorParcels ? requested.length : args.interiors,
		unknown: requested.filter( ( id ) => ! known.has( id ) ),
		unavailable: requested.filter( ( id ) => known.has( id ) && ! available.has( id ) )
	};

}
