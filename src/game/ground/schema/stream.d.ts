import type { Group } from 'three/webgpu';
import type { BandCollisionPort } from '../../physics/schema/band-admission.d.ts';

export interface GroundStreamOptions { cellSize?: number }
export interface GroundWindow {
	/** Full authored rendering distance in metres. Default 256. */
	radius?: number;
	/** Physical collision distance in metres. Defaults to radius. */
	collisionRadius?: number;
	collision?: BandCollisionPort;
	/** Prepares the shared material batch group before new instances become visible. Optional for initial scene warmup. */
	prepare?: (group: Group, state: {wanted(): boolean}) => Promise<unknown>;
}
export interface GroundStream {
	readonly group: Group;
	readonly bounds: { min: [number, number]; max: [number, number] };
	readonly stats: { indexed: number; resident: number; wanted: number; collision: number; pending: boolean };
	/** Updates are coalesced. Resolution means the latest window is prepared. Ports/settings persist. */
	update(position: {x: number; z: number}, window?: GroundWindow): Promise<void>;
	/** Cancels pending work, drops collision and releases owned geometry; factory materials stay shared. */
	dispose(): void;
}
