import { expect, it } from 'vitest';
import { Neon } from './Neon.js';
import { CityLights } from '../light/CityLights.js';
import { Vector3 } from 'three/webgpu';

it('uses authored podium accent color and flux', () => {
	const light={kind:'accent',edge:0,position:[2,5.8,0],normal:[0,-1],size:[5,0.12,0.1],standoff:0.02,color:'#99fff0',lumens:1400,range:14};
	const blueprint={bounds:{height:20},signage:[],screens:[],lights:[light],floors:[]};
	const atlas={parcels:[{id:'p',type:'residential',tier:'mid'}]};
	const {glows}=new Neon(atlas,new Map([['p',{parcelId:'p',hasInterior:false,blueprint}]]),{}).build();
	expect(glows).toHaveLength(1);
	expect(glows[0].lumens).toBe(1400);
	expect(glows[0].range).toBe(14);
	expect(glows[0].color.getHexString()).toBe('99fff0');
});

it( 'passes authored room emitters through Neon into real bounded light slots', () => {
	const light = { position: [ 1, 7, 2 ], color: '#99fff0', lumens: 2400, range: 12 };
	const blueprint = {
		bounds: { height: 10 }, signage: [], lights: [], screens: [],
		floors: [ { elevation: 4.5, height: 4.5, outline: [], openings: [ { id: 'window', scenery: { lights: [ light, { ...light, lumens: 0 } ] } } ] } ]
	};
	const building = { parcelId: 'tower', hasInterior: false, blueprint };
	const atlas = { parcels: [ { id: 'tower', type: 'residential', tier: 'mid' } ] };
	const buildings = new Map( [ [ 'tower', building ] ] );
	const { glows } = new Neon( atlas, buildings, {} ).build();
	expect( glows ).toHaveLength( 1 );
	expect( glows[ 0 ].position.toArray() ).toEqual( light.position );
	const pool = new CityLights( glows, 1 );
	pool.update( new Vector3( 1, 5, 2 ), 1 );
	expect( pool.group.children ).toHaveLength( 1 );
	expect( pool.group.children[ 0 ].power ).toBeCloseTo( light.lumens );
	expect( pool.group.children[ 0 ].distance ).toBe( light.range );
	building.hasInterior = true;
	expect( new Neon( atlas, buildings, {} ).build().glows ).toHaveLength( 0 );
} );
