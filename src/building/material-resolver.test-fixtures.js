import { MaterialResolver } from './MaterialResolver.js';

/**
 * A resolver whose theme index is one function, keeping the real variant
 * selection and the real report so a test that stubs the catalog still proves
 * what the run does with it.
 */
export function fakeResolver( resolve, mapUrl = ( theme, path ) => `/materials/${theme}/${path}` ) {

	return Object.assign( new MaterialResolver(), { resolve, mapUrl } );

}
