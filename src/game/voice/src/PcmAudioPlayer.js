import { decodeBase64 } from './Canonical.js';
import { NpcVoiceError } from './NpcVoiceError.js';

/** Schedules checked mono or stereo PCM chunks on one Web Audio timeline. */
export class PcmAudioPlayer {

	constructor( { contextFactory = () => new AudioContext() } = {} ) {

		this.contextFactory = contextFactory;
		this.context = null;
		this.sources = [];
		this.sequence = 0;
		this.finish = null;

	}

	/** Opens the shared Web Audio context from a player gesture before inference starts. */
	async unlock() {

		this.context ??= this.contextFactory();
		try { await this.context.resume?.(); }
		catch ( error ) {

			throw new NpcVoiceError( 'E_VOICE_ADAPTER', `Audio playback could not start: ${error.message}` );

		}

	}

	async play( chunks, { onStart = () => {} } = {} ) {

		this.cancel();
		if ( ! chunks.length ) return;
		const playSequence = ++ this.sequence;
		await this.unlock();
		if ( playSequence !== this.sequence ) return;
		const sampleRate = chunks[ 0 ].sampleRate;
		const timelineOrigin = this.context.currentTime;
		let previousEnd = 0;
		let last = null;
		for ( const chunk of chunks ) {

			if ( playSequence !== this.sequence ) return;

			if ( chunk.codec !== 'pcm_s16le' || ! chunk.dataBase64 ) {

				throw new NpcVoiceError( 'E_VOICE_CODEC', 'Web Audio playback requires inline pcm_s16le chunks' );

			}
			if ( chunk.sampleRate !== sampleRate ) throw new NpcVoiceError( 'E_VOICE_CODEC', 'Playback chunks disagree on sample rate' );
			if ( chunk.startFrame < previousEnd ) throw new NpcVoiceError( 'E_VOICE_ORDER', 'Playback chunks overlap' );
			const bytes = decodeBase64( chunk.dataBase64 );
			const samples = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
			const buffer = this.context.createBuffer( chunk.channels, chunk.frameCount, chunk.sampleRate );
			for ( let channel = 0; channel < chunk.channels; channel ++ ) {

				const output = buffer.getChannelData( channel );
				for ( let frame = 0; frame < chunk.frameCount; frame ++ ) {

					output[ frame ] = samples.getInt16( ( frame * chunk.channels + channel ) * 2, true ) / 32768;

				}

			}
			const source = this.context.createBufferSource();
			source.buffer = buffer;
			source.connect( this.context.destination );
			source.start( timelineOrigin + chunk.startFrame / sampleRate );
			this.sources.push( source );
			last = source;
			previousEnd = chunk.startFrame + chunk.frameCount;

		}
		onStart();
		await new Promise( ( resolve ) => {

			this.finish = resolve;
			last.onended = () => { this.finish = null; resolve(); };
			if ( playSequence !== this.sequence ) resolve();

		} );
		if ( playSequence === this.sequence ) this.sources = [];

	}

	cancel() {

		this.sequence ++;
		for ( const source of this.sources ) {

			try { source.stop(); } catch {}

		}
		this.sources = [];
		this.finish?.();
		this.finish = null;

	}

}
