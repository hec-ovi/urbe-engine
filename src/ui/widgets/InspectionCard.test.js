// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { InspectionCard } from './InspectionCard.js';

it( 'keeps authored paragraphs readable, traps focus, and distinguishes click from Escape', async () => {
	const onOpen = vi.fn(), onClose = vi.fn();
	const card = new InspectionCard( { onOpen, onClose } );
	document.body.replaceChildren( card.element );
	card.show( { title: 'Read the ledger.', text: 'First entry.\n\nSecond entry.' } );
	expect( onOpen ).toHaveBeenCalledOnce();
	expect( card.text.children ).toHaveLength( 2 );
	expect( document.activeElement ).toBe( card.done );
	const user = userEvent.setup();
	await user.tab();
	expect( document.activeElement ).toBe( card.close );
	await user.tab( { shift: true } );
	expect( document.activeElement ).toBe( card.done );
	await user.keyboard( '{Escape}' );
	expect( card.element.hidden ).toBe( true );
	expect( onClose ).toHaveBeenLastCalledWith( { pointer: false } );
	card.show( { title: 'Evidence inspected', text: 'An actual scene clue.' } );
	await user.click( card.done );
	expect( onClose ).toHaveBeenLastCalledWith( { pointer: true } );
} );
