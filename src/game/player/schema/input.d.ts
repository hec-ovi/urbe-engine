export interface InputSource { element: HTMLElement }
export interface InputState {
  locked: boolean;
  running: boolean;
  crouching: boolean;
  zooming: boolean;
  runMultiplier: 1 | 2 | 4;
}
export interface MovementAxis { x: number; z: number }
export interface LookDelta { dx: number; dy: number }
/** True means the request was accepted; pointerlockchange confirms capture. */
export type CaptureResult = Promise<boolean>;
