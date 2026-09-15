import { expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { BuildingsLoader } from './BuildingsLoader.js';
import { releaseShell } from './streaming/ReleaseShell.js';

it( 'keeps ordinary and illuminated room surfaces separate when their material is shared across buildings', async () => {
	const key = 'cyberpunk/paired-room-wall/mid';
	const map = new THREE.Texture();
	const material = new THREE.MeshStandardMaterial( { name: key, map } );
	const factory = { resolver: { resolve: () => ( { physical: { emissiveStrength: 1 } } ) }, build: vi.fn( () => material ) };
	const buildings = new Map( [ false, false, true ].map( ( hasInterior, index ) => {
		const x = index * 10, parcelId = `p${index}`;
		const outline = [ [ x, 0 ], [ x + 4, 0 ], [ x + 4, 4 ], [ x, 4 ] ];
		return [ parcelId, { parcelId, hasInterior, shellUrl: `/${parcelId}.glb`, blueprint: {
			bounds: { footprint: outline, height: 9 }, materialVariants: { [ key ]: 'surface' },
			floors: [ { index: 1, elevation: 4.5, height: 4.5, outline, openings: [ {
				kind: 'window', id: 'w', scenery: { state: 'lit', lights: [ {
					position: [ x + 0.2, 8.5, 0.5 ], lumens: 2400, color: '#99fff0', range: 12
				} ] }
			} ] } ]
		} } ];
	} ) );
	const positions = { ordinary: [], scenic: [] };
	const loader = { loadAsync: async url => {
		const building = buildings.get( url.slice( 1, - 4 ) );
		const x = building.blueprint.bounds.footprint[ 0 ][ 0 ];
		const scene = new THREE.Group();
		for ( const [ name, y, role ] of [ [ 'mergedlining', 1, 'ordinary' ], [ 'scenery1', 6, 'scenic' ] ] ) {
			const geometry = new THREE.PlaneGeometry( 0.5, 0.5 ).toNonIndexed().translate( x, y, 0 );
			const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial( { name: key } ) );
			mesh.name = name;
			if ( role === 'ordinary' || ! building.hasInterior ) positions[ role ].push( ...geometry.attributes.position.array );
			scene.add( mesh );
		}
		return { scene };
	} };
	const city = await new BuildingsLoader( factory, loader ).load( buildings );
	const ordinary = city.group.children.find( mesh => ! mesh.geometry.hasAttribute( 'scenicRadiance' ) );
	const scenic = city.group.children.find( mesh => mesh.geometry.hasAttribute( 'scenicRadiance' ) );
	expect( city.group.children ).toHaveLength( 2 );
	expect( Array.from( ordinary.geometry.attributes.position.array ) ).toEqual( positions.ordinary );
	expect( Array.from( scenic.geometry.attributes.position.array ) ).toEqual( positions.scenic );
	expect( ordinary.material ).toBe( material );
	expect( scenic.material.isMeshBasicNodeMaterial ).toBe( true );
	expect( scenic.material.map ).toBe( map );
	expect( scenic.material.emissiveNode ).toBeTruthy();
	expect( scenic.geometry.attributes.scenicRadiance.count ).toBe( scenic.geometry.attributes.position.count );
	expect( Array.from( scenic.geometry.attributes.scenicRadiance.array ).every( value => Number.isFinite( value ) && value > 0 ) ).toBe( true );
	expect( city.triangles ).toBe( 10 );
	expect( factory.build.mock.calls ).toEqual( [ [ key, 'surface' ], [ key, 'surface' ] ] );
	releaseShell( city );
} );
