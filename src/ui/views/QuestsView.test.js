// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { QuestsView } from './QuestsView.js';

const QUESTS = [
	{ id: 'q1', title: 'Salt Wharf', text: 'Find who moved the crates.', state: 'active', steps: [ { text: 'Talk to Ada', done: true }, { text: 'Check the quay', done: false } ] },
	{ id: 'q2', title: 'Late shift', text: 'Cover the bar.', state: 'done', steps: [] }
];

/** The quest log: empty wording, the list, and the picked quest's steps. */
describe( 'QuestsView', () => {

	it( 'says no quest yet, then lists quests, opens the first and marks steps done', async () => {

		const view = new QuestsView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );
		expect( screen.getByText( 'no quest yet' ) ).toBeTruthy();

		view.setQuests( QUESTS );
		expect( screen.getByRole( 'heading', { name: 'Salt Wharf' } ) ).toBeTruthy();
		expect( screen.getByText( 'Talk to Ada' ).closest( 'li' ).classList.contains( 'is-done' ) ).toBe( true );
		expect( screen.getByText( 'Check the quay' ).closest( 'li' ).classList.contains( 'is-done' ) ).toBe( false );

		const lateShift = screen.getByRole( 'button', { name: /Late shift/ } );
		await userEvent.setup().click( lateShift );
		expect( screen.getByRole( 'heading', { name: 'Late shift' } ) ).toBeTruthy();
		expect( screen.getByText( 'Cover the bar.' ) ).toBeTruthy();
		expect( lateShift.getAttribute( 'aria-pressed' ) ).toBe( 'true' );

	} );

	it( 'reports the picked quest, badges a side job on offer, and says who, where and when a step is closed', async () => {

		const onSelect = vi.fn();
		const view = new QuestsView( { onClose: vi.fn(), onSelect } );
		document.body.replaceChildren( view.element );

		view.setQuests( [ ...QUESTS, {
			id: 'q3', title: 'Oxide Filter', text: 'Denna saved the cups.', state: 'available',
			steps: [ {
				text: 'Hear Denna out about the cups.', done: false, npcName: 'Denna Roe',
				place: { kind: 'parcel', id: 'p0', name: 'Oxide Filter' },
				availability: { available: false, reason: 'outside_window', text: 'This objective is open at another hour. Open 18:00 to 23:00.' },
				window: { label: 'during the slow hour', days: [ 0 ], startMin: 1080, endMin: 1380 }
			} ]
		} ] );
		expect( onSelect ).not.toHaveBeenCalled();

		const offered = screen.getByRole( 'button', { name: /Oxide Filter/ } );
		expect( offered.textContent ).toContain( 'available' );
		await userEvent.setup().click( offered );
		expect( onSelect ).toHaveBeenCalledWith( 'q3' );

		const step = screen.getByText( 'Hear Denna out about the cups.' ).closest( 'li' );
		expect( step.classList.contains( 'is-closed' ) ).toBe( true );
		expect( step.textContent ).toContain( 'Denna Roe - Oxide Filter' );
		expect( step.textContent ).toContain( 'This objective is open at another hour. Open 18:00 to 23:00.' );
		expect( step.textContent ).toContain( 'Open during the slow hour, 18:00 to 23:00' );

	} );

	it( 'keeps inspection separate from following and cannot follow completed or blocked quests', async () => {

		const onSelect = vi.fn();
		const onTrack = vi.fn();
		const view = new QuestsView( { onClose: vi.fn(), onSelect, onTrack } );
		document.body.replaceChildren( view.element );
		view.setQuests( [ ...QUESTS,
			{ id: 'q3', title: 'Night delivery', state: 'available', steps: [] },
			{ id: 'q4', title: 'Missing contact', state: 'blocked', note: 'The contact is unavailable.', steps: [] }
		] );
		view.setTrackedQuest( 'q1' );
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: /Night delivery/ } ) );
		expect( onSelect ).toHaveBeenCalledWith( 'q3' );
		expect( onTrack ).not.toHaveBeenCalled();
		expect( screen.getByRole( 'button', { name: /Salt Wharf/ } ).textContent ).toContain( 'Following' );
		await user.click( screen.getByRole( 'button', { name: 'Follow quest' } ) );
		expect( onTrack ).toHaveBeenCalledExactlyOnceWith( 'q3' );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Following' } ) );
		expect( screen.getByRole( 'button', { name: /Night delivery/ } ).textContent ).toContain( 'Following' );
		expect( screen.getByRole( 'button', { name: /Salt Wharf/ } ).textContent ).not.toContain( 'Following' );

		for ( const title of [ 'Late shift', 'Missing contact' ] ) {

			await user.click( screen.getByRole( 'button', { name: new RegExp( title ) } ) );
			expect( screen.queryByRole( 'button', { name: 'Follow quest' } ) ).toBeNull();
			expect( view.tracked ).toBe( 'q3' );

		}
		expect( onTrack ).toHaveBeenCalledTimes( 1 );
		view.setTrackedQuest( 'q2' );
		expect( view.tracked ).toBeNull();

	} );

	it( 'shows terminal objectives as alternatives with their commitments and leaves history apart', () => {

		const view = new QuestsView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );
		view.setQuests( [ {
			id: 'choice', title: 'The evidence', state: 'active', steps: [
				{ text: 'Find the recording.', done: true, state: 'done' },
				{ text: 'Take the recording to Ada.', state: 'active', endingId: 'public', endingTitle: 'On record', commitment: 'Put it on record.', stake: 'Ada risks her job.', npcName: 'Ada', place: { name: 'The precinct' } },
				{ text: 'Meet the buyer.', state: 'locked', endingId: 'private', endingTitle: 'A private deal', commitment: 'I accept your offer.', availability: { available: false, text: 'The buyer returns at 18:00.' } }
			]
		} ] );

		expect( screen.getByRole( 'heading', { name: 'Choose how this ends' } ) ).toBeTruthy();
		expect( screen.getByText( 'OR' ) ).toBeTruthy();
		expect( screen.getByText( 'On record OR A private deal' ) ).toBeTruthy();
		expect( screen.getByText( 'Commit by choosing: “I accept your offer.”' ) ).toBeTruthy();
		expect( screen.getByText( 'The buyer returns at 18:00.' ) ).toBeTruthy();
		expect( screen.getByText( 'Ada - The precinct' ) ).toBeTruthy();
		expect( screen.getByText( 'Find the recording.' ).closest( 'details' ).open ).toBe( false );
		expect( view.main.textContent.indexOf( 'Choose how this ends' ) ).toBeLessThan( view.main.textContent.indexOf( 'Quest history' ) );

		view.setQuests( [ { id: 'choice', title: 'The evidence', state: 'done', steps: [
			{ text: 'Take the recording to Ada.', state: 'done', done: true },
			{ text: 'Meet the buyer.', state: 'cancelled', done: false, availability: { available: false } }
		] } ] );
		expect( screen.queryByRole( 'heading', { name: 'Choose how this ends' } ) ).toBeNull();
		expect( screen.getByText( 'Cancelled' ) ).toBeTruthy();
		expect( screen.getByText( 'Meet the buyer.' ).closest( 'li' ).classList.contains( 'is-closed' ) ).toBe( false );
		expect( screen.getByText( 'Meet the buyer.' ).closest( 'details' ).open ).toBe( true );

	} );

	it( 'follows Ilona’s ending lead without committing it and can return to following the whole quest', async () => {

		const onTrack = vi.fn();
		const onSelect = vi.fn();
		const view = new QuestsView( { onClose: vi.fn(), onTrack, onSelect } );
		document.body.replaceChildren( view.element );
		const quest = {
			id: 'q_weir_line', title: 'The Weir Line', state: 'active', steps: [
				{ stepId: 's_expose', text: 'Give everything to Cross.', state: 'active', done: false, endingId: 'record', endingTitle: 'On the Record', availability: { available: true } },
				{ stepId: 's_sellout', text: 'Hear Ilona’s offer.', state: 'active', done: false, endingId: 'payout', endingTitle: 'The Payout', availability: { available: true } }
			]
		};
		const before = structuredClone( quest );
		view.setQuests( [ quest ] );
		view.setTrackedQuest( quest.id );
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'Follow this lead: The Payout' } ) );
		expect( onTrack ).toHaveBeenCalledExactlyOnceWith( 'q_weir_line', 's_sellout' );
		expect( onSelect ).not.toHaveBeenCalled();
		expect( quest ).toEqual( before );
		expect( view.trackedStepId ).toBe( 's_sellout' );
		const followed = screen.getByRole( 'button', { name: 'Following this lead: The Payout' } );
		expect( followed.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( document.activeElement ).toBe( followed );
		expect( screen.getByRole( 'button', { name: /The Weir Line/ } ).textContent ).toContain( 'Following' );
		expect( screen.getByRole( 'button', { name: 'Follow this lead: On the Record' } ).getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		await user.click( followed );
		expect( onTrack ).toHaveBeenCalledTimes( 1 );

		await user.click( screen.getByRole( 'button', { name: 'Follow quest' } ) );
		expect( onTrack.mock.calls ).toEqual( [ [ 'q_weir_line', 's_sellout' ], [ 'q_weir_line' ] ] );
		expect( view.trackedStepId ).toBeNull();
		expect( screen.getByRole( 'button', { name: 'Following' } ) ).toBeTruthy();
		view.setTrackedQuest( quest.id, 's_sellout' );
		expect( screen.getByRole( 'button', { name: 'Following this lead: The Payout' } ) ).toBeTruthy();
		view.setTrackedQuest( quest.id );
		expect( view.trackedStepId ).toBeNull();

	} );

	it( 'can navigate to a waiting lead without committing it, but cannot follow a finished or blocked quest', async () => {

		const onTrack = vi.fn();
		const view = new QuestsView( { onClose: vi.fn(), onTrack } );
		document.body.replaceChildren( view.element );
		const quest = {
			id: 'choice', title: 'The evidence', state: 'active', steps: [
				{ stepId: 'record', text: 'Put it on record.', state: 'active', endingId: 'public', endingTitle: 'On record' },
				{ stepId: 'offer', text: 'Hear the offer.', state: 'locked', endingId: 'private', endingTitle: 'The deal', availability: { available: false, text: 'Come back at 18:00.' } }
			]
		};
		view.setQuests( [ quest ] );
		const blockedLead = screen.getByRole( 'button', { name: 'Follow this lead: The deal' } );
		expect( blockedLead.disabled ).toBe( false );
		await userEvent.setup().click( blockedLead );
		expect( onTrack ).toHaveBeenCalledWith( quest.id, 'offer' );
		expect( quest.steps[ 1 ].state ).toBe( 'locked' );
		onTrack.mockClear();
		view.setTrackedQuest( quest.id, 'offer' );
		// Reporting the HUD's existing choice retains it across a closing hour.
		expect( view.trackedStepId ).toBe( 'offer' );
		expect( screen.getByRole( 'button', { name: 'Following this lead: The deal' } ).disabled ).toBe( false );

		view.setQuests( [ { ...quest, state: 'blocked' } ] );
		const blockedQuest = screen.getByRole( 'button', { name: 'Follow this lead: On record' } );
		expect( blockedQuest.disabled ).toBe( true );
		await userEvent.setup().click( blockedQuest );
		view.setTrackedQuest( quest.id, 'record' );
		expect( view.tracked ).toBeNull();
		expect( onTrack ).not.toHaveBeenCalled();

		view.setQuests( [ { ...quest, state: 'done', steps: quest.steps.map( ( step, index ) => ( {
			...step, state: index ? 'cancelled' : 'done', done: index === 0
		} ) ) } ] );
		expect( screen.queryByRole( 'button', { name: /Follow this lead/ } ) ).toBeNull();
		view.setTrackedQuest( quest.id, 'record' );
		expect( view.tracked ).toBeNull();
		expect( view.trackedStepId ).toBeNull();

	} );

	it( 'offers the next opening as a wait intent without changing the clock metadata, progress, or followed lead', async () => {

		const onWait = vi.fn(), onTrack = vi.fn();
		const view = new QuestsView( { onClose: vi.fn(), onWait, onTrack } );
		document.body.replaceChildren( view.element );
		const quest = {
			id: 'q_weir_line', title: 'The Weir Line', state: 'active', steps: [ {
				stepId: 's_listen', text: 'Listen at Zenith Dining.', state: 'locked', done: false,
				availability: { available: false, reason: 'outside_window', text: 'Lunch has finished for today.' },
				wait: { timeMin: 1920, label: 'Tue 08:00' }
			} ]
		};
		const before = structuredClone( quest );
		view.setQuests( [ quest ] );
		view.setTrackedQuest( quest.id, 's_listen' );
		expect( screen.getByText( 'Advances the world clock; quest progress is unchanged.' ) ).toBeTruthy();
		const button = screen.getByRole( 'button', { name: 'Wait until Tue 08:00' } );
		button.focus();
		await userEvent.setup().keyboard( '{Enter}' );
		expect( onWait ).toHaveBeenCalledExactlyOnceWith( 'q_weir_line', 's_listen' );
		expect( onTrack ).not.toHaveBeenCalled();
		expect( quest ).toEqual( before );
		expect( view.trackedStepId ).toBe( 's_listen' );
		view.setQuests( [ structuredClone( quest ) ] );
		expect( view.trackedStepId ).toBe( 's_listen' );

	} );

	it( 'offers waiting on a timed ending alternative but never for other blockers, completed steps, or blocked quests', () => {

		const view = new QuestsView( { onClose: vi.fn(), onWait: vi.fn() } );
		document.body.replaceChildren( view.element );
		const timed = {
			stepId: 'meet', text: 'Meet the buyer.', state: 'locked', done: false,
			availability: { available: false, reason: 'outside_window', text: 'Return tomorrow.' },
			wait: { timeMin: 1920, label: 'Tue 08:00' }
		};
		const quest = { id: 'q', title: 'The offer', state: 'active', steps: [
			{ ...timed, endingId: 'private', endingTitle: 'The deal' },
			{ stepId: 'report', text: 'Report the evidence.', state: 'active', endingId: 'public', endingTitle: 'On record' }
		] };
		view.setQuests( [ quest ] );
		expect( screen.getByRole( 'button', { name: 'Wait until Tue 08:00' } ).closest( '.quest-alternatives' ) ).toBeTruthy();
		for ( const step of [
			{ ...timed, availability: { available: false, reason: 'role_dead' } },
			{ ...timed, availability: { available: false, reason: 'missing_item' } },
			{ ...timed, state: 'active', availability: { available: true } },
			{ ...timed, state: 'done', done: true },
			{ ...timed, state: 'cancelled' },
			{ ...timed, wait: null }
		] ) {

			view.setQuests( [ { ...quest, steps: [ step ] } ] );
			expect( screen.queryByRole( 'button', { name: /Wait until/ } ) ).toBeNull();

		}
		view.setQuests( [ { ...quest, state: 'blocked' } ] );
		expect( screen.queryByRole( 'button', { name: /Wait until/ } ) ).toBeNull();

	} );

} );
