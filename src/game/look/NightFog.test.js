import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { renderGroup } from 'three/tsl';
import NodeMaterialObserver from 'three/src/materials/nodes/manager/NodeMaterialObserver.js';
import NodeUniform from 'three/src/nodes/core/NodeUniform.js';
import BindGroup from 'three/src/renderers/common/BindGroup.js';
import NodeBuilderState from 'three/src/renderers/common/nodes/NodeBuilderState.js';
import NodeUniformsGroup from 'three/src/renderers/common/nodes/NodeUniformsGroup.js';
import { ColorNodeUniform, NumberNodeUniform } from 'three/src/renderers/common/nodes/NodeUniform.js';
import { NightFog } from './NightFog.js';
import { luminance } from '../light/Color.js';

describe( 'NightFog', () => {

	it( 'refreshes fog for unchanged shell meshes that share a material observer', () => {

		const scene = new THREE.Scene();
		const fog = new NightFog( scene, { density: 0.0003, color: 0x8899aa, indoorDensity: 0.04 } );
		const room = { color: new THREE.Color( 1, 0.8, 0.6 ), lux: 200 };
		const uniforms = new NodeUniformsGroup( 'fog', renderGroup );

		for ( const name of [ 'color', 'density', 'height', 'base', 'outdoor' ] ) {

			const node = fog[ name ];
			expect( node.groupNode ).toBe( renderGroup );
			const type = name === 'color' ? 'color' : 'float';
			const Uniform = name === 'color' ? ColorNodeUniform : NumberNodeUniform;
			uniforms.addUniform( new Uniform( new NodeUniform( name, type, node ) ) );

		}

		const shell = () => {

			const object = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshStandardMaterial() );
			return { object, material: object.material, geometry: object.geometry, scene,
				bundle: null, context: {}, lightsNode: { getLights: () => [] } };

		};
		const first = shell(), second = shell();
		const observer = new NodeMaterialObserver( {
			object: first.object, material: first.material, context: {}, fogNode: scene.fogNode
		} );
		const state = new NodeBuilderState( '', '', '', [], [ new BindGroup( 'render', [ uniforms ] ) ], [], [], [], observer, false );
		const buffers = [ state.createBindings()[ 0 ].bindings[ 0 ], state.createBindings()[ 0 ].bindings[ 0 ] ];
		const renderer = { getMRT: () => null };
		const draw = ( renderId ) => [ first, second ].map( ( object, index ) => {

			const refresh = observer.needsRefresh( object, { renderId, renderer } );
			if ( refresh ) buffers[ index ].update();
			return refresh;

		} );
		const read = ( index, name ) => {

			const binding = buffers[ index ];
			const uniform = binding.uniforms.find( ( value ) => value.name === name );
			return Array.from( binding.buffer.slice( uniform.offset, uniform.offset + uniform.itemSize ) );

		};

		fog.update( room, true, 1 );
		expect( draw( 1 ) ).toEqual( [ true, true ] );
		expect( read( 1, 'base' )[ 0 ] ).toBeCloseTo( 0.04 );

		// Three skips the second unchanged shell's bindings. Its room fog must
		// still clear because both meshes read the same scene-pass buffer.
		fog.update( room, false, 1 );
		expect( draw( 2 ) ).toEqual( [ true, false ] );
		expect( buffers[ 1 ] ).toBe( buffers[ 0 ] );
		expect( read( 1, 'base' ) ).toEqual( [ 0 ] );
		expect( read( 1, 'outdoor' ) ).toEqual( [ 1 ] );
		for ( const [ index, value ] of fog.sky.toArray().entries() ) expect( read( 1, 'color' )[ index ] ).toBeCloseTo( value );
		for ( const mesh of [ first, second ] ) {

			mesh.geometry.dispose();
			mesh.material.dispose();

		}

	} );

	it( 'keeps ordinary rooms clear and restores street fog after leaving', () => {

		const scene = new THREE.Scene();
		const fog = new NightFog( scene, { density: 0.0003, color: 0x8899aa } );
		const node = scene.fogNode;
		const room = { color: new THREE.Color( 1, 0.8, 0.6 ), lux: 200 };

		// Entering fades the street air without tinting it with bright room light.
		fog.update( room, true, 0.3 );
		expect( fog.outdoor.value ).toBeCloseTo( 0.5, 6 );
		expect( fog.base.value ).toBe( 0 );
		expect( fog.color.value.equals( fog.sky ) ).toBe( true );

		fog.update( room, true, 0.3 );
		expect( fog.outdoor.value ).toBe( 0 );
		expect( fog.base.value ).toBe( 0 );

		fog.update( room, false, 0.3 );
		expect( fog.outdoor.value ).toBeCloseTo( 0.5, 6 );
		fog.update( room, false, 0.3 );
		expect( fog.outdoor.value ).toBe( 1 );
		expect( fog.density.value ).toBe( 0.0003 );
		expect( fog.color.value.equals( fog.sky ) ).toBe( true );
		expect( scene.fogNode ).toBe( node );

	} );

	it( 'carries the room\'s radiance when indoor mist is explicitly requested', () => {

		const fog = new NightFog( new THREE.Scene(), { density: 0.0003, color: 0x8899aa, indoorDensity: 0.04 } );
		const room = { color: new THREE.Color( 1, 0.8, 0.6 ), lux: 2 };

		fog.update( room, true, 1 );

		expect( fog.indoor ).toBe( 1 );
		// The air is the room's own walls seen through it, so it sits under
		// their radiance rather than over it: a surface under illuminance E
		// returns E p / ((1 - p) pi) once its bounces settle, and the medium is
		// taken at the dark end of interior reflectance.
		const surfaces = ( p ) => room.lux * p / ( ( 1 - p ) * Math.PI );
		expect( luminance( fog.color.value ) ).toBeCloseTo( 0.2, 6 );
		expect( luminance( fog.color.value ) ).toBeLessThan( surfaces( 0.4 ) );
		expect( fog.color.value.r ).toBeGreaterThan( fog.color.value.b );
		const share = 1 - Math.exp( - ( ( fog.base.value * 10 ) ** 2 ) );
		expect( share ).toBeGreaterThan( 0 );
		expect( share ).toBeLessThan( 0.2 );

		// Back on the street the air is the street's at once, the sky fading back in.
		fog.update( { color: new THREE.Color( 0, 1, 1 ), lux: 20 }, false, 0.3 );

		expect( fog.indoor ).toBeCloseTo( 0.5, 6 );
		expect( fog.color.value.g ).toBeCloseTo( fog.sky.g * 0.5, 6 );
		expect( fog.base.value ).toBeCloseTo( fog.indoorDensity * 0.5, 6 );

	} );

} );
