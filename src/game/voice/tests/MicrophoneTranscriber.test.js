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

	return { getTracks: () => [ { stop: vi.fn() } ] };

}
