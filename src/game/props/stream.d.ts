import type { Group, Matrix4 } from 'three/webgpu';
import type { BandCollisionPort } from '../physics/schema/band-admission.d.ts';

export interface PropStreamOptions { /** Spatial owner size in metres, default 128. */ cellSize?: number }
export interface PropWindow {
  /** Visible source cells, default 900 metres. */ radius?: number;
  /** Exact model collision cells, default 256 metres. */ collisionRadius?: number;
  collision?: BandCollisionPort | null;
  prepare?: ((group: Group, state: { wanted(): boolean }) => Promise<unknown>) | null;
}
/** Same source records as result.schema.json; geometry stays in shared models. */
export interface PropPlacement {
  id: string; arrangement: string; model: string; kind: string; finish: string; color: string;
  matrix: Matrix4; footprint: number[][]; support: number[][]; lowFootprint: number[][];
  bottom: number; top: number;
}
export interface PropStream {
  readonly group: Group;
  readonly placements: PropPlacement[];
  /** Complete deterministic plan totals, independent of current residency. */
  readonly counts: Record<string, number>;
  readonly stats: {
    indexed: number; resident: number; wanted: number;
    /** Collidable placements whose complete band is ready. */ collision: number;
    collisionCells: number; draws: number; pending: boolean;
    /** Longest measured batch-work slice, excluding preparation waits. */ maxWorkMs: number;
  };
  /** Settings persist. Same-cell calls coalesce; resolution covers the latest window. */
  update(position: { x: number; z: number }, options?: PropWindow): Promise<void>;
  /** Cancels admission, drops bands and releases owned models and instance buffers. */
  dispose(): void;
}
