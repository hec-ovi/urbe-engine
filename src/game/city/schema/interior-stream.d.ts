import type { BufferGeometry, Color, Group, Object3D } from 'three/webgpu';
import type { InteriorOutline } from './interior-cut';
import type { RoomLights } from '../../light/RoomLights.js';
import type { Elevators } from '../Elevators.js';

/** Full floor fields follow Interior's floor.schema.json. */
export interface StreamFloor extends InteriorOutline {
	glbUrl: string;
	[field: string]: unknown;
}

export interface StreamOptions {
	factory: { tint(key: string): Promise<Color | null> };
	roomLights: RoomLights;
	haze: { spread: number; cap: number } | null;
	elevators?: Elevators;
	hitches?: { note(label: string, milliseconds?: number): void } | null;
	warmup?: { warmAll(object: Object3D, options?: { wanted: () => boolean }): Promise<number> } | null;
}

export interface InteriorStreamPort {
	group: Group;
	/** Room views consumed by RoomLights, per Light's contract. */
	rooms: Parameters<RoomLights['update']>[0];
	readonly liveInteriors: number;
	register(buildings: Map<string, { floors: StreamFloor[]; hasInterior?: boolean }>, centers: Map<string, { x: number; z: number }>): void;
	/** Returns whether room memory or scene membership changed. */
	update(feet: { x: number; y: number; z: number }): boolean;
	onColliderBand: ((id: string, geometry: BufferGeometry | null) => void) | null;
	onDropBand: ((id: string) => void) | null;
	dispose(): void;
}
