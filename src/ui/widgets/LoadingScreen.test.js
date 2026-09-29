// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/dom';
import Ajv from 'ajv/dist/2020.js';
import layout from './loading-layout.json' with { type: 'json' };
import schema from './loading-layout.schema.json' with { type: 'json' };
import { LoadingScreen } from './LoadingScreen.js';

const record = ( label, step = label, done = 0, total = 0, part = null ) => ( { label, step, done, total, part } );

describe( 'LoadingScreen', () => {

	let loading;

	beforeEach( () => {

		loading = new LoadingScreen();
		document.body.replaceChildren( loading.element );

	} );

	const percent = () => Number( screen.getByRole( 'progressbar', { name: 'Loading progress' } ).getAttribute( 'aria-valuenow' ) );
	const states = () => [ ...loading.element.querySelectorAll( '.hud-loading-milestone' ) ].map( ( item ) => item.dataset.state );

	it( 'reads its labels and milestones from a layout that meets its schema', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );

	} );

	it( 'opens on the logo, an empty dial and four pending milestones, the step line saying it starts', () => {

		expect( screen.getByRole( 'img', { name: 'urbe' } ).closest( '.hud-loading-title' ) ).toBeTruthy();
		expect( loading.line.textContent ).toBe( 'starting' );
		expect( percent() ).toBe( 0 );
		expect( states() ).toEqual( [ 'pending', 'pending', 'pending', 'pending' ] );
		expect( within( screen.getByRole( 'list', { name: 'Loading steps' } ) ).getAllByRole( 'listitem' ).map( ( item ) => item.getAttribute( 'aria-label' ) ) )
			.toEqual( [ '1. World and buildings: pending', '2. Light and people: pending', '3. City surfaces: pending', '4. First frame: pending' ] );
		expect( loading.error.hidden ).toBe( true );
		expect( screen.queryByRole( 'heading', { level: 2 } ) ).toBeNull();

	} );

	it( 'names what loads, counts the work units and moves the percentage and milestones by the steps it knows, never back', () => {

		loading.step( 'reading the world 0 / 15', record( 'reading the world', 'reading the world', 0, 15 ) );
		expect( loading.line.textContent ).toBe( 'reading the world' );
		expect( loading.count.textContent ).toBe( '0 / 15 work units' );
		expect( percent() ).toBe( 0 );
		expect( states() ).toEqual( [ 'active', 'pending', 'pending', 'pending' ] );

		loading.step( 'loading 128 buildings 3 / 15', record( 'loading 128 buildings', 'loading 128 buildings', 3, 15 ) );
		expect( percent() ).toBeGreaterThan( 0 );
		expect( states()[ 0 ] ).toBe( 'active' );
		loading.step( 'loading characters 4 / 15', record( 'loading characters', 'loading characters', 4, 15 ) );
		const characters = percent();
		expect( states() ).toEqual( [ 'done', 'active', 'pending', 'pending' ] );
		expect( screen.getByRole( 'listitem', { current: 'step' } ).getAttribute( 'aria-label' ) ).toBe( '2. Light and people: in progress' );

		// A pass the layout does not list fills the step it runs under by the units it adds.
		loading.step( 'baking the crowd 9 / 40', record( 'baking the crowd', 'loading characters', 9, 40, { done: 5, total: 25 } ) );
		expect( loading.line.textContent ).toBe( 'baking the crowd' );
		expect( loading.count.textContent ).toBe( '9 / 40 work units' );
		expect( percent() ).toBeGreaterThan( characters );
		const baking = percent();

		// A step reported again later, or fewer units, do not take the load back.
		loading.step( 'reading the world', record( 'reading the world', 'reading the world', 2, 40 ) );
		loading.step( 'baking the crowd 6 / 40', record( 'baking the crowd', 'loading characters', 6, 40 ) );
		expect( percent() ).toBe( baking );
		expect( states()[ 1 ] ).toBe( 'active' );

	} );

	it( 'fills a pass that runs group by group by the whole load\'s units, and treats a bare line as a label', () => {

		loading.step( 'warming the renderer' );
		const warming = percent();
		expect( states() ).toEqual( [ 'done', 'active', 'pending', 'pending' ] );
		loading.step( 'preparing city surfaces 10 / 90', record( 'preparing city surfaces', 'warming the renderer', 10, 90, { done: 0, total: 5 } ) );
		const surfaces = percent();
		expect( states() ).toEqual( [ 'done', 'done', 'active', 'pending' ] );
		// Each group's pass counts from nothing again; the load's own units go on.
		loading.step( 'preparing city surfaces 50 / 90', record( 'preparing city surfaces', 'warming the renderer', 50, 90, { done: 1, total: 5 } ) );
		expect( surfaces ).toBeGreaterThan( warming );
		expect( percent() ).toBeGreaterThan( surfaces );
		loading.step( 'pinning the programs 90 / 90', record( 'pinning the programs', 'preparing the first frame', 90, 90, { done: 0, total: 10 } ) );
		loading.step( 'pinning the programs 100 / 100', record( 'pinning the programs', 'preparing the first frame', 100, 100, { done: 10, total: 10 } ) );
		expect( percent() ).toBe( 99 );
		expect( states() ).toEqual( [ 'done', 'done', 'done', 'active' ] );

	} );

	it( 'names the game under the crystal, fills and hides when ready, and shows a failure with its reason', () => {

		loading.setPlace( '  Night   Shift ' );
		expect( screen.getByRole( 'heading', { name: 'Night Shift' } ) ).toBeTruthy();
		loading.setPlace( null );
		expect( screen.queryByRole( 'heading', { name: 'Night Shift' } ) ).toBeNull();

		loading.ready();
		expect( loading.element.hidden ).toBe( true );
		expect( loading.element.dataset.state ).toBe( 'ready' );
		expect( loading.bar.getAttribute( 'aria-valuenow' ) ).toBe( '100' );
		expect( states() ).toEqual( [ 'done', 'done', 'done', 'done' ] );

		loading.fail( 'no manifest' );
		expect( loading.element.hidden ).toBe( false );
		expect( loading.element.dataset.state ).toBe( 'error' );
		expect( loading.line.textContent ).toBe( 'could not start' );
		expect( screen.getByText( 'no manifest' ) ).toBe( loading.error );

	} );

} );
