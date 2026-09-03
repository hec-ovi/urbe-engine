import {
	canonicalJson,
	cloneJson,
	encodeBase64,
	sha256Hex,
	verifyAudioEnvelope
} from './Canonical.js';
import { AudioWorkletPacketTransport } from './AudioWorkletPacketTransport.js';
import { NpcVoiceError } from './NpcVoiceError.js';
import { VoiceBoundary } from './VoiceBoundary.js';

const priorityRank = Object.freeze( { conversation: 0, nearby: 1, background: 2 } );
const resultFailureCodes = new Set( [
	'E_VOICE_ADAPTER',
	'E_VOICE_CHUNK',
	'E_VOICE_ORDER',
	'E_VOICE_SILENCE'
] );

export class NpcVoiceClient {

	#adapter;
	#boundary;
	#transport;
	#manifest;
	#profiles = new Map();
	#profileRevisions = new Map();
	#jobs = new Map();
	#queue = [];
	#cache = new Map();
	#enqueueSequence = 0;
	#active = 0;
	#scheduled = false;

	constructor( { adapter, transport, boundary = new VoiceBoundary(), cache } ) {

		if ( ! adapter || typeof adapter.capabilities !== 'function' || typeof adapter.synthesize !== 'function' ) {

			throw new NpcVoiceError( 'E_VOICE_ADAPTER', 'NPC voice adapter must expose capabilities and synthesize' );

		}
		this.#adapter = adapter;
		this.#boundary = boundary;
		this.#manifest = cloneJson( this.#adapter.capabilities() );
		this.#boundary.input( 'capability-manifest', this.#manifest );
		this.#transport = transport ?? new AudioWorkletPacketTransport( { boundary } );
		if ( cache !== undefined && ! isCacheLike( cache ) ) {

			throw new NpcVoiceError( 'E_VOICE_CACHE', 'NPC voice cache must expose get, has, and set' );

		}
		this.#cache = cache ?? new Map();

	}

	capabilities() {

		const manifest = cloneJson( this.#manifest );
		this.#boundary.output( 'capability-manifest', manifest );
		return manifest;

	}

	async registerProfile( profile ) {

		this.#boundary.input( 'voice-profile', profile );
		if ( ! this.#manifest.languages.includes( profile.language ) ) {

			throw new NpcVoiceError( 'E_VOICE_PROFILE', `Adapter does not support profile language ${profile.language}` );

		}
		if ( canonicalJson( profile.engine ) !== canonicalJson( this.#manifest.engine ) ) {

			throw new NpcVoiceError( 'E_VOICE_PROFILE', 'Profile engine pin does not match the adapter manifest' );

		}

		const reactionControls = new Set();
		for ( const reaction of profile.approvedReactions ) {

			if ( reactionControls.has( reaction.control ) ) {

				throw new NpcVoiceError( 'E_VOICE_PROFILE', `Profile repeats approved reaction ${reaction.control}` );

			}
			reactionControls.add( reaction.control );
			this.#assertOutputFormat( reaction.audio, `Approved ${reaction.control} reaction` );
			await verifyAudioEnvelope( reaction.audio, `Approved ${reaction.control} reaction` );

		}

		const storedProfile = cloneJson( profile );
		const profileDigest = await sha256Hex( canonicalJson( storedProfile ) );
		const revisionKey = `${profile.profileId}@${profile.revision}`;
		const previousDigest = this.#profileRevisions.get( revisionKey );
		if ( previousDigest && previousDigest !== profileDigest ) {

			throw new NpcVoiceError( 'E_VOICE_PROFILE', `Profile revision ${revisionKey} is immutable` );

		}
		const record = { version: '1', profileDigest, profile: storedProfile };
		this.#boundary.output( 'profile-record', record );
		this.#profiles.set( profileDigest, cloneJson( record ) );
		this.#profileRevisions.set( revisionKey, profileDigest );
		return cloneJson( record );

	}

	async start( request ) {

		this.#boundary.input( 'speech-request', request );
		if ( this.#jobs.has( request.requestId ) ) {

			throw new NpcVoiceError( 'E_VOICE_CONFLICT', `Request ${request.requestId} already exists` );

		}
		const profileRecord = this.#profiles.get( request.profileDigest );
		if ( ! profileRecord ) throw new NpcVoiceError( 'E_VOICE_PROFILE', 'Unknown NPC voice profile digest' );
		if ( profileRecord.profile.npcId !== request.npcId ) {

			throw new NpcVoiceError( 'E_VOICE_PROFILE', 'Speech request NPC does not own the selected voice profile' );

		}
		if ( request.outputCodecVersion !== this.#manifest.output.codecVersion ) {

			throw new NpcVoiceError( 'E_VOICE_CODEC', 'Speech request codec version does not match the adapter' );

		}

		const delivery = { ...profileRecord.profile.delivery, ...request.delivery };
		const plan = this.#makePlan( request.content, profileRecord.profile );
		const cacheKey = await sha256Hex( canonicalJson( {
			contractVersion: '1',
			profileDigest: profileRecord.profileDigest,
			npcId: request.npcId,
			engine: this.#manifest.engine,
			content: request.content,
			delivery,
			profileSeed: profileRecord.profile.seed,
			inference: request.inference,
			output: this.#manifest.output
		} ) );

		let resolveResult;
		const resultPromise = new Promise( ( resolve ) => { resolveResult = resolve; } );
		const job = {
			request: cloneJson( request ),
			profileRecord: cloneJson( profileRecord ),
			delivery,
			plan,
			cacheKey,
			status: 'queued',
			enqueueSequence: this.#enqueueSequence ++,
			eventSequence: 0,
			chunks: [],
			realizedControls: plan.flatMap( ( entry ) => entry.realizedControls ),
			frameCursor: 0,
			controller: new AbortController(),
			cancelReason: null,
			resolveResult,
			resultPromise
		};
		this.#jobs.set( request.requestId, job );
		this.#queue.push( job );
		this.#emit( job, {
			type: 'accepted',
			priority: request.priority,
			profileDigest: request.profileDigest,
			cacheKey
		} );
		this.#schedule();

		const result = {
			version: '1',
			requestId: request.requestId,
			status: 'queued',
			priority: request.priority,
			profileDigest: request.profileDigest,
			cacheKey
		};
		this.#boundary.output( 'start-result', result );
		return result;

	}

	wait( request ) {

		this.#boundary.input( 'wait-request', request );
		const job = this.#jobs.get( request.requestId );
		if ( ! job ) throw new NpcVoiceError( 'E_VOICE_NOT_FOUND', `Unknown request ${request.requestId}` );
		return job.resultPromise.then( cloneJson );

	}

	cancel( request ) {

		this.#boundary.input( 'cancel-request', request );
		const job = this.#jobs.get( request.requestId );
		const previousStatus = job?.status ?? 'unknown';
		if ( ! job || ! [ 'queued', 'active' ].includes( previousStatus ) ) {

			const result = { version: '1', requestId: request.requestId, cancelled: false, previousStatus };
			this.#boundary.output( 'cancel-result', result );
			return result;

		}

		job.cancelReason = request.reason;
		if ( previousStatus === 'queued' ) {

			this.#queue = this.#queue.filter( ( candidate ) => candidate !== job );
			this.#finishCancelled( job );

		} else {

			job.controller.abort();

		}
		const result = { version: '1', requestId: request.requestId, cancelled: true, previousStatus };
		this.#boundary.output( 'cancel-result', result );
		return result;

	}

	get transport() {

		return this.#transport;

	}

	#makePlan( content, profile ) {

		const plan = [];
		let adapterSpans = [];
		const flushAdapter = () => {

			if ( adapterSpans.length === 0 ) return;
			plan.push( { kind: 'adapter', spans: adapterSpans, realizedControls: [] } );
			adapterSpans = [];

		};

		for ( let spanIndex = 0; spanIndex < content.length; spanIndex ++ ) {

			const span = content[ spanIndex ];
			if ( span.kind === 'text' ) {

				adapterSpans.push( { spanIndex, span: cloneJson( span ) } );
				continue;

			}
			if ( span.control === 'pause_ms' ) {

				flushAdapter();
				plan.push( {
					kind: 'silence',
					spanIndex,
					durationMs: span.durationMs,
					realizedControls: [ { spanIndex, control: 'pause_ms', resolution: 'silence' } ]
				} );
				continue;

			}

			const mode = this.#manifest.controls[ span.control ];
			if ( mode === 'native' ) {

				adapterSpans.push( { spanIndex, span: cloneJson( span ) } );
				continue;

			}
			if ( mode === 'reaction' ) {

				flushAdapter();
				const reaction = profile.approvedReactions.find( ( item ) => item.control === span.control );
				if ( ! reaction ) {

					throw new NpcVoiceError(
						'E_VOICE_CONTROL',
						`Control ${span.control} requires an approved reaction for profile ${profile.profileId}`
					);

				}
				plan.push( {
					kind: 'reaction',
					spanIndex,
					control: span.control,
					audio: cloneJson( reaction.audio ),
					realizedControls: [ {
						spanIndex,
						control: span.control,
						resolution: 'reaction',
						reactionSha256: reaction.audio.sha256
					} ]
				} );
				continue;

			}
			throw new NpcVoiceError( 'E_VOICE_CONTROL', `Adapter does not support control ${span.control}` );

		}
		flushAdapter();

		for ( const entry of plan ) {

			if ( entry.kind !== 'adapter' ) continue;
			entry.realizedControls = entry.spans
				.filter( ( item ) => item.span.kind === 'control' )
				.map( ( item ) => ( {
					spanIndex: item.spanIndex,
					control: item.span.control,
					resolution: 'native'
				} ) );

		}
		return plan;

	}

	#schedule() {

		if ( this.#scheduled ) return;
		this.#scheduled = true;
		queueMicrotask( () => {

			this.#scheduled = false;
			this.#queue.sort( ( left, right ) =>
				priorityRank[ left.request.priority ] - priorityRank[ right.request.priority ] ||
				left.enqueueSequence - right.enqueueSequence
			);
			while ( this.#active < this.#manifest.maxConcurrent && this.#queue.length > 0 ) {

				const job = this.#queue.shift();
				void this.#run( job );

			}

		} );

	}

	async #run( job ) {

		this.#active ++;
		job.status = 'active';
		this.#emit( job, { type: 'started', cacheKey: job.cacheKey } );

		try {

			if ( this.#cache.has( job.cacheKey ) ) {

				this.#emit( job, { type: 'cache-hit', cacheKey: job.cacheKey } );
				const cached = cloneJson( this.#cache.get( job.cacheKey ) );
				job.realizedControls = cached.realizedControls;
				for ( const chunk of cached.chunks ) this.#appendChunk( job, chunk );
				this.#finishCompleted( job, 'hit' );
				return;

			}

			for ( let segmentIndex = 0; segmentIndex < job.plan.length; segmentIndex ++ ) {

				if ( job.controller.signal.aborted ) throw abortError();
				const entry = job.plan[ segmentIndex ];
				if ( entry.kind === 'silence' ) {

					this.#appendChunk( job, await this.#silenceChunk( entry ) );
					continue;

				}
				if ( entry.kind === 'reaction' ) {

					this.#appendChunk( job, this.#assetChunk( entry.audio, entry.spanIndex, entry.control ) );
					continue;

				}

				const adapterRequest = {
					version: '1',
					requestId: job.request.requestId,
					cacheKey: job.cacheKey,
					segmentIndex,
					profileRecord: job.profileRecord,
					delivery: job.delivery,
					inference: job.request.inference,
					output: this.#manifest.output,
					spans: entry.spans
				};
				this.#boundary.output( 'adapter-request', adapterRequest );
				let expectedSequence = 0;
				let chunkCount = 0;
				for await ( const adapterChunk of this.#adapter.synthesize( adapterRequest, job.controller.signal ) ) {

					try {

						this.#boundary.input( 'adapter-chunk', adapterChunk );

					} catch ( error ) {

						throw new NpcVoiceError( 'E_VOICE_ADAPTER', error.message, error.details );

					}
					if (
						adapterChunk.requestId !== job.request.requestId ||
						adapterChunk.segmentIndex !== segmentIndex
					) throw new NpcVoiceError( 'E_VOICE_ORDER', 'Adapter chunk belongs to another request segment' );
					if ( adapterChunk.sequence !== expectedSequence ) {

						throw new NpcVoiceError( 'E_VOICE_ORDER', `Adapter chunk ${adapterChunk.sequence} is out of order` );

					}
					expectedSequence ++;
					this.#assertOutputFormat( adapterChunk, 'Adapter chunk' );
					await verifyAudioEnvelope( adapterChunk, 'Adapter chunk' );
					if ( job.controller.signal.aborted ) throw abortError();
					const {
						version,
						requestId,
						segmentIndex: ignoredSegment,
						sequence: ignoredSequence,
						spanIndex,
						...audio
					} = adapterChunk;
					void version;
					void requestId;
					void ignoredSegment;
					void ignoredSequence;
					this.#appendChunk( job, {
						...audio,
						source: { kind: 'adapter', spanIndex }
					} );
					chunkCount ++;

				}
				if ( chunkCount === 0 ) throw new NpcVoiceError( 'E_VOICE_ADAPTER', 'Adapter emitted no audio chunks' );
				if ( job.controller.signal.aborted ) throw abortError();

			}

			if ( job.controller.signal.aborted ) throw abortError();
			this.#cache.set( job.cacheKey, cloneJson( {
				realizedControls: job.realizedControls,
				chunks: job.chunks
			} ) );
			this.#finishCompleted( job, 'miss' );

		} catch ( error ) {

			if ( error?.name === 'AbortError' || job.controller.signal.aborted ) this.#finishCancelled( job );
			else this.#finishFailed( job, error );

		} finally {

			this.#active --;
			this.#schedule();

		}

	}

	#appendChunk( job, chunkTemplate ) {

		const chunk = cloneJson( {
			...chunkTemplate,
			sequence: job.chunks.length,
			startFrame: job.frameCursor
		} );
		this.#boundary.output( 'audio-chunk', chunk );
		job.chunks.push( chunk );
		job.frameCursor += chunk.frameCount;
		this.#emit( job, { type: 'chunk', chunk } );

	}

	async #silenceChunk( entry ) {

		const output = this.#manifest.output;
		if ( output.codec !== 'pcm_s16le' ) {

			throw new NpcVoiceError( 'E_VOICE_SILENCE', 'Exact pause silence requires pcm_s16le output' );

		}
		const frameNumerator = entry.durationMs * output.sampleRate;
		if ( frameNumerator % 1000 !== 0 ) {

			throw new NpcVoiceError(
				'E_VOICE_SILENCE',
				`Pause ${entry.durationMs}ms is not an exact whole-frame duration at ${output.sampleRate}Hz`
			);

		}
		const frameCount = frameNumerator / 1000;
		const bytes = new Uint8Array( frameCount * output.channels * 2 );
		return {
			sampleRate: output.sampleRate,
			channels: output.channels,
			codec: output.codec,
			frameCount,
			byteSize: bytes.byteLength,
			sha256: await sha256Hex( bytes ),
			dataBase64: encodeBase64( bytes ),
			source: { kind: 'silence', spanIndex: entry.spanIndex, control: 'pause_ms' }
		};

	}

	#assetChunk( audio, spanIndex, control ) {

		return {
			...cloneJson( audio ),
			source: { kind: 'reaction', spanIndex, control }
		};

	}

	#assertOutputFormat( audio, label ) {

		const output = this.#manifest.output;
		if (
			audio.sampleRate !== output.sampleRate ||
			audio.channels !== output.channels ||
			audio.codec !== output.codec
		) throw new NpcVoiceError( 'E_VOICE_CODEC', `${label} does not match the capability output format` );

	}

	#finishCompleted( job, cache ) {

		job.status = 'completed';
		const result = {
			version: '1',
			requestId: job.request.requestId,
			profileDigest: job.request.profileDigest,
			cacheKey: job.cacheKey,
			status: 'completed',
			cache,
			realizedControls: cloneJson( job.realizedControls ),
			chunks: cloneJson( job.chunks )
		};
		this.#boundary.output( 'speech-result', result );
		this.#emit( job, { type: 'completed', cacheKey: job.cacheKey } );
		job.resolveResult( result );

	}

	#finishCancelled( job ) {

		if ( job.status === 'cancelled' ) return;
		job.status = 'cancelled';
		const result = {
			version: '1',
			requestId: job.request.requestId,
			profileDigest: job.request.profileDigest,
			cacheKey: job.cacheKey,
			status: 'cancelled',
			reason: job.cancelReason ?? 'stale',
			realizedControls: cloneJson( job.realizedControls ),
			chunks: cloneJson( job.chunks )
		};
		this.#boundary.output( 'speech-result', result );
		this.#emit( job, { type: 'cancelled', reason: result.reason } );
		job.resolveResult( result );

	}

	#finishFailed( job, error ) {

		job.status = 'failed';
		const failure = {
			code: resultFailureCodes.has( error?.code ) ? error.code : 'E_VOICE_ADAPTER',
			message: error?.message || 'NPC voice adapter failed'
		};
		const result = {
			version: '1',
			requestId: job.request.requestId,
			profileDigest: job.request.profileDigest,
			cacheKey: job.cacheKey,
			status: 'failed',
			error: failure,
			realizedControls: cloneJson( job.realizedControls ),
			chunks: cloneJson( job.chunks )
		};
		this.#boundary.output( 'speech-result', result );
		this.#emit( job, { type: 'failed', error: failure } );
		job.resolveResult( result );

	}

	#emit( job, fields ) {

		const event = {
			version: '1',
			requestId: job.request.requestId,
			eventSequence: job.eventSequence ++,
			...cloneJson( fields )
		};
		this.#boundary.output( 'lifecycle-event', event );
		this.#transport.push( event );

	}

}

function isCacheLike( value ) {

	return value && [ 'get', 'has', 'set' ].every( ( method ) => typeof value[ method ] === 'function' );

}

function abortError() {

	const error = new Error( 'NPC voice request cancelled' );
	error.name = 'AbortError';
	return error;

}
