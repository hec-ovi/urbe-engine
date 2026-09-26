/**
 * Vitest global setup: a test run publishes into a shared store of its own,
 * which it removes when it ends, and never into `engine/out/shared`. A store
 * the environment already names (`URBE_SHARED_DIR`) is used as it is.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function setup() {

	if ( process.env.URBE_SHARED_DIR ) return undefined;

	const store = mkdtempSync( join( tmpdir(), 'urbe-test-shared-' ) );
	process.env.URBE_SHARED_DIR = store;

	return () => rmSync( store, { recursive: true, force: true } );

}
