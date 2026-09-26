import type { Group, Object3D } from 'three/webgpu';
import type { InteriorModules } from '../InteriorModules.js';
import type { InteriorProps } from '../InteriorProps.js';
import type { RoomLights } from '../../light/RoomLights.js';
import type { Elevators } from '../Elevators.js';

type InteriorLayoutId = 'ground' | 'middle' | 'crown' | `floor-${number}`;

/** `building.json` and its declared layouts, as BuildingSource reads them. */
export interface InteriorSource {
	building: {
		floors: Array<{ index: number; layout: InteriorLayoutId; elevation: number }>;
		layouts: Partial<Record<InteriorLayoutId, string>>;
		[field: string]: unknown;
	};
	/** Full layout fields follow Interior's floor-placement.schema.json. */
	layouts: Partial<Record<InteriorLayoutId, Record<string, unknown>>>;
}

/** What one floor's modules and furniture are to the physics world. */
export interface FloorSolid {
	boxes: Array<{ center: [number, number, number]; halfExtents: [number, number, number]; rotationY: number }>;
	/** Borrowed world-space furniture triangles, packed xyz. */
	positions: Float32Array[];
}

export interface StreamOptions {
	modules: InteriorModules;
	props?: InteriorProps | null;
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
	/** Whether one floor of a furnished building is drawn and solid now. */
	floorShown(parcelId: string, floor: number): boolean;
	register(buildings: Map<string, { interior: InteriorSource | null; hasInterior?: boolean }>, centers: Map<string, { x: number; z: number }>): void;
	/** Returns whether room memory or scene membership changed. */
	update(feet: { x: number; y: number; z: number }): boolean;
	/** Await full collision readiness before the floor is drawn; false cancels. */
	onColliderBand: ((id: string, solid: FloorSolid) => Promise<boolean | void> | boolean | void) | null;
	/** Cancels pending admission or removes a ready floor before its instances are released. */
	onDropBand: ((id: string) => void) | null;
	dispose(): void;
}
