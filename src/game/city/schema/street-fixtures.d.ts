import type { Color, Group, Vector3 } from 'three/webgpu';

/** Atlas world input and Connections walk input follow the Game contract. */
export interface StreetFixtureOptions { cellSize?: number }
export interface PostReservation {
	x: number; z: number; base: number; height: number; radius: number;
	head: { center: Vector3; aim: Vector3; length: number; width: number; height: number; underside: number };
}
export interface StreetGlow { position: Vector3; color: Color; lumens: number; range: number }
export interface StreetFixtureWindow {
	/** Half-width of the rendering window, default 900 metres. Complete cells intersecting it are admitted. */
	radius?: number;
	/** Half-width of the collision window, default 256 metres, limited to the rendering window. */
	collisionRadius?: number;
	prepare?: (group: Group, state: {wanted(): boolean}) => Promise<unknown>;
	collision?: {
		/** Resolves when the complete cell's posts are ready. false means cancelled. */
		addPosts(id: string, posts: readonly PostReservation[]): Promise<boolean | void> | boolean | void;
		/** Cancels pending admission or removes the cell's posts. */
		dropPosts(id: string): void;
	} | null;
	/** Resident posts/glows changed; forward glows to CityLights.setFixtures. */
	changed?: () => void;
}
export interface StreetFixtureStream {
	readonly group: Group;
	readonly posts: readonly PostReservation[];
	readonly glows: readonly StreetGlow[];
	/** Stable geometry-free whole-plan obstacle reservations, complete after the first update resolves. */
	readonly allPostReservations: readonly PostReservation[];
	readonly stats: { indexed: number; resident: number; fixtures: number; wanted: number; pending: boolean };
	/** Coalesces movement windows. Resolution means the latest window is prepared; settings and ports persist. */
	update(position: {x: number; z: number}, window?: StreetFixtureWindow): Promise<void>;
	/** Cancels admission and releases instance buffers and shared templates after active preparation settles. */
	dispose(): Promise<void>;
}
