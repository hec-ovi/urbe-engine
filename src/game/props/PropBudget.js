import { frameYield } from '../../app/FrameYield.js';

/** Yields visible-window CPU work between complete material batches. */
export class PropBudget {
	constructor() { this.start = performance.now(); this.max = 0; }
	restart() { this.start = performance.now(); }
	async step() {
		const elapsed = performance.now() - this.start;
		this.max = Math.max( this.max, elapsed );
		if ( elapsed < 4 ) return;
		await frameYield();
		this.restart();
	}
}
