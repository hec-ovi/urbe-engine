const WINDOW = 60; // frames

/**
 * Rolling measurements of one run: fps and CPU ms from the frame loop, GPU
 * milliseconds from the renderer's timestamp queries, draw calls, triangles
 * and visible instances from the active variant. snapshot() is the exact
 * shape the copy-as-JSON button exports.
 */
export class Metrics {

	constructor() {

		this.frameIntervals = [];
		this.cpuTimes = [];
		this.lastFrameStart = 0;
		this.gpuRenderMs = null;
		this.gpuComputeMs = null;
		this.drawCalls = 0;
		this.triangles = 0;
		this.visible = { total: null, byLod: null };

	}

	beginFrame( now ) {

		if ( this.lastFrameStart > 0 ) {

			this.frameIntervals.push( now - this.lastFrameStart );
			if ( this.frameIntervals.length > WINDOW ) this.frameIntervals.shift();

		}

		this.lastFrameStart = now;

	}

	endFrame( now ) {

		this.cpuTimes.push( now - this.lastFrameStart );
		if ( this.cpuTimes.length > WINDOW ) this.cpuTimes.shift();

	}

	setRenderInfo( info ) {

		this.drawCalls = info.render.drawCalls;
		this.triangles = info.render.triangles;

	}

	setGpuTimestamps( renderMs, computeMs ) {

		if ( typeof renderMs === 'number' ) this.gpuRenderMs = renderMs;
		if ( typeof computeMs === 'number' ) this.gpuComputeMs = computeMs;

	}

	setVisible( visible ) {

		this.visible = visible;

	}

	get fps() {

		const avg = average( this.frameIntervals );
		return avg > 0 ? 1000 / avg : 0;

	}

	get cpuMs() {

		return average( this.cpuTimes );

	}

	snapshot( meta ) {

		return {
			experiment: 'city-scale-variants',
			timestamp: new Date().toISOString(),
			userAgent: navigator.userAgent,
			config: meta,
			metrics: {
				fps: round( this.fps ),
				cpuFrameMs: round( this.cpuMs ),
				gpuRenderMs: round( this.gpuRenderMs ),
				gpuComputeMs: round( this.gpuComputeMs ),
				drawCalls: this.drawCalls,
				triangles: this.triangles,
				visibleInstances: this.visible.total,
				visibleByLod: this.visible.byLod
			}
		};

	}

}

function average( values ) {

	if ( values.length === 0 ) return 0;
	let sum = 0;
	for ( const v of values ) sum += v;
	return sum / values.length;

}

function round( value ) {

	return typeof value === 'number' ? Math.round( value * 100 ) / 100 : null;

}
