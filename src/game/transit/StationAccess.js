import { frameOf } from './StationFrame.js';
import { pointInRing } from '../ground/Polygons.js';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import layout from './station-layout.json' with { type: 'json' };

/** Shared metre layout for a short stair, its machine and the player's landing. */
export class StationAccess {
	constructor( atlas ) {
		this.entrances = [];
		for ( const [ collection, kind ] of [ [ 'subwayStations', 'subway' ], [ 'trainStations', 'train' ] ] ) {
			for ( const station of atlas.transit?.[ collection ] ?? [] ) ( station.entrances ?? [] ).forEach( ( origin, index ) => {
				const shaft = station.shafts?.[ index ], frame = frameOf( shaft?.footprint ?? [] );
				const top = groundTop( atlas, origin );
				let heading = Math.atan2( station.position[ 0 ] - origin[ 0 ], station.position[ 1 ] - origin[ 1 ] );
				if ( frame ) {
					const path = station.accessPaths?.find( path => path.entranceIndex === index )?.segments?.find( segment => segment.kind === 'stairs' )?.path;
					const direction = path?.length > 1 ? [ path[ 1 ][ 0 ] - path[ 0 ][ 0 ], path[ 1 ][ 2 ] - path[ 0 ][ 2 ] ] : frame.axis;
					const sign = direction[ 0 ] * frame.axis[ 0 ] + direction[ 1 ] * frame.axis[ 1 ] < 0 ? - 1 : 1;
					heading = Math.atan2( frame.axis[ 0 ] * sign, frame.axis[ 1 ] * sign );
				}
				const c = Math.cos( heading ), s = Math.sin( heading );
				const point = ( x, y, z ) => [ origin[ 0 ] + c * x + s * z, y, origin[ 1 ] - s * x + c * z ];
				const local = ( shaft?.footprint ?? [] ).map( ( [ x, z ] ) => [ c * ( x - origin[ 0 ] ) - s * ( z - origin[ 1 ] ), s * ( x - origin[ 0 ] ) + c * ( z - origin[ 1 ] ) ] );
				const bounds = local.length ? [ Math.min( ...local.map( p => p[ 0 ] ) ), Math.max( ...local.map( p => p[ 0 ] ) ), Math.min( ...local.map( p => p[ 1 ] ) ), Math.max( ...local.map( p => p[ 1 ] ) ) ] : null;
				const treads = bounds ? Math.min( layout.maxTreads, Math.floor( ( bounds[ 3 ] - layout.wall - layout.deck - layout.landing ) / layout.going ) ) : 0;
				if ( bounds && ( treads < 3 || bounds[ 1 ] - bounds[ 0 ] < 1.7 ) ) return;
				const floor = top - treads * layout.rise, end = bounds ? bounds[ 3 ] - layout.wall : 0;
				const center = bounds ? ( bounds[ 0 ] + bounds[ 1 ] ) / 2 : 0;
				this.entrances.push( { id: `${kind}:${station.id}:${index}`, stationId: station.id, kind, label: station.name ?? station.id,
					origin: [ ...origin ], heading, top, floor, treads, bounds,
					machine: point( center, floor, end - layout.machine.depth / 2 ),
					arrival: point( center, floor + 0.03, bounds ? layout.deck + treads * layout.going + 0.38 : - 0.9 ),
					point } );
			} );
		}
	}
	/** Player guidance ends at the visible entrance; simulation retains its full network. */
	walk( network ) {
		const stations = new Set( this.entrances.map( entry => entry.stationId ).filter( id => network.nodes.some( node => node.kind === 'station-entrance' && node.ref === id ) ) );
		const nodes = network.nodes.filter( node => ! stations.has( node.ref ) || ! [ 'station', 'station-access', 'station-handoff' ].includes( node.kind ) )
			.map( node => stations.has( node.ref ) && node.kind === 'station-entrance' ? { ...node, kind: 'station' } : node );
		const ids = new Set( nodes.map( node => node.id ) );
		return { ...network, nodes, edges: network.edges.filter( edge => ! stations.has( edge.stationId ) && ids.has( edge.from ) && ids.has( edge.to ) ) };
	}
}

function groundTop( atlas, [ x, z ] ) {
	return ( atlas.volumetric?.ground ?? [] ).find( cover => [ 'sidewalk', 'block', 'open' ].includes( cover.surface ) && pointInRing( x, z, cover.polygon ) )?.top ?? SIDEWALK_HEIGHT;
}
