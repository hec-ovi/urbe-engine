import { interiorCandidates } from './InteriorSelection.js';
import { defaultWorkers } from './Parallelism.js';

/** Parse the pair-based city CLI without allowing contradictory shell modes. */
export function parseCityArgs( argv ) {

	const args = {
		workers: defaultWorkers(), interiors: 5, parcels: null, reuseShells: false, interiorParcels: null, interiorPriority: []
	};

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
		else if ( key === '--interior-priority' ) args.interiorPriority = value.split( ',' ).filter( Boolean );
		else return null;

	}

	if ( ! args.blueprint || ! args.out || ! Number.isInteger( args.workers ) || args.workers < 1 ) return null;
	if ( ! Number.isInteger( args.interiors ) || args.interiors < 0 ) return null;
	if ( args.reuseShells && args.parcels ) return null;
	if ( args.interiorParcels && ( ! args.interiorParcels.length
		|| new Set( args.interiorParcels ).size !== args.interiorParcels.length ) ) return null;
	// A priority orders an automatic pick; a manual pick is exact already.
	if ( args.interiorPriority.length && ( args.interiorParcels
		|| new Set( args.interiorPriority ).size !== args.interiorPriority.length ) ) return null;

	return args;

}

/** Resolve automatic or exact manual interior candidates against the reusable shells. */
export function interiorPlan( atlas, questlines, shells, args ) {

	const known = new Set( atlas.parcels.map( ( parcel ) => parcel.id ) );
	const available = new Set( shells );
	const requested = args.interiorParcels ?? [];

	return {
		// A parcel with no building cannot open one, so it leaves the candidates
		// and is reported in `unavailable` instead.
		candidates: args.interiorParcels
			? requested.filter( ( id ) => available.has( id ) )
			: interiorCandidates( atlas, questlines, shells, args.interiorPriority ),
		target: args.interiorParcels ? requested.length : args.interiors,
		unknown: [ ...requested, ...args.interiorPriority ].filter( ( id ) => ! known.has( id ) ),
		unavailable: requested.filter( ( id ) => known.has( id ) && ! available.has( id ) )
	};

}
