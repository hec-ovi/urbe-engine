import { ringBounds, Roadway } from './Polygons.js';
import { shaftMouths } from './Stations.js';
import { GroundModuleCatalog } from './GroundModuleCatalog.js';

const AXES = [ [ 1, 0 ], [ 0, 1 ], [ - 1, 0 ], [ 0, - 1 ] ];

/** Source ownership index. Repeats are ranges; geometry is allocated only on admission. */
export class GroundTiles {

	constructor( atlas, cellSize ) {

		this.atlas = atlas;
		this.cellSize = cellSize;
		this.tiles = new Map();
		this.definitions = new Map();
		const moduleCatalog = new GroundModuleCatalog( atlas );
		const ground = atlas.volumetric.ground;
		this.bounds = ringBounds( ground.map( cover => cover.polygon ) );
		this.context = { road: new Roadway( ground ), mouths: shaftMouths( atlas ), strip: ground.some( cover => cover.surface === 'curb' ), collision: false, moduleCatalog };
		for ( const cover of ground ) {

			if ( cover.moduleBlockId !== undefined ) continue;
			this.own( ringBounds( [ cover.polygon ] ) ).covers.push( cover );

		}
		for ( const definition of moduleCatalog.definitions.values() ) {

			this.definitions.set( definition.id, { definition, bounds: ringBounds( definition.parts.filter( part => part.role !== 'guardrail' ).map( part => part.polygon ) ) } );

		}
		for ( const source of atlas.streets?.construction?.modules?.placements ?? [] ) {

			const record = this.definitions.get( source.moduleId );
			if ( ! record ) fail( `Missing module definition: ${source.moduleId}` );
			if ( ! Number.isFinite( record.bounds.min[ 0 ] ) ) continue;
			const axis = AXES[ source.turn ];
			if ( ! axis || ! Number.isSafeInteger( source.count ) || source.count < 1 || ! Number.isFinite( source.step ) || source.step <= 0 ) fail( 'Invalid module repeat' );
			const rotated = placedBounds( record.bounds, source.origin, axis );
			for ( let offset = 0; offset < source.count; offset ++ ) {

				const dx = axis[ 0 ] * offset * source.step, dz = axis[ 1 ] * offset * source.step;
				const bounds = { min: [ rotated.min[ 0 ] + dx, rotated.min[ 1 ] + dz ], max: [ rotated.max[ 0 ] + dx, rotated.max[ 1 ] + dz ] };
				const tile = this.own( bounds ), previous = tile.modules.at( - 1 );
				if ( previous?.source === source && previous.offset + previous.count === offset ) previous.count ++;
				else tile.modules.push( { source, offset, count: 1 } );

			}

		}
		for ( const highway of atlas.streets?.highwayStructures ?? [] ) {

			const bounds = ringBounds( [ highway.path, ...( highway.supports ?? [] ).map( support => support.footprint ) ] );
			for ( const axis of [ 0, 1 ] ) { bounds.min[ axis ] -= highway.width; bounds.max[ axis ] += highway.width; }
			this.own( bounds ).highways.push( highway );

		}
	}

	own( bounds ) {

		const x = Math.floor( ( bounds.min[ 0 ] + bounds.max[ 0 ] ) / ( 2 * this.cellSize ) );
		const z = Math.floor( ( bounds.min[ 1 ] + bounds.max[ 1 ] ) / ( 2 * this.cellSize ) );
		const id = `ground:${x}:${z}`;
		if ( ! this.tiles.has( id ) ) this.tiles.set( id, { id, covers: [], modules: [], highways: [], bounds: { min: [ Infinity, Infinity ], max: [ - Infinity, - Infinity ] } } );
		const tile = this.tiles.get( id );
		for ( const axis of [ 0, 1 ] ) {

			tile.bounds.min[ axis ] = Math.min( tile.bounds.min[ axis ], bounds.min[ axis ] );
			tile.bounds.max[ axis ] = Math.max( tile.bounds.max[ axis ], bounds.max[ axis ] );

		}
		return tile;

	}

	window( point, radius, collisionRadius ) {

		const selected = [];
		for ( const tile of this.tiles.values() ) {

			const distance = distanceSquared( point, tile.bounds );
			if ( distance <= radius * radius ) selected.push( { tile, distance, collide: distance <= collisionRadius * collisionRadius } );

		}
		selected.sort( ( a, b ) => Number( b.collide ) - Number( a.collide ) || a.distance - b.distance || a.tile.id.localeCompare( b.tile.id ) );
		return new Map( selected.map( item => [ item.tile.id, item ] ) );

	}

	project( tile ) {

		const placements = tile.modules.map( ( { source, offset, count } ) => {

			const [ c, s ] = AXES[ source.turn ];
			return { ...source, origin: [ source.origin[ 0 ] + c * offset * source.step, source.origin[ 1 ] + s * offset * source.step ], count };

		} );
		const construction = this.atlas.streets?.construction ?? {};
		const modules = construction.modules && { version: construction.modules.version, definitions: [ ...new Set( placements.map( placement => placement.moduleId ) ) ].map( id => this.definitions.get( id ).definition ), placements };
		return { meta: this.atlas.meta, volumetric: { ground: tile.covers }, transit: this.atlas.transit,
			streets: { highwayStructures: tile.highways, construction: { ...( modules ? { modules } : {} ), ...( construction.paving ? { paving: this.paving( tile.covers ) } : {} ) } } };

	}

	paving( covers ) {

		const source = this.atlas.streets.construction.paving;
		const ids = new Set( covers.map( cover => cover.construction?.regionId ) );
		const regions = source.regions.filter( region => ids.has( region.id ) );
		const layouts = new Set( [ source.roadwayLayoutId, ...regions.map( region => region.layoutId ) ] );
		const frames = new Set( regions.map( region => region.frameId ) );
		const sources = new Set( regions.map( region => region.sourceId ) );
		return { ...source, regions, layouts: source.layouts.filter( layout => layouts.has( layout.id ) ), frames: source.frames.filter( frame => frames.has( frame.id ) ),
			...( source.sources ? { sources: source.sources.filter( record => sources.has( record.id ) ) } : {} ) };

	}

}

function placedBounds( bounds, origin, [ c, s ] ) {

	const points = [];
	for ( const x of [ bounds.min[ 0 ], bounds.max[ 0 ] ] ) for ( const z of [ bounds.min[ 1 ], bounds.max[ 1 ] ] ) points.push( [ origin[ 0 ] + c * x - s * z, origin[ 1 ] + s * x + c * z ] );
	return ringBounds( [ points ] );

}

function distanceSquared( point, bounds ) {

	const x = Math.max( bounds.min[ 0 ] - point.x, 0, point.x - bounds.max[ 0 ] );
	const z = Math.max( bounds.min[ 1 ] - point.z, 0, point.z - bounds.max[ 1 ] );
	return x * x + z * z;

}

export function fail( message ) { throw Object.assign( new Error( message ), { code: 'E_GROUND_STREAM' } ); }
