import { NpcVoiceError } from './NpcVoiceError.js';

export function canonicalJson( value ) {

	return JSON.stringify( canonicalValue( value ) );

}

export async function sha256Hex( value ) {

	const bytes = value instanceof Uint8Array
		? value
		: new TextEncoder().encode( typeof value === 'string' ? value : canonicalJson( value ) );
	const digest = await globalThis.crypto.subtle.digest( 'SHA-256', bytes );
	return [ ...new Uint8Array( digest ) ].map( ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

export function decodeBase64( encoded ) {

	try {

		const binary = globalThis.atob( encoded );
		const bytes = new Uint8Array( binary.length );
		for ( let index = 0; index < binary.length; index ++ ) bytes[ index ] = binary.charCodeAt( index );
		return bytes;

	} catch {

		throw new NpcVoiceError( 'E_VOICE_CHUNK', 'Audio dataBase64 is not valid base64' );

	}

}

export function encodeBase64( bytes ) {

	let binary = '';
	const blockSize = 32768;
	for ( let offset = 0; offset < bytes.length; offset += blockSize ) {

		binary += String.fromCharCode( ...bytes.subarray( offset, offset + blockSize ) );

	}
	return globalThis.btoa( binary );

}

export async function verifyAudioEnvelope( audio, label = 'Audio envelope' ) {

	if ( audio.codec === 'pcm_s16le' ) {

		const expectedBytes = audio.frameCount * audio.channels * 2;
		if ( audio.byteSize !== expectedBytes ) {

			throw new NpcVoiceError(
				'E_VOICE_CHUNK',
				`${label} byteSize ${audio.byteSize} does not equal ${expectedBytes} PCM bytes`
			);

		}

	}

	if ( audio.dataBase64 === undefined ) return;
	const bytes = decodeBase64( audio.dataBase64 );
	if ( bytes.byteLength !== audio.byteSize ) {

		throw new NpcVoiceError(
			'E_VOICE_CHUNK',
			`${label} declares ${audio.byteSize} bytes but contains ${bytes.byteLength}`
		);

	}
	const digest = await sha256Hex( bytes );
	if ( digest !== audio.sha256 ) {

		throw new NpcVoiceError( 'E_VOICE_CHUNK', `${label} SHA-256 does not match its bytes` );

	}

}

export function cloneJson( value ) {

	return JSON.parse( JSON.stringify( value ) );

}

function canonicalValue( value ) {

	if ( Array.isArray( value ) ) return value.map( canonicalValue );
	if ( value && typeof value === 'object' ) {

		return Object.fromEntries(
			Object.keys( value ).sort().map( ( key ) => [ key, canonicalValue( value[ key ] ) ] )
		);

	}
	return value;

}
