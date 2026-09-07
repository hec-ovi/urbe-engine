// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { count, stubCanvas } from '../test-helpers/canvas.js';
import { MAP_COLORS } from './MapPainter.js';
import { MinimapView } from './MinimapView.js';

const MAP = {
	bounds: { min: [ 0, 0 ], max: [ 100, 100 ] },
	roads: [ { path: [ [ 0, 50 ], [ 100, 50 ] ], width: 8 } ],
	blocks: [ [ [ 10, 10 ], [ 40, 10 ], [ 40, 40 ], [ 10, 40 ] ] ],
	transit: {
		routes: [ { id: 'train-1', kind: 'train', path: [ [ 0, 20 ], [ 100, 20 ] ] } ],
		places: [ { id: 'train:t0:0', refId: 't0', kind: 'train', point: [ 25, 20 ] } ]
	}
};

/** The corner map blits the baked city once per update and marks venues live. */
describe( 'MinimapView', () => {

	let view;

	beforeEach( () => {

		stubCanvas();
		view = new MinimapView();
		document.body.replaceChildren( view.element );

	} );

	it( 'update blits the bake around the player and paints venues by state', () => {

		view.setMap( MAP );
		view.setVenues( [ { point: { x: 50, z: 50 }, open: true }, { point: { x: 52, z: 52 }, open: false } ] );
		view.update( { x: 50, z: 50 }, 0 );

		expect( count( view.context, 'drawImage' ) ).toBe( 1 );
		expect( view.context.calls ).toContainEqual( [ 'set', 'fillStyle', MAP_COLORS.venueOpen ] );
		expect( view.context.calls ).toContainEqual( [ 'set', 'fillStyle', MAP_COLORS.venueShut ] );

	} );

	it( 'bakes generated transit routes and station entries into the city layer', () => {

		view.setMap( MAP );

		expect( view.bake.context.calls ).toContainEqual( [ 'set', 'strokeStyle', MAP_COLORS.train ] );
		expect( view.bake.context.calls ).toContainEqual( [ 'strokeRect', 100.5, 92.5, 7, 7 ] );

	} );

	it( 'toggle hides it and a hidden map draws nothing', () => {

		view.setMap( MAP );
		view.toggle();
		view.update( { x: 0, z: 0 }, 0 );

		expect( view.element.hidden ).toBe( true );
		expect( count( view.context, 'drawImage' ) ).toBe( 0 );

	} );

	it( 'draws and clears the active objective route', () => {

		view.setMap( MAP );
		view.setRoute( { path: [ [ 45, 50 ], [ 50, 50 ], [ 60, 55 ] ], label: 'reach p9' } );
		view.update( { x: 45, z: 50 }, 0 );

		expect( view.context.calls ).toContainEqual( [ 'set', 'strokeStyle', MAP_COLORS.route ] );
		expect( count( view.context, 'stroke' ) ).toBeGreaterThan( 0 );
		expect( view.context.calls ).toContainEqual( [ 'set', 'fillStyle', MAP_COLORS.marker ] );

		view.context.calls.length = 0;
		view.setRoute( null );
		view.update( { x: 45, z: 50 }, 0 );
		expect( view.context.calls ).not.toContainEqual( [ 'set', 'strokeStyle', MAP_COLORS.route ] );

	} );
	it.each( [
		[ 'north', 0, [ 95, 15 ] ],
		[ 'west', Math.PI / 2, [ 175, 95 ] ],
		[ 'south', Math.PI, [ 95, 175 ] ],
		[ 'east', - Math.PI / 2, [ 15, 95 ] ],
		[ 'northwest', Math.PI / 4, [ 151.568542, 38.431458 ] ]
	] )( 'keeps forward above and right to the right while facing %s', ( _, heading, north ) => {
		const ahead = [ 50 - Math.sin( heading ) * 20, 50 - Math.cos( heading ) * 20 ];
		const right = [ 50 + Math.cos( heading ) * 20, 50 - Math.sin( heading ) * 20 ];
		view.setMap( MAP );
		view.setVenues( [ { point: { x: ahead[ 0 ], z: ahead[ 1 ] }, open: true }, { point: { x: right[ 0 ], z: right[ 1 ] }, open: false } ] );
		view.setRoute( { path: [ [ 50, 50 ], ahead ], label: 'forward' } );
		view.update( { x: 50, z: 50 }, heading );

		const calls = view.context.calls;
		const dots = calls.filter( ( [ name, , , width ] ) => name === 'fillRect' && width === 4 );
		closePoint( dots[ 0 ].slice( 1, 3 ), [ 93, 61 ] );
		closePoint( dots[ 1 ].slice( 1, 3 ), [ 125, 93 ] );
		closePoint( calls.find( ( [ name ] ) => name === 'lineTo' ).slice( 1 ), [ 95, 63 ] );
		closePoint( paintedPoint( calls, view.bake.toPixels( ...ahead ) ), [ 95, 63 ] );
		closePoint( calls.find( ( [ name ] ) => name === 'fillText' ).slice( 2 ), north );
		closePoint( calls.filter( ( [ name ] ) => name === 'moveTo' ).at( - 1 ).slice( 1 ), [ 95, 88 ] );
		expect( view.canvas.getAttribute( 'aria-label' ) ).toBe( 'Local map, forward at the top' );
	} );

} );

function closePoint( actual, expected ) {
	for ( let i = 0; i < 2; i ++ ) expect( actual[ i ] ).toBeCloseTo( expected[ i ], 5 );
}

/** Apply the recorded canvas transform to a landmark inside the city image. */
function paintedPoint( calls, point ) {
	let matrix = [ 1, 0, 0, 1, 0, 0 ];
	const stack = [];
	for ( const [ name, x, y, z ] of calls ) {
		const [ a, b, c, d, e, f ] = matrix;
		if ( name === 'save' ) stack.push( [ ...matrix ] );
		if ( name === 'restore' ) matrix = stack.pop();
		if ( name === 'translate' ) matrix = [ a, b, c, d, e + a * x + c * y, f + b * x + d * y ];
		if ( name === 'rotate' ) {
			const cosine = Math.cos( x ), sine = Math.sin( x );
			matrix = [ a * cosine + c * sine, b * cosine + d * sine, c * cosine - a * sine, d * cosine - b * sine, e, f ];
		}
		if ( name === 'drawImage' ) return [ a * ( point[ 0 ] + y ) + c * ( point[ 1 ] + z ) + e, b * ( point[ 0 ] + y ) + d * ( point[ 1 ] + z ) + f ];
	}
	throw new Error( 'No city image painted' );
}
