/** Sweeps the shared store: every set no world on disk points at any more. */

import { collect, sweepLine } from './SharedResources.js';

console.log( sweepLine( collect() ) );
