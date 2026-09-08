import { GroundPalette } from './GroundPalette.js';
import { fail } from './GroundRegions.js';
import { pair } from './PavingFrame.js';
import { signedArea } from './Polygons.js';

const ROLES = new Set( [ 'panel', 'joint', 'curb', 'gutter', 'gutter-lip', 'roadway', 'marking', 'guardrail' ] );

/** Validate the complete physical source before any tile can create materials. */
export class GroundModuleCatalog {

	constructor( atlas ) {

		const source = atlas.streets?.construction?.modules;
		this.active = source !== undefined;
		this.definitions = new Map();
		this.bindings = new Map();
		const covers = atlas.volumetric.ground.filter( cover => cover.moduleBlockId !== undefined );
		if ( ! this.active ) {

			if ( covers.length ) fail( 'Module planning covers have no physical definitions' );
			return;

		}
		if ( source?.version !== '1.0.0' || ! Array.isArray( source.definitions ) || ! Array.isArray( source.placements ) ) fail( 'Invalid street modules' );
		for ( const definition of source.definitions ) {

			if ( ! definition?.id || this.definitions.has( definition.id ) || ! Array.isArray( definition.parts ) || ! definition.parts.length ) fail( 'Invalid module definition' );
			for ( const part of definition.parts ) {

				if ( ! ROLES.has( part?.role ) || ! Array.isArray( part.polygon ) || part.polygon.length < 3 || ! part.polygon.every( pair )
					|| ! Number.isFinite( part.bottom ) || ! Number.isFinite( part.top ) || part.bottom > part.top || Math.abs( signedArea( part.polygon ) ) === 0 ) fail( `Invalid module prism: ${definition.id}` );

			}
			this.definitions.set( definition.id, definition );

		}
		const owners = new Set();
		for ( const placement of source.placements ) {

			const definition = this.definitions.get( placement.moduleId );
			if ( ! definition || ! placement.blockId || ! pair( placement.origin ) || ! Number.isInteger( placement.turn ) || placement.turn < 0 || placement.turn > 3
				|| ! Number.isSafeInteger( placement.count ) || placement.count < 1 || ! Number.isFinite( placement.step ) || placement.step <= 0 ) fail( 'Invalid module placement' );
			if ( ! Number.isFinite( ( placement.count - 1 ) * placement.step + Math.max( Math.abs( placement.origin[ 0 ] ), Math.abs( placement.origin[ 1 ] ) ) ) ) fail( 'Module repetition is not finite' );
			owners.add( placement.blockId );
			const id = `${placement.moduleId}:${placement.finish}`;
			if ( ! this.bindings.has( id ) ) {

				const bindings = new Map();
				for ( const { role } of definition.parts ) if ( role !== 'guardrail' ) bindings.set( role, GroundPalette.module( placement.finish, role ) );
				this.bindings.set( id, bindings );

			}

		}
		if ( covers.some( cover => ! owners.has( cover.moduleBlockId ) ) ) fail( 'Unknown module planning owner' );

	}

}
