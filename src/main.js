import { App } from './app/App.js';
import { RunConfig } from './app/RunConfig.js';

new App( RunConfig.fromUrl() ).start();
