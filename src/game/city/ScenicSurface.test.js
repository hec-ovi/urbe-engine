import { expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3, Color } from 'three/webgpu';
import { BuildingsLoader } from './BuildingsLoader.js';
import { CityLights } from '../light/CityLights.js';

it( 'keeps room illumination stable while the player light pool changes and softly lights ceilings', async () => {
	const fixture = { position: [ 2, 8.6, 2 ], lumens: 9600, range: 12, color: '#99fff0' };
	const blueprint = { bounds: { height: 9, footprint: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] },
		floors: [ { index: 1, elevation: 4.5, height: 4.5, outline: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ],
			openings: [ { kind: 'window', id: 'w', scenery: { state: 'lit', lights: [ fixture ] } } ] } ] };
	const loader = { loadAsync: async () => {
		const scene = new Group(); scene.name = 'scenery1';
		for ( const [ role, y, angle ] of [ [ 'floor', 4.6, - Math.PI / 2 ], [ 'ceiling', 8.72, Math.PI / 2 ] ] ) {
			const geometry = new PlaneGeometry( 4, 4 ).rotateX( angle ).translate( 2, y, 2 );
			const material = new MeshStandardMaterial(); material.name = `cyberpunk/paired-room-${role}/mid`;
			scene.add( new Mesh( geometry, material ) );
		}
		return { scene };
	} };
	const factory = { resolver: { resolve: () => ( { physical: { emissiveStrength: 1 } } ) }, build: key => new MeshStandardMaterial( { name: key } ) };
	const city = await new BuildingsLoader( factory, loader ).load( new Map( [ [ 'p', { parcelId: 'p', hasInterior: false, shellUrl: '/p.glb', blueprint } ] ] ) );
	const floor = city.group.getObjectByName( 'shell:cyberpunk/paired-room-floor/mid' );
	const ceiling = city.group.getObjectByName( 'shell:cyberpunk/paired-room-ceiling/mid' );
	const floorValues = Array.from( floor.geometry.getAttribute( 'scenicRadiance' ).array );
	const ceilingValues = Array.from( ceiling.geometry.getAttribute( 'scenicRadiance' ).array ).filter( ( _, i ) => i % 3 === 1 );
	expect( Math.max( ...floorValues ) ).toBeGreaterThan( Math.max( ...ceilingValues ) * 3 );
	expect( Math.max( ...ceilingValues ) / Math.min( ...ceilingValues ) ).toBeLessThan( 2 );
	expect( floor.material.emissiveNode ).toBeTruthy();
	expect( floor.material.isMeshBasicNodeMaterial ).toBe( true );
	const pool = new CityLights( [ { ...fixture, position: new Vector3( ...fixture.position ), color: new Color( fixture.color ) },
		{ position: new Vector3( 100, 8.6, 2 ), lumens: 1000, range: 12, color: new Color( 'white' ) } ], 1 );
	pool.update( new Vector3( 2, 0, 2 ), 1 );
	pool.update( new Vector3( 100, 0, 2 ), 1 ); pool.update( new Vector3( 100, 0, 2 ), 1 );
	expect( pool.lights[ 0 ].position.x ).toBe( 100 );
	expect( Array.from( floor.geometry.getAttribute( 'scenicRadiance' ).array ) ).toEqual( floorValues );
	for ( const mesh of city.group.children ) { mesh.geometry.dispose(); mesh.material.dispose(); }
} );
