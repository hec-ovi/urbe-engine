import Ajv2020 from 'ajv/dist/2020.js';
import adapterChunkSchema from '../schema/adapter-chunk.schema.json' with { type: 'json' };
import adapterRequestSchema from '../schema/adapter-request.schema.json' with { type: 'json' };
import audioChunkSchema from '../schema/audio-chunk.schema.json' with { type: 'json' };
import cancelRequestSchema from '../schema/cancel-request.schema.json' with { type: 'json' };
import cancelResultSchema from '../schema/cancel-result.schema.json' with { type: 'json' };
import capabilitySchema from '../schema/capability-manifest.schema.json' with { type: 'json' };
import eventHistorySchema from '../schema/event-history.schema.json' with { type: 'json' };
import lifecycleEventSchema from '../schema/lifecycle-event.schema.json' with { type: 'json' };
import playbackBatchSchema from '../schema/playback-batch.schema.json' with { type: 'json' };
import playbackReadSchema from '../schema/playback-read.schema.json' with { type: 'json' };
import profileRecordSchema from '../schema/profile-record.schema.json' with { type: 'json' };
import runtimeCapabilitiesSchema from '../schema/runtime-capabilities.schema.json' with { type: 'json' };
import speechRequestSchema from '../schema/speech-request.schema.json' with { type: 'json' };
import speechResultSchema from '../schema/speech-result.schema.json' with { type: 'json' };
import startResultSchema from '../schema/start-result.schema.json' with { type: 'json' };
import transcriptionRequestSchema from '../schema/transcription-request.schema.json' with { type: 'json' };
import transcriptionResultSchema from '../schema/transcription-result.schema.json' with { type: 'json' };
import valuesSchema from '../schema/values.schema.json' with { type: 'json' };
import voiceProfileSchema from '../schema/voice-profile.schema.json' with { type: 'json' };
import waitRequestSchema from '../schema/wait-request.schema.json' with { type: 'json' };
import { NpcVoiceError } from './NpcVoiceError.js';

const schemas = [
	valuesSchema,
	voiceProfileSchema,
	profileRecordSchema,
	capabilitySchema,
	runtimeCapabilitiesSchema,
	speechRequestSchema,
	startResultSchema,
	cancelRequestSchema,
	cancelResultSchema,
	waitRequestSchema,
	audioChunkSchema,
	adapterRequestSchema,
	adapterChunkSchema,
	speechResultSchema,
	lifecycleEventSchema,
	playbackReadSchema,
	playbackBatchSchema,
	eventHistorySchema,
	transcriptionRequestSchema,
	transcriptionResultSchema
];

const names = Object.freeze( {
	'voice-profile': voiceProfileSchema.$id,
	'profile-record': profileRecordSchema.$id,
	'capability-manifest': capabilitySchema.$id,
	'runtime-capabilities': runtimeCapabilitiesSchema.$id,
	'speech-request': speechRequestSchema.$id,
	'start-result': startResultSchema.$id,
	'cancel-request': cancelRequestSchema.$id,
	'cancel-result': cancelResultSchema.$id,
	'wait-request': waitRequestSchema.$id,
	'audio-chunk': audioChunkSchema.$id,
	'adapter-request': adapterRequestSchema.$id,
	'adapter-chunk': adapterChunkSchema.$id,
	'speech-result': speechResultSchema.$id,
	'lifecycle-event': lifecycleEventSchema.$id,
	'playback-read': playbackReadSchema.$id,
	'playback-batch': playbackBatchSchema.$id,
	'event-history': eventHistorySchema.$id,
	'transcription-request': transcriptionRequestSchema.$id,
	'transcription-result': transcriptionResultSchema.$id
} );

export class VoiceBoundary {

	#validators;

	constructor() {

		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of schemas ) ajv.addSchema( schema );
		this.#validators = Object.fromEntries(
			Object.entries( names ).map( ( [ name, id ] ) => [ name, ajv.getSchema( id ) ] )
		);

	}

	input( kind, value ) {

		this.#validate( kind, value, 'E_VOICE_INPUT' );
		return value;

	}

	output( kind, value ) {

		this.#validate( kind, value, 'E_VOICE_OUTPUT' );
		return value;

	}

	#validate( kind, value, code ) {

		const validator = this.#validators[ kind ];
		if ( ! validator ) throw new NpcVoiceError( code, `Unknown NPC voice schema ${kind}` );
		if ( validator( value ) ) return;
		const details = ( validator.errors ?? [] ).map( ( error ) => ( {
			path: error.instancePath || '/',
			keyword: error.keyword,
			message: error.message ?? 'invalid value'
		} ) );
		throw new NpcVoiceError( code, `NPC voice ${kind} does not match its contract`, details );

	}

}
