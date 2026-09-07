import type { BufferGeometry } from 'three/webgpu';

/** Complete world-space triangles, indexed geometry or packed xyz position arrays. Borrowed until admission settles. */
export type BandGeometry = BufferGeometry | Iterable<Float32Array>;

export interface BandCollisionPort {
	/** Resolves true once the whole band is solid, false when dropped; rejects on invalid geometry or cooking failure. */
	addBand(id: string, geometry: BandGeometry): Promise<boolean>;
	/** Removes ready collision and cancels pending preparation, releasing every piece. */
	dropBand(id: string): void;
	readonly liveBands: number;
}
