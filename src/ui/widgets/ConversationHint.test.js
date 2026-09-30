// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationHint } from './ConversationHint.js';

const STORY = { title: 'Night shift', stake: 'The crew needs the missing report.' };
afterEach( () => { vi.useRealTimers(); document.body.replaceChildren(); } );

function hint() {
	const widget = new ConversationHint();
	document.body.append( widget.element );
	return widget;
}

describe( 'ConversationHint', () => {
	it( 'tracks new content, keeps identical refreshes read, and clears stale scenes on reset', () => {
		const widget = hint();
		expect( widget.element.hidden ).toBe( true );
		widget.setStory( STORY );
		expect( widget.unread ).toBe( true );
		widget.setOpen( true );
		expect( widget.unread ).toBe( false );
		widget.setOpen( false, { immediate: true } );
		widget.setStory( { ...STORY } );
		expect( widget.unread ).toBe( false );
		widget.setScene( 'A lamp burns beside the empty desk.' );
		expect( widget.unread ).toBe( true );
		widget.reset();
		expect( widget.element.hidden ).toBe( true );
		expect( widget.panel.hidden ).toBe( true );
		expect( widget.sceneText ).toBe( '' );
		widget.dispose();
	} );

	it( 'supports scene-only context, independent instances, and cancellation of an exit on reopen', () => {
		vi.useFakeTimers();
		const first = hint(), second = hint();
		first.setScene( 'At the gate.' );
		second.setStory( STORY );
		expect( first.panel.id ).not.toBe( second.panel.id );
		first.setOpen( true );
		first.setOpen( false );
		expect( first.panel.inert ).toBe( true );
		expect( first.panel.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		first.setOpen( true );
		vi.runAllTimers();
		expect( first.panel.hidden ).toBe( false );
		expect( second.open ).toBe( false );
		first.dispose(); second.dispose();
		expect( vi.getTimerCount() ).toBe( 0 );
	} );

	it( 'retains scroll and focus on updates and recovers focus if the journal goes away', () => {
		const widget = hint();
		widget.setStory( STORY );
		widget.setOpen( true );
		widget.body.scrollTop = 120;
		widget.journal.focus();
		widget.setStory( { ...STORY, objective: 'Find the courier.' } );
		expect( widget.body.scrollTop ).toBe( 120 );
		expect( document.activeElement ).toBe( widget.journal );
		widget.setStory( { ...STORY, journal: false } );
		expect( document.activeElement ).toBe( widget.close );
		widget.dispose();
	} );
} );
