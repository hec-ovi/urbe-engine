import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { InteriorModules, placedModules } from './InteriorModules.js';

const furnished = ( placements, treatments = [] ) => ( {
	interior: {
		building: { floors: [ { index: 0, layout: 'ground', elevation: 0, treatments } ] },
		layouts: { ground: { floor: { height: 3, rooms: [], lights: [] }, placements } }
	}
} );

describe( 'InteriorModules', () => {

	it( 'names every module the furnished floors place, window returns included, and the whole catalog when a floor cannot be read', () => {

		const buildings = new Map( [
			[ 'p1', furnished( [ { module: 'wall-a' }, { prop: 'desk' }, { module: 'floor-a' } ], [ { module: 'return-a' } ] ) ],
			[ 'p2', { ...furnished( [ { module: 'wall-b' } ] ), hasInterior: false } ],
			[ 'p3', { blueprint: {} } ]
		] );

		expect( [ ...placedModules( buildings ) ].sort() ).toEqual( [ 'floor-a', 'return-a', 'wall-a' ] );
		expect( placedModules( new Map( [ [ 'p4', { interior: { building: { floors: [] }, layouts: {} } } ] ] ) ) ).toBeNull();

	} );

	it( 'reads only the modules it is asked for, or the whole catalog', async () => {

		const catalog = { modules: [ 'a', 'b', 'c' ].map( ( id ) => ( { id, file: `${id}.glb`, size: [ 1, 1, 1 ], origin: [ 0, 0, 0 ], materialSlots: [] } ) ) };
		const open = async ( only ) => {

			const reads = [];
			const modules = new InteriorModules( {
				catalog, baseUrl: '/out/shared/interior-modules/x', factory: null, roomLights: { releaseSources() {} }, only,
				loader: { parseAsync: async () => ( { scene: new THREE.Group() } ) },
				readBinary: async ( url ) => { reads.push( url ); return new ArrayBuffer( 0 ); }
			} );
			await modules.ready;
			return { modules, reads };

		};

		const some = await open( new Set( [ 'a', 'c' ] ) );
		expect( some.reads ).toEqual( [ '/out/shared/interior-modules/x/a.glb', '/out/shared/interior-modules/x/c.glb' ] );
		expect( [ some.modules.has( 'a' ), some.modules.has( 'b' ), some.modules.has( 'c' ) ] ).toEqual( [ true, false, true ] );

		expect( ( await open( null ) ).reads ).toHaveLength( 3 );

	} );

} );
