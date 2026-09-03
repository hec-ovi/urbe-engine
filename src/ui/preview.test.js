// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubCanvas } from './test-helpers/canvas.js';
import previewHtml from './preview.html?raw';

describe( 'UI preview', () => {

	beforeEach( () => {

		document.body.replaceChildren();
		stubCanvas();
		vi.useFakeTimers();

	} );

	afterEach( () => {

		vi.useRealTimers();
		delete window.view;

	} );

	it( 'mounts the complete sample UI and opens on the game directory', async () => {

		await import( './preview.js' );

		expect( window.view.mainMenu.element.hidden ).toBe( false );
		expect( document.querySelector( '.game-library-card h3' ).textContent ).toBe( 'Salt Wharf' );
		expect( window.view.map.blocks.geometry.getAttribute( 'position' ).count ).toBeGreaterThan( 0 );
		expect( previewHtml ).toContain( 'name="viewport" content="width=device-width, initial-scale=1"' );

	} );

} );
