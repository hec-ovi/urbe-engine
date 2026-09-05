import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import * as THREE from 'three/webgpu';
import { BuildingsLoader } from './BuildingsLoader.js';
import { Interactor } from '../player/Interactor.js';
import { DoorColliders } from '../physics/DoorColliders.js';
import { Physics } from '../physics/Physics.js';
import { BODY_RADIUS, PlayerBody } from '../physics/PlayerBody.js';
import unsupportedDoorsSchema from './schema/unsupported-doors.schema.json';

const AXIS = new THREE.Vector3( Math.SQRT1_2, 0, Math.SQRT1_2 );
const INWARD = new THREE.Vector3( - Math.SQRT1_2, 0, Math.SQRT1_2 );
const ORIGIN = new THREE.Vector3( 2, 0, 1 );
const factory = { resolver: { resolve: () => null }, build: () => new THREE.MeshBasicMaterial() };
const point = ( u, y = 0, depth = 0 ) => ORIGIN.clone().addScaledVector( AXIS, u ).addScaledVector( INWARD, depth ).setY( y );

describe( 'authored door motion through loading, interaction and physics', () => {

	it( 'moves indexed pocket leaves into their chambers while collision and fixed casing retain their exact geometry', async () => {

		const city = await load();
		const door = city.doors[ 0 ];
		const shell = city.shellColliders.get( 'pocket' );
		const fixedPositions = Array.from( shell.getAttribute( 'position' ).array );
		const physics = await Physics.create();
		physics.addTrimesh( new THREE.PlaneGeometry( 30, 30 ).rotateX( - Math.PI / 2 ) );
		physics.addTrimesh( shell );
		const colliders = new DoorColliders( physics, city.doors );
		const player = new PlayerBody( physics, point( 5, 0.02, - 1 ) );
		const interactor = controls( city, colliders );
		const initial = new Map( door.pivots.map( leaf => [ leaf.index, leaf.pivot.position.clone() ] ) );
		const crossAt = u => {
			player.teleport( point( u, 0.02, - 1 ) );
			for ( let step = 0; step < 90; step ++ ) {
				physics.step( 1 / 60 );
				player.move( INWARD.clone().multiplyScalar( 1.4 / 60 ), 1 / 60 );
			}
			return player.feet.clone().sub( ORIGIN ).dot( INWARD );
		};
		expect( door.pivots.map( leaf => leaf.index ) ).toEqual( [ 1, 0 ] );
		expect( door.pivots.every( leaf => leaf.pivot.children.length === 2 ) ).toBe( true );
		expect( crossAt( 5 ) ).toBeLessThan( 0.2 - BODY_RADIUS + 0.06 );
		expect( interactor.update( 0, null ) ).toMatch( /open/ );
		interactor.activate( { timeMin: 0 } );

		for ( const fraction of [ 0.5, 1 ] ) {
			interactor.update( 0.5 / 2.2, null );
			physics.step( 1 / 60 );
			expect( door.open ).toBeCloseTo( fraction );
			for ( const leaf of door.pivots ) {
				const travelU = leaf.index === 0 ? - 1.1 : 1.1;
				const expected = initial.get( leaf.index ).clone().addScaledVector( AXIS, travelU * fraction );
				expect( leaf.pivot.position.distanceTo( expected ) ).toBeLessThan( 1e-7 );
				expect( leaf.pivot.quaternion.angleTo( new THREE.Quaternion() ) ).toBe( 0 );
				const collision = leaf.collision.body.translation();
				expect( new THREE.Vector3( collision.x, collision.y, collision.z ).distanceTo( expected ) ).toBeLessThan( 1e-6 );
			}
			expect( crossAt( 5 ) ).toBeGreaterThan( 0.5 );
			if ( fraction === 0.5 ) expect( crossAt( 5.6 ) ).toBeLessThan( 0.2 - BODY_RADIUS + 0.06 );
			else expect( crossAt( 5.6 ) ).toBeGreaterThan( 0.5 );
		}
		expect( Array.from( shell.getAttribute( 'position' ).array ) ).toEqual( fixedPositions );
		interactor.update( 0, null );
		interactor.activate( { timeMin: 0 } );
		interactor.update( 1 / 2.2, null );
		physics.step( 1 / 60 );
		for ( const leaf of door.pivots ) expect( leaf.pivot.position.distanceTo( initial.get( leaf.index ) ) ).toBeLessThan( 1e-7 );
		expect( crossAt( 5 ) ).toBeLessThan( 0.2 - BODY_RADIUS + 0.06 );

	} );

	it( 'uses authored swing degrees and keeps the metadata-free fallback separate', async () => {

		for ( const [ motion, degrees ] of [ [ { kind: 'swing', maxTravel: 63, clearDepth: 1 }, 63 ], [ undefined, 100 ] ] ) {
			const city = await load( { motion } );
			const interactor = controls( city );
			interactor.update( 0, null );
			interactor.activate( { timeMin: 0 } );
			interactor.update( 1 / 2.2, null );
			for ( const leaf of city.doors[ 0 ].pivots ) {
				const expected = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), leaf.sign * THREE.MathUtils.degToRad( degrees ) );
				expect( leaf.pivot.quaternion.angleTo( expected ) ).toBeLessThan( 1e-7 );
				expect( leaf.pivot.position.distanceTo( leaf.closedPosition ) ).toBe( 0 );
			}
		}

	} );

	it( 'keeps unsupported rollers and non-enterable pocket leaves fixed and collidable', async () => {

		const roller = await load( { motion: { kind: 'roller', maxTravel: 2, clearDepth: 0 } } );
		expect( new Ajv().compile( unsupportedDoorsSchema )( roller.unsupportedDoors ) ).toBe( true );
		expect( roller.unsupportedDoors ).toEqual( [ { parcelId: 'pocket', id: 'entry', kind: 'roller' } ] );
		expect( roller.doors ).toEqual( [] );
		expect( roller.entrances ).toEqual( [] );
		const closed = await load( { hasInterior: false } );
		expect( closed.doors ).toEqual( [] );
		expect( closed.unsupportedDoors ).toEqual( [] );
		for ( const city of [ roller, closed ] ) {
			expect( city.group.children.some( child => child.name.startsWith( 'shell:' ) ) ).toBe( true );
			expect( city.shellColliders.get( 'pocket' ).getAttribute( 'position' ).count ).toBe( 6 * 36 );
		}

	} );

	it( 'refuses a pocket assembly missing a published named leaf', async () => {

		await expect( load( { omitLeaf: 0 } ) ).rejects.toThrow( /E_DOOR_MOTION: incomplete named pocket leaves/ );

	} );

} );

function controls( city, doorColliders = null ) {

	return new Interactor( {
		crowd: { within: () => [] }, doors: city.doors, sim: {}, doorColliders,
		controller: { body: { feet: point( 5, 0.02, - 1 ) }, eye: point( 5, 1.1, - 1 ), look: INWARD.clone() }
	} );

}

async function load( options = {} ) {

	const motion = 'motion' in options ? options.motion : {
		kind: 'pocket', maxTravel: 1.1, clearDepth: 0,
		leaves: [ { leaf: 0, travelU: - 1.1 }, { leaf: 1, travelU: 1.1 } ].map( leaf => ( {
			...leaf, pocket: { offset: leaf.leaf === 0 ? 2.9 : 6.1, sill: 0, width: 1, height: 2, frontDepth: 0.15, backDepth: 0.25 }
		} ) )
	};
	const outline = [ point( 0 ), point( 10 ), point( 10, 0, 10 ), point( 0, 0, 10 ) ].map( p => [ p.x, p.z ] );
	const blueprint = {
		buildingId: 'pocket', bounds: { footprint: outline }, floors: [ {
			index: 0, elevation: 0, height: 3, outline,
			openings: [ { id: 'entry', kind: 'door', doorRole: 'main', edge: 0, offset: 4, width: 2, sill: 0, height: 2,
				door: { frameDepth: 0.08, motion,
					clearance: { offset: 4, sill: 0, width: 2, height: 2, backDepth: 0.4 },
					cassette: { offset: 2.8, sill: 0, width: 4.4, height: 2.1, backDepth: 0.4 } }
			} ]
		} ]
	};
	const scene = new THREE.Group();
	for ( const index of [ 1, 0 ] ) {
		if ( options.omitLeaf === index ) continue;
		const leaf = new THREE.Group();
		leaf.name = `doorentryleaf${index}`;
		leaf.position.copy( point( 4.5 + index, 0, 0.2 ) );
		leaf.rotation.y = - Math.PI / 4;
		leaf.add( box( 'panel', [ 1, 2, 0.08 ], [ 0, 1, 0 ] ), box( 'finish', [ 0.8, 1.8, 0.01 ], [ 0, 1, - 0.045 ] ) );
		scene.add( leaf );
	}
	for ( const u of [ 3.5, 6.5 ] ) {
		const casing = box( 'mergedcassette', [ 0.9, 2.1, 0.04 ], point( u, 1.05, 0.4 ).toArray() );
		casing.rotation.y = - Math.PI / 4;
		scene.add( casing );
	}
	return new BuildingsLoader( factory, { loadAsync: async () => ( { scene } ) } ).load( new Map( [ [ 'pocket', {
		parcelId: 'pocket', blueprint, shellUrl: '/pocket.glb', hasInterior: options.hasInterior ?? true
	} ] ] ) );

}

function box( name, dimensions, position ) {

	const material = new THREE.MeshBasicMaterial();
	material.name = 'cyberpunk/door/mid';
	const mesh = new THREE.Mesh( new THREE.BoxGeometry( ...dimensions ), material );
	mesh.position.fromArray( position );
	mesh.name = name;
	return mesh;

}
