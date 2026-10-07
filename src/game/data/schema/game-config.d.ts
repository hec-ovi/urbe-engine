/** Existing URL query. Unknown keys are ignored; numeric values parse and clamp. */
export interface GameQuery {
  mode?: 'game';
  /** Catalog id, 1-64 lowercase letters, digits, dots, underscores or hyphens; alphanumeric ends. */
  game?: string;
  /** Defaults to city-urbe-tiny. */ world?: string;
  /** Defaults to /out/city-tiny; game selects /out/games/<id> instead. */ out?: string;
  /** Only webgl selects the fallback; otherwise webgpu. */ backend?: string;
  /** low, medium, high or ultra; unknown/absent follows backend. */ quality?: string;
  /** Integer 0-23; absent, a new story starts during its first client appointment, else 21. */ hour?: string;
  /** Integer 0-600, default 0, or 90 in a catalog game. */ crowd?: string;
  /** Integer 0-600, default 0, or 8 in a catalog game. */ cars?: string;
  /** Metres 1-10000, default 90. */ crowdRadius?: string;
  /** Metres 1-10000, default 110. */ carRadius?: string;
  /** Number 0-8, default 1. */ density?: string;
  /** Integer 0-40, default 0. */ stress?: string;
  /** paint, glow or debug; default paint. */ lanes?: string;
  /** Number 0.005-4, default 0.024. */ exposure?: string;
  /** Number 0-0.05, default 0.0003. */ fog?: string;
  /** Comma-separated fog,bloom,probe,haze,interiors,detail; default empty. */ off?: string;
  /** `off` starts the run with NPC voices off; anything else leaves them on. */ voice?: string;
  /** `off` hides the developer readouts, anything else shows them; absent, only a preview shows them. */ details?: string;
  /** Present: installs the automation probe on an `out` preview; ignored with game. */ automation?: string;
  /** Present: an `out` preview of a game's folder restores what its game.json saved and never saves; ignored with game. */ resume?: string;
  /** `on` keeps checking the NPC continuity's inputs and outputs against their schemas in play; the load always checks them. */ checks?: string;
}

/** GameConfig.fromUrl() result, passed to new GameApp(config). */
export interface GameConfig {
  world: string;
  gameId: string | null;
  outBase: string;
  /** The Atlas sample `world` names, read only for an older world that carries no blueprint of its own. */
  blueprintUrl: string;
  backend: 'webgpu' | 'webgl';
  quality: 'low' | 'medium' | 'high' | 'ultra' | null;
  startHour: number;
  explicitHour: boolean;
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
  off: Set<'fog' | 'bloom' | 'probe' | 'haze' | 'interiors' | 'detail'>;
  /** Whether NPC lines are spoken from the start; the settings can change it. */
  voice: boolean;
  /** Whether the developer readouts (position, loaded files, frame stats) show from the start; the settings can change it. */
  details: boolean;
  automation: boolean;
  resume: boolean;
  /** Whether the NPC continuity's values are held to their schemas in play, not only while the game loads. */
  checks: boolean;
}
