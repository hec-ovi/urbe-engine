import { StationAccess } from './StationAccess.js';
import { TransitJourney } from './TransitJourney.js';
import layout from './station-layout.json' with { type: 'json' };

/** Immediate station-to-station travel through actual directed route stops. */
export class StationTravel {
	constructor( atlas, routes = [] ) {
		this.atlas = atlas;
		this.entrances = new StationAccess( atlas ).entrances;
		this.routes = new TransitJourney( { atlas, routes } ).valid ? routes : [];
	}
	near( position ) {
		if ( ! Array.isArray( position ) || position.length !== 3 || ! position.every( Number.isFinite ) ) return null;
		return this.entrances.find( entry => Math.abs( position[ 1 ] - entry.floor ) <= layout.terminalHeightTolerance
			&& Math.hypot( position[ 0 ] - entry.machine[ 0 ], position[ 2 ] - entry.machine[ 2 ] ) <= layout.terminalReach ) ?? null;
	}
	choices( position ) {
		const entry = this.near( position );
		if ( ! entry ) return [];
		const destinations = new Map();
		for ( const route of this.routes.filter( route => route.kind === entry.kind ) ) {
			const start = route.stops.findIndex( stop => stop.stopId === entry.stationId );
			if ( start < 0 ) continue;
			for ( const stop of route.stops.slice( start + 1 ) ) {
				if ( stop.stopId === entry.stationId || destinations.has( stop.stopId ) ) continue;
				const target = this.entrances.find( candidate => candidate.stationId === stop.stopId && candidate.kind === entry.kind );
				if ( target ) destinations.set( target.stationId, { originId: entry.id, destinationId: target.id, routeId: route.id, stationName: target.label, lineId: route.lineId } );
			}
		}
		return [ ...destinations.values() ].sort( ( a, b ) => a.stationName.localeCompare( b.stationName ) );
	}
	travel( selection, position ) {
		if ( ! selection || ! [ 'originId', 'destinationId', 'routeId', 'stationName', 'lineId' ].every( key => typeof selection[ key ] === 'string' )
			|| Object.keys( selection ).length !== 5 ) return { ok: false, error: 'E_TRANSIT_INVALID_DATA' };
		if ( ! new TransitJourney( { atlas: this.atlas, routes: this.routes } ).valid ) return { ok: false, error: 'E_TRANSIT_INVALID_DATA' };
		const entry = this.near( position );
		if ( ! entry || entry.id !== selection.originId ) return { ok: false, error: 'E_TRANSIT_OUT_OF_REACH' };
		const allowed = this.choices( position ).find( choice => Object.keys( choice ).every( key => choice[ key ] === selection[ key ] ) );
		if ( ! allowed ) return { ok: false, error: 'E_TRANSIT_ABSENT_ROUTE' };
		const target = this.entrances.find( candidate => candidate.id === allowed.destinationId );
		return { ok: true, position: [ ...target.arrival ], heading: target.heading,
			originStationId: entry.stationId, destinationStationId: target.stationId, routeId: allowed.routeId };
	}
}
