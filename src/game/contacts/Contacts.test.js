import { describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from './schema/contacts.schema.json' with { type: 'json' };
import { ContactBook } from './ContactBook.js';
import { CallSession, RING_SECONDS, answerOf, contactLines, givesNumber } from './Calls.js';
import { LINGER_SECONDS, PhoneCalls } from './PhoneCalls.js';

describe( 'ContactBook', () => {

	it( 'keeps who gave their number and when, in order, and saves and loads as its schema says', () => {

		const book = new ContactBook();
		book.add( 'npc-ada', 725 );
		book.add( 'npc-kip', 800.5 );
		book.add( 'npc-ada', 900 );
		expect( book.has( 'npc-ada' ) ).toBe( true );
		expect( book.has( 'npc-zed' ) ).toBe( false );
		expect( book.get( 'npc-ada' ) ).toEqual( { npcId: 'npc-ada', addedMin: 725 } );
		expect( book.size ).toBe( 2 );

		const saved = book.serialize();
		expect( saved ).toEqual( [ { npcId: 'npc-ada', addedMin: 725 }, { npcId: 'npc-kip', addedMin: 800.5 } ] );
		const validate = new Ajv2020( { strict: true } ).compile( schema );
		expect( validate( saved ) ).toBe( true );
		expect( validate( [ { npcId: 'npc-ada' } ] ) ).toBe( false );

		const loaded = new ContactBook().restore( [ ...saved, { npcId: 'npc-kip', addedMin: 999 } ] );
		expect( loaded.list() ).toEqual( saved );
		expect( new ContactBook().restore().size ).toBe( 0 );

	} );

} );

describe( 'Calls', () => {

	it( 'gives the number only as a friendly person would when nobody can ask the model', () => {

		expect( givesNumber( 'friendly' ) ).toBe( true );
		for ( const disposition of [ 'neutral', 'wary', 'hostile' ] ) expect( givesNumber( disposition ) ).toBe( false );

	} );

	it( 'answers a call by who the person is and what their day has them doing', () => {

		const npc = { npcId: 'npc-ada', flags: {} };
		expect( answerOf( { npc, disposition: 'neutral', activity: 'leisure' } ) ).toBe( 'answered' );
		expect( answerOf( { npc, disposition: 'wary', activity: 'home' } ) ).toBe( 'answered' );
		expect( answerOf( { npc, disposition: 'friendly', activity: 'sleeping' } ) ).toBe( 'no-answer' );
		expect( answerOf( { npc, disposition: 'hostile', activity: 'leisure' } ) ).toBe( 'declined' );
		expect( answerOf( { npc, disposition: 'neutral', activity: 'working' } ) ).toBe( 'busy' );
		expect( answerOf( { npc, disposition: 'friendly', activity: 'working' } ) ).toBe( 'answered' );
		expect( answerOf( { npc: { flags: { dead: true } }, disposition: 'friendly', activity: 'home' } ) ).toBe( 'no-answer' );
		expect( answerOf( { npc: null, disposition: null, activity: null } ) ).toBe( 'no-answer' );

	} );

	it( 'rings, then takes the answer; a connected call counts the time talked, a busy one hangs up by itself', () => {

		const call = new CallSession( { npcId: 'npc-ada', answer: 'answered' } );
		expect( call.status ).toBe( 'connecting' );
		expect( call.update( RING_SECONDS / 2 ) ).toBeNull();
		expect( call.live ).toBe( true );
		expect( call.update( RING_SECONDS / 2 ) ).toBe( 'connected' );
		call.update( 61.4 );
		expect( call.duration ).toBe( '1:01' );
		expect( call.hangUp() ).toBe( 'ended' );
		expect( call.live ).toBe( false );
		expect( call.endedAt ).toBeCloseTo( RING_SECONDS + 61.4 );
		expect( call.hangUp() ).toBeNull();

		const busy = new CallSession( { npcId: 'npc-kip', answer: 'busy' } );
		expect( busy.update( RING_SECONDS ) ).toBe( 'busy' );
		expect( busy.live ).toBe( true );
		expect( busy.update( 10 ) ).toBe( 'ended' );

		const asleep = new CallSession( { npcId: 'npc-zed', answer: 'no-answer' } );
		expect( asleep.update( RING_SECONDS ) ).toBe( 'no-answer' );
		expect( asleep.live ).toBe( false );
		expect( asleep.hangUp() ).toBeNull();

	} );

	it( 'reads every contact and call line, the same way for the same person and minute', () => {

		const lines = contactLines();
		expect( lines.say( 'label-contact' ) ).toBe( 'Can I have your number?' );
		expect( lines.say( 'call-greeting', {}, 'npc-ada|725' ) ).toBe( lines.say( 'call-greeting', {}, 'npc-ada|725' ) );
		for ( const key of [ 'accept-contact', 'refuse-contact-hostile', 'refuse-contact-wary', 'refuse-contact-neutral', 'call-busy', 'notice-contact', 'name-here' ] ) {

			expect( lines.say( key, {}, 'seed' ).length ).toBeGreaterThan( 0 );

		}
		expect( () => contactLines( '## label-contact\n\n- Number?\n' ) ).toThrow( /lack/ );

	} );

} );

describe( 'PhoneCalls', () => {

	function phone( answer = 'answered', opens = true ) {

		const view = { setContact: vi.fn(), setState: vi.fn(), setPresentation: vi.fn(), setVisible: vi.fn() };
		const conversation = { npcId: 'npc-ada', call: true };
		const calls = new PhoneCalls( {
			view,
			answerOf: () => answer,
			open: vi.fn( () => opens ? conversation : null ),
			close: vi.fn(),
			contactOf: () => ( { name: 'Ada Vance', role: 'Clerk', handle: 'A. VANCE' } ),
			portraitOf: () => Promise.resolve( 'blob:ada' ),
			reach: () => ( { relay: 'Old Quay', signal: 0.8 } ),
			busyLine: () => 'I am at work.'
		} );
		return { calls, view };

	}

	it( 'rings, opens the talk over the phone once picked up, and hangs up on the player or the chat', async () => {

		const { calls, view } = phone();
		calls.call( 'npc-ada' );
		expect( view.setContact ).toHaveBeenCalledWith( { name: 'Ada Vance', role: 'Clerk', handle: 'A. VANCE' } );
		expect( view.setState ).toHaveBeenLastCalledWith( { status: 'connecting', duration: '0:00', relay: 'Old Quay', signal: 0.8, line: '' } );
		expect( view.setVisible ).toHaveBeenLastCalledWith( true );
		await vi.waitFor( () => expect( view.setContact ).toHaveBeenLastCalledWith( expect.objectContaining( { portraitUrl: 'blob:ada' } ) ) );
		expect( calls.live ).toBe( true );

		calls.update( RING_SECONDS );
		expect( calls.open ).toHaveBeenCalledExactlyOnceWith( 'npc-ada' );
		expect( view.setState ).toHaveBeenLastCalledWith( expect.objectContaining( { status: 'connected' } ) );
		calls.update( 0.2 );
		const shown = view.setState.mock.calls.length;
		calls.update( 0.2 );
		expect( view.setState ).toHaveBeenCalledTimes( shown );
		calls.update( 1 );
		expect( view.setState ).toHaveBeenLastCalledWith( expect.objectContaining( { duration: '0:01' } ) );

		calls.hangUp();
		expect( calls.close ).toHaveBeenCalledOnce();
		expect( view.setState ).toHaveBeenLastCalledWith( expect.objectContaining( { status: 'ended' } ) );
		calls.closed( 'npc-ada' );
		expect( calls.close ).toHaveBeenCalledOnce();

		calls.update( LINGER_SECONDS + 0.1 );
		expect( view.setVisible ).toHaveBeenLastCalledWith( false );
		expect( calls.npcId ).toBeNull();

	} );

	it( 'shows what a busy person says, a call nobody picks up, and one the talk cannot open', () => {

		const busy = phone( 'busy' );
		busy.calls.call( 'npc-ada' );
		busy.calls.update( RING_SECONDS );
		expect( busy.view.setState ).toHaveBeenLastCalledWith( expect.objectContaining( { status: 'busy', line: 'I am at work.' } ) );
		expect( busy.calls.open ).not.toHaveBeenCalled();

		const nobody = phone( 'no-answer' );
		nobody.calls.call( 'npc-ada' );
		nobody.calls.update( RING_SECONDS );
		expect( nobody.view.setState ).toHaveBeenLastCalledWith( expect.objectContaining( { status: 'no-answer' } ) );
		expect( nobody.calls.live ).toBe( false );

		const closed = phone( 'answered', false );
		closed.calls.call( 'npc-ada' );
		closed.calls.update( RING_SECONDS );
		expect( closed.view.setState ).toHaveBeenLastCalledWith( expect.objectContaining( { status: 'ended' } ) );

	} );

} );
