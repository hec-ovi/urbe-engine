/**
 * Carries a quests creation run into a world's out directory, main questline
 * first, so the game finds its story beside the city:
 *   npm run carry-quests -- --from <creation run dir> --out <world out dir>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const QUESTLINE_SUFFIX = '.questline.json';

function parseArgs( argv ) {

	const args = {};
	for ( let i = 0; i + 1 < argv.length; i += 2 ) args[ argv[ i ].replace( /^--/, '' ) ] = argv[ i + 1 ];
	if ( ! args.from || ! args.out ) throw new Error( 'usage: --from <creation run dir> --out <world out dir>' );
	return args;

}

const args = parseArgs( process.argv.slice( 2 ) );
const files = readdirSync( args.from )
	.filter( ( file ) => file.endsWith( QUESTLINE_SUFFIX ) )
	.sort( ( a, b ) => ( b.startsWith( 'main' ) ? 1 : 0 ) - ( a.startsWith( 'main' ) ? 1 : 0 ) || a.localeCompare( b ) );
const definitions = files.map( ( file ) => JSON.parse( readFileSync( join( args.from, file ), 'utf8' ) ).definition );
const target = join( args.out, 'quests' );

mkdirSync( target, { recursive: true } );
writeFileSync( join( target, 'questlines.json' ), JSON.stringify( definitions, null, 2 ) + '\n' );
console.log( `${definitions.length} questlines (${files.join( ', ' )}) -> ${join( target, 'questlines.json' )}` );
