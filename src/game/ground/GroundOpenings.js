import * as THREE from 'three/webgpu';
import { ringBounds, signedArea } from './Polygons.js';

const EPSILON = 1e-8;

/** Ground stops at the standing shells, whose world-space outlines may differ from their lots. */
export class GroundOpenings {

	constructor( { catalog = null, buildings = new Map() } = {} ) {

		const floors = catalog ? catalog.buildings.flatMap( building => building.bands.filter( band => band.bottom === 0 ) )
			: [ ...buildings.values() ].flatMap( building => ( building.blueprint?.floors ?? [] )
				.filter( floor => floor.index === 0 ).map( floor => ( { outline: floor.outline, bottom: floor.elevation, top: floor.elevation + floor.height } ) ) );
		this.openings = floors.map( floor => {

			const ring = signedArea( floor.outline ) > 0 ? floor.outline : [ ...floor.outline ].reverse();
			const convex = ring.every( ( point, i ) => side( ring[ ( i + ring.length - 1 ) % ring.length ], point, ring[ ( i + 1 ) % ring.length ] ) >= - EPSILON );
			const pieces = convex ? [ ring ] : THREE.ShapeUtils.triangulateShape( ring.map( ( [ x, z ] ) => new THREE.Vector2( x, z ) ), [] )
				.map( triangle => triangle.map( i => ring[ i ] ) );
			return { ...ringBounds( [ ring ] ), bottom: floor.bottom, top: floor.top, pieces };

		} );

	}

	/** Cut render or collision triangles at the same boundaries, interpolating their original attributes. */
	cut( geometry ) {

		if ( ! geometry || ! this.openings.length ) return geometry;
		geometry.computeBoundingBox();
		const box = geometry.boundingBox;
		const openings = this.openings.filter( opening => overlaps( opening, box.min.x, box.min.z, box.max.x, box.max.z )
			&& box.max.y >= opening.bottom && box.min.y < opening.top );
		if ( ! openings.length ) return geometry;

		const names = Object.keys( geometry.attributes );
		const attributes = names.map( name => geometry.getAttribute( name ) );
		const written = attributes.map( () => [] );
		const position = geometry.getAttribute( 'position' ), index = geometry.index;
		const offset = names.slice( 0, names.indexOf( 'position' ) ).reduce( ( n, name ) => n + geometry.getAttribute( name ).itemSize, 0 );
		for ( let at = 0; at < ( index?.count ?? position.count ); at += 3 ) {

			const triangle = [ 0, 1, 2 ].map( corner => {

				const vertex = index ? index.getX( at + corner ) : at + corner;
				return attributes.flatMap( attribute => Array.from( { length: attribute.itemSize }, ( _, component ) => attribute.getComponent( vertex, component ) ) );

			} );
			const x = triangle.map( vertex => vertex[ offset ] ), y = triangle.map( vertex => vertex[ offset + 1 ] ), z = triangle.map( vertex => vertex[ offset + 2 ] );
			let pieces = [ triangle ];
			for ( const opening of openings ) {

				// Ground is horizontal or a short curb wall: only the building's occupied vertical band can replace it.
				if ( Math.max( ...y ) < opening.bottom || Math.min( ...y ) >= opening.top
					|| ! overlaps( opening, Math.min( ...x ), Math.min( ...z ), Math.max( ...x ), Math.max( ...z ) ) ) continue;
				for ( const ring of opening.pieces ) pieces = pieces.flatMap( piece => subtract( piece, ring, offset ) );
				if ( ! pieces.length ) break;

			}
			for ( const piece of pieces ) for ( let corner = 1; corner + 1 < piece.length; corner ++ ) {

				const fan = [ piece[ 0 ], piece[ corner ], piece[ corner + 1 ] ];
				if ( degenerate( fan, offset ) ) continue;
				for ( const vertex of fan ) {

					let component = 0;
					attributes.forEach( ( attribute, i ) => {

						for ( let j = 0; j < attribute.itemSize; j ++ ) written[ i ].push( vertex[ component ++ ] );

					} );

				}

			}

		}
		if ( ! written[ 0 ].length ) return null;
		const clipped = new THREE.BufferGeometry();
		attributes.forEach( ( attribute, i ) => clipped.setAttribute( names[ i ], new THREE.Float32BufferAttribute( written[ i ], attribute.itemSize ) ) );
		if ( index ) clipped.setIndex( Array.from( { length: clipped.getAttribute( 'position' ).count }, ( _, i ) => i ) );
		return clipped;

	}

}

/** The outside half-plane of each edge, after all preceding inside planes: disjoint convex pieces. */
function subtract( polygon, ring, offset ) {

	const outside = [];
	let inside = polygon;
	for ( let edge = 0; edge < ring.length && inside.length; edge ++ ) {

		const a = ring[ edge ], b = ring[ ( edge + 1 ) % ring.length ];
		const distances = inside.map( vertex => side( a, b, [ vertex[ offset ], vertex[ offset + 2 ] ] ) );
		if ( distances.every( distance => distance >= - EPSILON ) ) continue;
		if ( distances.every( distance => distance <= EPSILON ) ) { outside.push( inside ); return outside; }
		const kept = [], removed = [];
		for ( let i = 0; i < inside.length; i ++ ) {

			const next = ( i + 1 ) % inside.length, here = inside[ i ], there = inside[ next ];
			const from = distances[ i ], to = distances[ next ];
			if ( from >= - EPSILON ) kept.push( here );
			if ( from <= EPSILON ) removed.push( here );
			if ( from > EPSILON && to < - EPSILON || from < - EPSILON && to > EPSILON ) {

				const t = from / ( from - to ), point = here.map( ( value, i ) => value + t * ( there[ i ] - value ) );
				kept.push( point ); removed.push( point );

			}

		}
		if ( removed.length >= 3 ) outside.push( removed );
		inside = kept.length >= 3 ? kept : [];

	}
	return outside;

}

function side( a, b, p ) { return ( b[ 0 ] - a[ 0 ] ) * ( p[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( p[ 0 ] - a[ 0 ] ); }
function degenerate( [ a, b, c ], offset ) {

	const u = [ 0, 1, 2 ].map( i => b[ offset + i ] - a[ offset + i ] );
	const v = [ 0, 1, 2 ].map( i => c[ offset + i ] - a[ offset + i ] );
	return ( u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ] ) ** 2 + ( u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ] ) ** 2
		+ ( u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ) ** 2 < EPSILON ** 2;

}

function overlaps( bounds, x0, z0, x1, z1 ) {

	return bounds.min[ 0 ] < x1 - EPSILON && bounds.max[ 0 ] > x0 + EPSILON
		&& bounds.min[ 1 ] < z1 - EPSILON && bounds.max[ 1 ] > z0 + EPSILON;

}
