import { describe, expect, it, vi } from 'vitest';
import { MicrophoneTranscriber } from '../index.js';

describe( 'microphone transcription lifecycle', () => {

	it( 'does not transcribe a cancelled stop or leak its callback into a new recording', async () => {

		const runtime = { transcribe: vi.fn( async ( media ) => ( { text: String( media.size ) } ) ) };
		const streams = [ stream(), stream() ];
		const mediaDevices = { getUserMedia: vi.fn( async () => streams.shift() ) };
		const microphone = new MicrophoneTranscriber( runtime, { mediaDevices, Recorder: ControlledRecorder } );

		await microphone.start();
		const first = ControlledRecorder.instances.at( -1 );
		first.data( new Blob( [ new Uint8Array( [ 1, 2, 3 ] ) ] ) );
		const cancelledStop = microphone.stop();
		microphone.cancel();

		await microphone.start();
		const second = ControlledRecorder.instances.at( -1 );
		second.data( new Blob( [ new Uint8Array( [ 8, 9 ] ) ] ) );
		first.finish();
		await expect( cancelledStop ).resolves.toBeNull();
		expect( runtime.transcribe ).not.toHaveBeenCalled();

		const completed = microphone.stop();
		second.finish();
		await expect( completed ).resolves.toEqual( { text: '2' } );
		expect( runtime.transcribe ).toHaveBeenCalledOnce();

	} );

	it( 'stops a late permission stream and lets a new start create its own session', async () => {

		const firstPermission = deferred();
		const secondPermission = deferred();
		const firstStream = stream();
		const secondStream = stream();
		const mediaDevices = {
			getUserMedia: vi.fn()
				.mockReturnValueOnce( firstPermission.promise )
				.mockReturnValueOnce( secondPermission.promise )
		};
		const microphone = new MicrophoneTranscriber( { transcribe: vi.fn() }, {
			mediaDevices, Recorder: ControlledRecorder
		} );

		const cancelled = microphone.start();
		microphone.cancel();
		const restarted = microphone.start();
		expect( mediaDevices.getUserMedia ).toHaveBeenCalledTimes( 2 );

		firstPermission.resolve( firstStream );
		await expect( cancelled ).resolves.toBe( false );
		expect( firstStream.track.stop ).toHaveBeenCalledOnce();

		secondPermission.resolve( secondStream );
		await expect( restarted ).resolves.toBe( true );
		expect( microphone.recording ).toBe( true );

	} );

} );

class ControlledRecorder extends EventTarget {

	static instances = [];
	static isTypeSupported = () => true;

	constructor( _stream, { mimeType } ) {

		super();
		this.mimeType = mimeType;
		this.state = 'inactive';
		ControlledRecorder.instances.push( this );

	}

	start() { this.state = 'recording'; }

	stop() { this.state = 'inactive'; }

	data( data ) {

		const event = new Event( 'dataavailable' );
		Object.defineProperty( event, 'data', { value: data } );
		this.dispatchEvent( event );

	}

	finish() { this.dispatchEvent( new Event( 'stop' ) ); }

}

function stream() {

	const track = { stop: vi.fn() };
	return { track, getTracks: () => [ track ] };

}

function deferred() {

	let resolve;
	const promise = new Promise( ( done ) => { resolve = done; } );
	return { promise, resolve };

}
