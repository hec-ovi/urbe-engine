import { StreetInstanceTable } from './StreetInstanceTable.js';
import { drawnSurfaces } from './StreetRoutes.js';
import { placementId } from '../materials/StreetVariants.js';
import { colorGraph } from '../materials/PanelGraph.js';

/** The most panels one part of a piece numbers; the kits carry up to 72. A panel past it draws its set's fallback. */
export const PANEL_CAPACITY = 96;

/**
 * Which surface reads which placement value, and the table behind each one.
 *
 * Every surface reads the tint and the wear its placements carry. The two that
 * cost more are asked for by the bundle itself: the surfaces of the pieces a
 * scan placement stands on sample the scan atlas, and a display face on a piece
 * a text placement stands on letters as many glyphs as the longest of them. A
 * surface that picks its variant per panel carries the variant of each of the
 * copy's panels, coloured once over the whole city so no two panels sharing an
 * edge wear the same ([VariantColoring](../materials/VariantColoring.js)).
 */
export class StreetInstances {

	/**
	 * @param kit the manifest's `kit`
	 * @param placements the manifest's placement table
	 * @param binding the native material snapshot, for each surface's effect
	 * @param variants the whole-bundle variants ([StreetVariants](../materials/StreetVariants.js)), or null
	 */
	constructor( kit, placements, binding, variants = null, { open = openWorker } = {} ) {

		this.placements = placements;
		this.variants = variants;
		this.open = open;
		/** placement to Map of part index to its panels' variants */
		this.colorsOf = new Map();
		/** set id to `{ panels, edges, conflicts, realised }` */
		this.stats = new Map();

		const pieces = new Map( kit.pieces.map( piece => [ piece.id, piece ] ) );
		const scan = new Set(), glyphs = new Map();

		for ( const placement of placements ) {

			const piece = pieces.get( placement.piece );
			const surfaces = piece ? drawnSurfaces( piece, binding ) : [];
			if ( placement.scan ) for ( const id of surfaces ) scan.add( id );
			if ( placement.text?.length ) {

				for ( const id of surfaces ) {

					if ( binding.surfaces[ id ]?.effect === 'display' ) glyphs.set( id, Math.max( glyphs.get( id ) ?? 0, placement.text.length ) );

				}

			}

		}
		this.scanAtlas = kit.scanAtlas;
		// A batch of world-sampled copies (`<surface>@world`) picks per world cell and carries no panels.
		const panels = ( id ) => {

			const set = variants?.of( id );
			return set?.unit === 'panel'
				? { capacity: PANEL_CAPACITY, fallback: set.fallback, colors: ( placement, part ) => this.colorsOf.get( placement )?.get( part ) ?? null }
				: null;

		};
		this.tables = new Map( [ ...new Set( kit.pieces.flatMap( piece => drawnSurfaces( piece, binding ) ) ) ]
			.map( id => [ id, new StreetInstanceTable( { scan: scan.has( id ), glyphs: glyphs.get( id ) ?? 0, variant: panels( id ) } ) ] ) );
		this.byBatch = new Map();

	}

	/** What the factory needs to build one surface's material. */
	options( surfaceId ) {

		const table = this.tables.get( surfaceId );

		return { instances: table.ports, ...( table.scan ? { scanCells: this.scanAtlas } : {} ) };

	}

	/** Takes the batches the kit built, one per surface. */
	bind( batches ) {

		for ( const [ surfaceId, batch ] of batches ) {

			const table = this.tables.get( surfaceId );
			table.bind( batch );
			this.byBatch.set( batch, table );

		}

	}

	/** Every table back onto its batch's current tables, after a reservation replaced them. */
	follow() {

		for ( const table of this.tables.values() ) table.follow();

	}

	/** The values of one admitted copy, at the slot each of its batches gave it. */
	write( handle, placement ) {

		for ( const [ index, { batch } ] of handle.parts.entries() ) this.byBatch.get( batch ).write( handle.instances[ index ], placement, index );

	}

	/**
	 * Colours every panel the placements lay, set by set, before any copy
	 * stands: each panel's corners in the world from its piece's panel charts,
	 * in canonical order, coloured on a worker where there is one.
	 * @param pieces piece id to `{ surfaces: [{ bucket, panels }] }`, `panels` a part's charts (`withPanelUnits`)
	 */
	async colour( pieces ) {

		if ( ! this.variants ) return;
		const ordered = this.placements.map( ( placement ) => [ placementId( placement ), placement ] )
			.sort( ( a, b ) => ( a[ 0 ] < b[ 0 ] ? - 1 : a[ 0 ] > b[ 0 ] ? 1 : 0 ) );
		const bySet = new Map();
		for ( const [ id, placement ] of ordered ) {

			const parts = ( pieces.get( placement.piece )?.surfaces ?? [] ).map( ( surface, part ) => ( { ...surface, part } ) )
				.filter( ( surface ) => surface.panels && this.variants.of( surface.bucket )?.unit === 'panel' )
				.sort( ( a, b ) => ( a.bucket < b.bucket ? - 1 : a.bucket > b.bucket ? 1 : a.part - b.part ) );
			for ( const { bucket, part, panels } of parts ) {

				const set = this.variants.of( bucket );
				if ( ! bySet.has( set.id ) ) bySet.set( set.id, { set, entries: [], count: 0 } );
				const group = bySet.get( set.id );
				group.entries.push( { id, placement, part, bucket, panels } );
				group.count += panels.length / 9;

			}

		}
		await Promise.all( [ ...bySet.values() ].map( ( group ) => this.#colourSet( group ) ) );

	}

	async #colourSet( { set, entries, count } ) {

		const corners = new Float64Array( count * 12 ), prefix = new Uint32Array( count ), panel = new Uint16Array( count );
		let unit = 0;
		for ( const { id, placement, bucket, panels } of entries ) {

			const [ x, y, z ] = placement.position, [ sx, sy, sz ] = placement.scale ?? [ 1, 1, 1 ];
			const cos = Math.cos( placement.rotationY ), sin = Math.sin( placement.rotationY );
			const seed = this.variants.seed( bucket, id );
			for ( let k = 0; k < panels.length / 9; k ++, unit ++ ) {

				const [ ox, oy, oz, ux, uy, uz, vx, vy, vz ] = panels.subarray( k * 9, k * 9 + 9 );
				const local = [ [ ox, oy, oz ], [ ox + ux, oy + uy, oz + uz ], [ ox + ux + vx, oy + uy + vy, oz + uz + vz ], [ ox + vx, oy + vy, oz + vz ] ];
				local.forEach( ( [ lx, ly, lz ], corner ) => corners.set( [ x + cos * lx * sx + sin * lz * sz, y + ly * sy, z - sin * lx * sx + cos * lz * sz ], unit * 12 + corner * 3 ) );
				prefix[ unit ] = seed;
				panel[ unit ] = k;

			}

		}
		const weights = set.cdf.map( ( edge, index ) => edge - ( index ? set.cdf[ index - 1 ] : 0 ) );
		const result = await run( this.open, { weights, units: { count, corners, prefix, panel } } );
		let at = 0;
		for ( const { placement, part, panels } of entries ) {

			const n = panels.length / 9;
			if ( ! this.colorsOf.has( placement ) ) this.colorsOf.set( placement, new Map() );
			this.colorsOf.get( placement ).set( part, result.colors.subarray( at, at + n ) );
			at += n;

		}
		const realised = Object.fromEntries( set.layers.map( ( layer, index ) => [ layer.id, +( result.counts[ index ] / Math.max( 1, count ) ).toFixed( 3 ) ] ) );
		this.stats.set( set.id, { panels: count, edges: result.edges, conflicts: result.conflicts, realised } );
		console.info( `street variants ${set.id}: ${count} panels, ${result.edges} shared edges, ${result.conflicts} neighbours alike, realised ${JSON.stringify( realised )}` );

	}

	dispose() {

		for ( const table of this.tables.values() ) table.dispose();
		this.tables.clear();
		this.byBatch.clear();

	}

}

/** One set's colouring, on a worker where there is one, else here. */
async function run( open, request ) {

	let worker = null;
	try {

		worker = open();

	} catch {

		worker = null;

	}
	if ( ! worker ) return colorGraph( request.weights, request.units );
	try {

		const answer = await new Promise( ( resolve ) => {

			worker.onmessage = ( { data } ) => resolve( data );
			worker.onerror = ( event ) => {

				event.preventDefault?.();
				resolve( { error: event.message ?? 'the worker failed' } );

			};
			worker.postMessage( request, [ request.units.corners.buffer ] );

		} );
		if ( answer.error ) throw new Error( `street variants: ${answer.error}` );
		return answer;

	} finally {

		worker.terminate();

	}

}

function openWorker() {

	return typeof Worker === 'undefined' ? null : new Worker( new URL( '../materials/PanelColoring.worker.js', import.meta.url ), { type: 'module' } );

}
