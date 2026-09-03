/** Owns one browser recording and sends its exact encoded media to faster-whisper. */
export class MicrophoneTranscriber {

	constructor( runtime, {
		mediaDevices = globalThis.navigator?.mediaDevices,
		Recorder = globalThis.MediaRecorder
	} = {} ) {

		this.runtime = runtime;
		this.mediaDevices = mediaDevices;
		this.Recorder = Recorder;
		this.session = null;
		this.starting = null;
		this.sequence = 0;

	}

	get recording() { return this.session?.recorder.state === 'recording'; }

	async start() {

		if ( this.recording ) return true;
		if ( this.starting?.generation === this.sequence ) return this.starting.promise;
		if ( ! this.mediaDevices?.getUserMedia || ! this.Recorder ) throw new Error( 'Microphone recording is unavailable' );
		const generation = ++ this.sequence;
		const starting = { generation, promise: this.#start( generation ) };
		this.starting = starting;
		try { return await starting.promise; }
		finally { if ( this.starting === starting ) this.starting = null; }

	}

	async #start( generation ) {

		const stream = await this.mediaDevices.getUserMedia( { audio: true } );
		if ( generation !== this.sequence ) {

			stopStream( stream );
			return false;

		}
		const mediaType = preferredType( this.Recorder );
		const recorder = new this.Recorder( stream, mediaType ? { mimeType: mediaType } : undefined );
		const session = { generation, stream, recorder, chunks: [] };
		this.session = session;
		recorder.addEventListener( 'dataavailable', ( event ) => {

			if ( this.session === session && event.data?.size ) session.chunks.push( event.data );

		} );
		recorder.start();
		return true;

	}

	stop() {

		if ( ! this.recording ) return Promise.resolve( null );
		const session = this.session;
		const { recorder } = session;
		return new Promise( ( resolve, reject ) => {

			recorder.addEventListener( 'stop', async () => {

				if ( this.session !== session ) {

					resolve( null );
					return;

				}
				try {

					const media = new Blob( session.chunks, { type: recorder.mimeType } );
					resolve( await this.runtime.transcribe( media ) );

				} catch ( error ) { reject( error ); }
				finally { this.#release( session ); }

			}, { once: true } );
			recorder.stop();

			} );

	}

	cancel() {

		this.sequence ++;
		const session = this.session;
		this.session = null;
		if ( session?.recorder.state === 'recording' ) session.recorder.stop();
		if ( session ) this.#release( session );

	}

	#release( session ) {

		stopStream( session.stream );
		if ( this.session === session ) this.session = null;

	}

}

function stopStream( stream ) {

	for ( const track of stream?.getTracks?.() ?? [] ) track.stop();

}

function preferredType( Recorder ) {

	return [ 'audio/webm', 'audio/ogg', 'audio/mp4' ].find( ( type ) => Recorder.isTypeSupported?.( type ) ) ?? '';

}
