/** Existing URL query. Unknown keys are ignored; numeric values parse and clamp. */
export interface GameQuery {
  mode?: 'game';
  /** Catalog id, 1-64 lowercase letters, digits, dots, underscores or hyphens; alphanumeric ends. */
  game?: string;
  /** Defaults to city-urbe-tiny. */ world?: string;
  /** Defaults to /out/city-tiny; game selects /out/games/<id> instead. */ out?: string;
  /** Only webgl selects the fallback; otherwise webgpu. */ backend?: string;
  /** low, medium, high or ultra; unknown/absent follows backend. */ quality?: string;
  /** Integer 0-23, default 21. */ hour?: string;
  /** Integer 0-600, default 0. */ crowd?: string;
  /** Integer 0-600, default 0. */ cars?: string;
  /** Metres 1-10000, default 90. */ crowdRadius?: string;
  /** Metres 1-10000, default 110. */ carRadius?: string;
  /** Number 0-8, default 1. */ density?: string;
  /** Integer 0-40, default 0. */ stress?: string;
  /** paint, glow or debug; default paint. */ lanes?: string;
  /** Number 0.005-4, default 0.024. */ exposure?: string;
  /** Number 0-0.05, default 0.0003. */ fog?: string;
  /** Comma-separated fog,bloom,probe,haze,interiors; default empty. */ off?: string;
  /** `off` starts the run with NPC voices off; anything else leaves them on. */ voice?: string;
  /** `off` hides the developer readouts, anything else shows them; absent, only a preview shows them. */ details?: string;
  /** Present: installs the automation probe on an `out` preview; ignored with game. */ automation?: string;
}

/** GameConfig.fromUrl() result, passed to new GameApp(config). */
export interface GameConfig {
  world: string;
  gameId: string | null;
  outBase: string;
  blueprintUrl: string;
  backend: 'webgpu' | 'webgl';
  quality: 'low' | 'medium' | 'high' | 'ultra' | null;
  startHour: number;
  lightingHour: 21;
  timeScale: 1;
  maxCrowd: number;
  maxCars: number;
  crowdRadius: number;
  carRadius: number;
  streetDensity: number;
  stress: number;
  laneMode: 'paint' | 'glow' | 'debug';
  exposure: number;
  fog: number;
  off: Set<'fog' | 'bloom' | 'probe' | 'haze' | 'interiors'>;
  /** Whether NPC lines are spoken from the start; the settings can change it. */
  voice: boolean;
  /** Whether the developer readouts (position, loaded files, frame stats) show from the start; the settings can change it. */
  details: boolean;
  automation: boolean;
}
