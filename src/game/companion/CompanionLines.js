import standard from './lines.md?raw';
import { CompanionError } from './CompanionError.js';

/** Every key the companion speaks or shows; a lines document lacking one is refused. */
const KEYS = [
	'label-follow', 'label-dismiss',
	'label-lead-work', 'label-lead-home', 'label-lead-haunt', 'label-lead-quest', 'label-lead-scene',
	'accept-follow', 'accept-lead', 'accept-dismiss',
	'refuse-unavailable', 'refuse-conflict', 'refuse-busy', 'refuse-on_duty', 'refuse-no_time', 'refuse-unknown',
	'lead-waiting',
	'arrival-work', 'arrival-home', 'arrival-haunt', 'arrival-quest', 'arrival-scene', 'arrival-ask',
	'notice-gave-up-player-lost', 'notice-gave-up-unreachable',
	'name-unnamed', 'name-stop', 'name-station'
];
const NAMES = new Set( [ 'place', 'name', 'word' ] );
const FIELD = /\{(\w+)\}/g;

/**
 * The companion's words, read from a Markdown document ([lines.md](lines.md)
 * by default): each `## key` section lists the ways of saying one thing as
 * `- ` items. Code never holds the prose; it picks a way and fills it in.
 */
export class CompanionLines {

	static standard() {

		return new CompanionLines( standard );

	}

	constructor( markdown ) {

		this.lines = parse( markdown );
		const missing = KEYS.filter( ( key ) => ! this.lines.has( key ) );
		if ( missing.length ) throw new CompanionError( 'E_COMPANION_LINES', `companion lines lack ${missing.join( ', ' )}` );
		for ( const [ key, variants ] of this.lines ) for ( const variant of variants ) {

			for ( const [ , name ] of variant.matchAll( FIELD ) ) {

				if ( ! NAMES.has( name ) ) throw new CompanionError( 'E_COMPANION_LINES', `${key} names an unknown {${name}}` );

			}

		}

	}

	/**
	 * One way of saying `key`: the same for the same seed, with `values`
	 * filled in. A template naming a value it is not given is refused.
	 */
	say( key, values = {}, seed = '' ) {

		const variants = this.lines.get( key );
		if ( ! variants ) throw new CompanionError( 'E_COMPANION_LINES', `no companion line ${key}` );
		const template = variants[ hash( `${key}|${seed}` ) % variants.length ];
		return template.replace( FIELD, ( field, name ) => {

			if ( values[ name ] === undefined ) throw new CompanionError( 'E_COMPANION_LINES', `${key} needs {${name}}` );
			return values[ name ];

		} );

	}

}

function parse( markdown ) {

	const lines = new Map();
	let current = null;
	for ( const raw of markdown.split( /\r?\n/ ) ) {

		const heading = /^##\s+(\S+)\s*$/.exec( raw );
		if ( heading ) {

			current = [];
			lines.set( heading[ 1 ], current );
			continue;

		}
		const item = /^-\s+(.+?)\s*$/.exec( raw );
		if ( item && current ) current.push( item[ 1 ] );

	}
	for ( const [ key, variants ] of lines ) if ( ! variants.length ) lines.delete( key );
	return lines;

}

/** FNV-1a over a string, unsigned. */
function hash( value ) {

	let result = 2166136261;
	for ( let index = 0; index < value.length; index ++ ) result = Math.imul( result ^ value.charCodeAt( index ), 16777619 );
	return result >>> 0;

}
