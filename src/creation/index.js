import { WorldCreation } from './src/WorldCreation.js';

export function createWorldCreation( config, ports = {} ) {

	return new WorldCreation( config, ports );

}

export { CreationError } from './src/CreationError.js';
