import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runConnections } from '/home/hec/workspace/urbe/engine/src/assembly/connectionsRunner.js';

describe( 'probe', () => {

	it( 'runs the connections library under vitest', async () => {

		const atlas = JSON.parse( readFileSync( '/home/hec/workspace/urbe/atlas/samples/city-urbe-tiny.json', 'utf8' ) );
		const doc = await runConnections( atlas, { seed: atlas.meta.seed } );

		expect( doc.links.length ).toBe( 39 );

	} );

} );
