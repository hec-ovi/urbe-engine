import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Elevators, LIFT_MODULES } from './Elevators.js';
import { floorBoxes } from './InteriorBoxes.js';
import { Interactor } from '../player/Interactor.js';
import { Physics } from '../physics/Physics.js';
import { PlayerBody } from '../physics/PlayerBody.js';
import { moduleRecipes } from '../../../../interior/src/modules/recipes.ts';
import { PlacementBuilder } from '../../../../interior/src/placements/builder.ts';
import { lifts } from '../../../../interior/src/placements/lifts.ts';
import { makeFrame, uvToWorld, uvRectToFrameRect } from '../../../../interior/src/layout/uv.ts';
import { LIFT_CAR } from '../../../../interior/src/geometry/lift-spec.ts';

const STEP = 1 / 60;
const recipes = new Map( moduleRecipes().map( ( recipe ) => [ recipe.id, recipe ] ) );
const material = new THREE.MeshBasicMaterial();
const factory = { build: () => material, variant: () => material };

/** The module catalog as the city hands it over, built from Interior's own recipes. */
const catalog = {
	boundsOf: ( id ) => recipes.get( id ),
	surfacesOf: ( id ) => recipes.get( id ).mesh.materials().map( ( slot ) => {

		const part = recipes.get( id ).mesh.getGroup( slot );
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( part.positions, 3 ) );
		geometry.setIndex( Array.from( part.indices ) );
		return { geometry: geometry.toNonIndexed(), material };

	} )
};

describe( 'a lift ridden through its own controls', () => {

	it.each( [ 0, 37, 90, 135 ] )( 'chooses real stops with the cabin buttons and the floor keys in a %s degree core', ( angle ) => {

		const { shaft, elevators } = fixture( angle );
		const body = standing( new THREE.Vector3( shaft.centre.x, 0.025, shaft.centre.z ) );
		const { controller, interactor, pressed, aim } = controls( elevators, body );
		const button = ( action ) => elevators.panels( body.feet, 3.2 ).find( ( target ) => target.action === action );

		const up = button( 'up' );
		expect( up.center.distanceTo( shaft.worldPoint( LIFT_CAR.panel.buttons[ 0 ].position ) ) ).toBeLessThan( 1e-8 );
		expect( up.center.distanceTo( body.feet ) ).toBeGreaterThan( 1 );

		// Looking at the doors aims at no button.
		controller.look.copy( shaft.worldPoint( [ 0, 1.7, - 1 ] ) ).sub( controller.eye ).normalize();
		interactor.update( STEP );
		expect( interactor.target ).toBeNull();

		aim( up );
		expect( interactor.target.action ).toBe( 'up' );
		interactor.activate( { timeMin: 0 } );
		expect( shaft.stops[ shaft.selected ].floor ).toBe( 7 );
		expect( shaft.screen.userData.floor ).toBe( 7 );

		// Looking away from the panel, the floor keys still choose, and E presses nothing.
		controller.look.copy( shaft.worldPoint( [ 0, 1.7, 1 ] ) ).sub( controller.eye ).normalize();
		pressed.add( 'PageDown' );
		interactor.update( STEP );
		expect( shaft.stops[ shaft.selected ].floor ).toBe( 2 );
		expect( interactor.target ).toBeNull();

		aim( button( 'go' ) );
		expect( interactor.target.action ).toBe( 'go' );
		interactor.activate( { timeMin: 0 } );
		run( elevators, body, 500 );

		expect( shaft.at ).toBe( 4.5 );
		expect( body.feet.y ).toBeCloseTo( 4.525 );
		expect( shaft.stopAt( 2 ).open ).toBe( 1 );
		expect( shaft.lens.position.y ).toBeCloseTo( 4.5 + LIFT_CAR.lens.center[ 1 ] - 0.015 );
		// The car's lights never join the scene's lights.
		expect( shaft.cab.getObjectsByProperty( 'isLight', true ) ).toHaveLength( 0 );
		expect( elevators.cabs.bounce.parent ).toBeNull();
		expect( shaft.cabBoxes().every( ( box ) => Math.abs( box.rotationY + angle * Math.PI / 180 ) < 1e-8 ) ).toBe( true );

	} );

	it( 'holds a rider by the rotated car, not by the corners of its bounding box', () => {

		const { shaft } = fixture( 45 );
		const inside = shaft.worldPoint( [ 0.8, 0, 0.8 ] );

		expect( shaft.holds( new THREE.Vector3( shaft.centre.x + 1.6, 0.025, shaft.centre.z + 1.6 ) ) ).toBe( false );
		expect( shaft.holds( inside ) ).toBe( true );
		expect( shaft.stopAt( 0 ).owns( inside.toArray() ) ).toBe( true );

	} );

	it( 'keeps the leaves solid until they are fully open, and stays put while somebody stands in the doorway', () => {

		const solids = new Map();
		const { shaft, elevators } = fixture( 0, { solid: ( id, boxes ) => solids.set( id, boxes ), drop: ( id ) => solids.delete( id ) } );
		const stop = shaft.stopAt( 0 );
		const landing = `lift:${shaft.id}@0`;
		const body = standing( new THREE.Vector3( shaft.centre.x, 0.025, - 0.8 ) );

		shaft.press( { inside: false, stop } );
		elevators.update( 0.2, body );
		expect( stop.open ).toBeGreaterThan( 0 );
		expect( solids.has( landing ) ).toBe( true );
		elevators.update( 2, body );
		expect( stop.open ).toBe( 1 );
		expect( solids.has( landing ) ).toBe( false );

		body.feet.z = 0.05;
		shaft.select( 1 );
		shaft.press( { inside: true } );
		run( elevators, body, 60 );
		expect( shaft.at ).toBe( 0 );
		expect( shaft.blocked ).toBe( true );
		expect( stop.open ).toBe( 1 );

		body.feet.set( shaft.centre.x, 0.025, shaft.centre.z );
		run( elevators, body, 500 );
		expect( shaft.at ).toBe( 4.5 );
		expect( shaft.blocked ).toBe( false );

	} );

	it.each( [ 0, 37, 90 ] )( 'lets a real player call, enter, ride and leave a %s degree car through its controls', async ( angle ) => {

		const physics = await Physics.create();
		const solids = new Map();
		const port = {
			solid: ( id, boxes ) => solids.set( id, physics.addBoxes( boxes ) ),
			drop: ( id ) => {

				const handle = solids.get( id );
				if ( handle ) physics.world.removeRigidBody( handle.body );
				solids.delete( id );

			}
		};

		try {

			const { shaft, elevators, builder, core, floors } = fixture( angle, port );
			const [ apronX, apronZ ] = uvToWorld( [ 1.75, - 1 ], core.frame );

			for ( const floor of floors ) {

				physics.addBoxes( [
					...floorBoxes( builder.placements, floor.elevation, catalog.boundsOf ),
					{ center: [ apronX, floor.elevation - 0.075, apronZ ], halfExtents: [ 2, 0.075, 1 ], rotationY: - angle * Math.PI / 180 }
				] );

			}

			const [ x, z ] = uvToWorld( [ 1.75, - 0.8 ], core.frame );
			const body = new PlayerBody( physics, new THREE.Vector3( x, 0.025, z ) );
			const { interactor, aim } = controls( elevators, body );
			const tick = ( direction, frames ) => {

				for ( let frame = 0; frame < frames; frame ++ ) {

					physics.step( STEP );
					body.move( direction, STEP );
					elevators.update( STEP, body );

				}

			};
			const buttons = () => elevators.panels( body.feet, 3.2 );

			aim( buttons().find( ( target ) => target.stop?.floor === 0 ) );
			interactor.activate( { timeMin: 0 } );
			tick( new THREE.Vector3(), 100 );
			expect( shaft.stopAt( 0 ).open ).toBe( 1 );

			const [ dx, dz ] = uvToWorld( [ 0, 1 ], core.frame );
			const forward = new THREE.Vector3( dx, 0, dz ).multiplyScalar( 0.05 );
			tick( forward, 50 );
			expect( shaft.holds( body.feet ) ).toBe( true );

			aim( buttons().find( ( target ) => target.action === 'up' ) );
			interactor.activate( { timeMin: 0 } );
			aim( buttons().find( ( target ) => target.action === 'go' ) );
			interactor.activate( { timeMin: 0 } );
			tick( new THREE.Vector3(), 500 );
			expect( shaft.at ).toBe( 4.5 );
			expect( body.feet.y ).toBeCloseTo( 4.52, 2 );
			expect( body.carried ).toBe( false );
			expect( shaft.stopAt( 2 ).open ).toBe( 1 );

			tick( forward.clone().negate(), 50 );
			expect( shaft.holds( body.feet ) ).toBe( false );
			expect( body.feet.y ).toBeCloseTo( 4.52, 2 );

		} finally {

			physics.world.free();

		}

	} );

	it( 'serves a call queued during travel after arriving, and runs a landing built again open', () => {

		const { shaft, elevators, builder } = fixture();
		const body = standing( new THREE.Vector3( 10, 0.025, - 2 ) );

		shaft.press( { inside: false, stop: shaft.stopAt( 7 ) } );
		shaft.press( { inside: false, stop: shaft.stopAt( 2 ) } );
		expect( shaft.pendingCalls ).toHaveLength( 1 );
		run( elevators, body, 1200 );
		expect( shaft.at ).toBe( 4.5 );
		expect( shaft.stopAt( 2 ).open ).toBe( 1 );

		elevators.release( 'p', 2 );
		elevators.mount( 'p', 2, builder.placements.find( ( placement ) => placement.module === 'lift-doors' ), catalog, new THREE.Group() );
		run( elevators, body, 100 );
		expect( shaft.stopAt( 2 ).open ).toBe( 1 );
		expect( shaft.stopAt( 2 ).leaves.every( ( leaf ) => leaf.position.length() > 0.5 ) ).toBe( true );

	} );

	it( 'installs the tables its area light shades with, which a tier without room strips never does', () => {

		const { elevators } = fixture();
		const node = elevators.cabs.lens;

		// Setting up the light reads the installed LTC tables; without them it throws.
		expect( () => node.setupDirectRectArea( { isAvailable: () => false } ) ).not.toThrow();
		expect( () => node.setupDirectRectArea( { isAvailable: () => true } ) ).not.toThrow();

	} );

	it( 'reads an older world\'s smaller car at its own size, without the panel, cheeks and display it never had', () => {

		// The 2 m car worlds assembled before the spec publish, open at its front.
		const older = {
			boundsOf: ( id ) => id === 'lift-car' ? { size: [ 2, 2.7, 2 ], origin: [ 1, 0.1, 1 ] } : catalog.boundsOf( id ),
			surfacesOf: catalog.surfacesOf
		};
		const { shaft, elevators } = fixture( 0, null, older );
		const body = standing( new THREE.Vector3( shaft.centre.x, 0.025, shaft.centre.z ) );

		expect( shaft.panelled ).toBe( false );
		expect( shaft.screen ).toBeNull();
		expect( shaft.carScale.x ).toBeCloseTo( 2 / LIFT_CAR.width * shaft.car.scale.x, 8 );

		// Floor, both walls, back wall and roof, at the older car's size.
		const boxes = shaft.cabBoxes();
		expect( boxes ).toHaveLength( 5 );
		const reach = Math.max( ...boxes.map( ( box ) => Math.abs( box.center[ 0 ] - shaft.centre.x ) + box.halfExtents[ 0 ] ) );
		expect( reach ).toBeCloseTo( shaft.car.scale.x, 6 );
		// A step past its side wall is out of it, where the authored car would still hold it.
		const past = new THREE.Vector3( shaft.centre.x + 1.1 * shaft.car.scale.x, 0.025, shaft.centre.z );
		expect( shaft.holds( past ) ).toBe( false );
		expect( fixture().shaft.holds( past ) ).toBe( true );

		// E anywhere in it travels to the chosen floor, as it did before the spec.
		const { interactor, aim } = controls( elevators, body );
		const [ target ] = elevators.panels( body.feet, 3.2 );
		expect( target.inside ).toBe( true );
		expect( target.action ).toBeUndefined();
		aim( target );
		interactor.activate( { timeMin: 0 } );
		run( elevators, body, 500 );
		expect( shaft.at ).toBe( 4.5 );

	} );

	it.each( [ 0, 37 ] )( 'shuts the car\'s own leaves whenever it travels and runs them with the landing\'s where it stands, in a %s degree core', ( angle ) => {

		const { shaft, elevators } = fixture( angle );
		const body = standing( new THREE.Vector3( shaft.centre.x, 0.025, shaft.centre.z ) );

		// The published front rides in the cab: two leaves and the head with its sill, lit by this car's lens.
		expect( shaft.carDoors.fallback ).toBe( false );
		expect( shaft.carDoors.leaves ).toHaveLength( 2 );
		expect( shaft.carDoors.pivot.parent ).toBe( shaft.cab );
		expect( shaft.carParts.get( 'lift-car-head' ).parent ).toBe( shaft.cab );
		for ( const leaf of shaft.carDoors.leaves ) for ( const mesh of leaf.children ) expect( mesh[ Symbol.for( 'urbe.lift-cab' ) ] ).toBe( shaft );
		// Shut, the leaves meet: each stands at the zero it was authored against.
		for ( const leaf of shaft.carDoors.leaves ) expect( leaf.position.length() ).toBeLessThan( 1e-9 );
		// The front stands at the car's front, ahead of the car and behind the landing leaves.
		const front = shaft.localPoint( shaft.carDoors.pivot.getWorldPosition( new THREE.Vector3() ), new THREE.Vector3() );
		expect( front.z ).toBeCloseTo( - LIFT_CAR.depth / 2 * shaft.carScale.z, 6 );

		shaft.press( { inside: false, stop: shaft.stopAt( 0 ) } );
		run( elevators, body, 120 );
		expect( shaft.stopAt( 0 ).open ).toBe( 1 );
		expect( shaft.carOpen ).toBe( 1 );
		// Open, each car leaf has run half the pair's width clear of the car's doorway.
		for ( const leaf of shaft.carDoors.leaves ) expect( Math.abs( leaf.position.x ) ).toBeCloseTo( LIFT_CAR.door.leaf, 6 );

		shaft.select( 1 );
		shaft.press( { inside: true } );
		let travelled = 0;
		for ( let frame = 0; frame < 900 && ( travelled === 0 || shaft.moving ); frame ++ ) {

			const from = shaft.at;
			elevators.update( STEP, body );
			// Every leaf of the car closes in step with the landing's.
			if ( shaft.at === 0 ) expect( shaft.carOpen ).toBeCloseTo( shaft.stopAt( 0 ).open, 9 );
			// And all of them are shut from before the cab leaves until it stands at a floor again.
			if ( shaft.at !== from || shaft.stops.every( ( stop ) => Math.abs( stop.elevation - shaft.at ) > 0.05 ) ) {

				travelled ++;
				expect( shaft.carOpen ).toBe( 0 );
				expect( shaft.stops.every( ( stop ) => stop.open === 0 ) ).toBe( true );
				for ( const leaf of shaft.carDoors.leaves ) expect( leaf.position.length() ).toBeLessThan( 1e-9 );

			}

		}
		expect( travelled ).toBeGreaterThan( 60 );
		expect( shaft.at ).toBe( 4.5 );
		run( elevators, body, 120 );
		expect( shaft.stopAt( 2 ).open ).toBe( 1 );
		expect( shaft.carOpen ).toBe( 1 );

	} );

	it( 'cuts a car front from the landing\'s leaves for a world published before the car had one, and gives way to the published one', () => {

		const older = new Set( [ 'lift-car', 'lift-doors' ] );
		const { shaft, elevators, builder } = fixture( 0, null, catalog, older );
		const body = standing( new THREE.Vector3( shaft.centre.x, 0.025, shaft.centre.z ) );

		expect( shaft.carDoors.fallback ).toBe( true );
		expect( shaft.carDoors.leaves ).toHaveLength( 2 );
		expect( shaft.carDoors.pivot.userData.head.parent ).toBe( shaft.cab );
		// Cut leaves stand in the clearance ahead of the car, clear of the landing's.
		shaft.cab.updateMatrixWorld( true );
		const box = new THREE.Box3().setFromObject( shaft.carDoors.pivot );
		const local = [ box.min, box.max ].map( ( corner ) => shaft.localPoint( corner, new THREE.Vector3() ) );
		const depth = LIFT_CAR.depth / 2 * shaft.carScale.z;
		for ( const corner of local ) {

			expect( - corner.z ).toBeGreaterThan( depth );
			expect( - corner.z ).toBeLessThan( depth + 0.05 );

		}
		shaft.selected = 1;
		shaft.press( { inside: true } );
		let travelled = 0;
		for ( let frame = 0; frame < 900 && ( travelled === 0 || shaft.moving ); frame ++ ) {

			elevators.update( STEP, body );
			if ( shaft.at === 0 || ! shaft.moving ) continue;
			travelled ++;
			// Cut from a landing published with a seam, the shut pair still meets.
			const [ left, right ] = shaft.carDoors.leaves;
			expect( left.position.x ).toBeGreaterThanOrEqual( 0 );
			expect( right.position.x ).toBeLessThanOrEqual( 0 );
			expect( left.position.x - right.position.x ).toBeLessThan( 0.02 );

		}
		expect( travelled ).toBeGreaterThan( 60 );
		expect( shaft.at ).toBe( 4.5 );

		// The published front, once a floor carries it, takes over.
		for ( const placement of builder.placements.filter( ( one ) => one.module === 'lift-car-doors' ) ) elevators.mount( 'p', 2, placement, catalog, new THREE.Group() );
		expect( shaft.carDoors.fallback ).toBe( false );
		expect( shaft.cab.children.filter( ( child ) => child.name.startsWith( 'lift-car-doors' ) ) ).toHaveLength( 1 );
		expect( shaft.cab.children.some( ( child ) => child === shaft.carDoors.pivot ) ).toBe( true );

	} );

	it( 'cuts the front for a car whose landing mounted before it, and lets go of what it cut with the shaft', () => {

		const older = new Set( [ 'lift-doors', 'lift-car' ] );
		const { shaft, elevators } = fixture( 0, null, catalog, older, true );
		expect( shaft.carDoors?.fallback ).toBe( true );
		const cut = [ ...shaft.carGeometry ];
		expect( cut.length ).toBeGreaterThan( 0 );
		const disposed = cut.map( ( geometry ) => {

			let count = 0;
			geometry.addEventListener( 'dispose', () => count ++ );
			return () => count;

		} );
		elevators.remove( 'p' );
		expect( disposed.every( ( count ) => count() === 1 ) ).toBe( true );
		expect( shaft.carDoors ).toBe( null );

	} );

	it( 'still stands the authored car, with its panel, cheeks and display, from a catalog that publishes it', () => {

		const { shaft } = fixture();

		expect( shaft.panelled ).toBe( true );
		expect( shaft.screen ).not.toBeNull();
		expect( shaft.cabBoxes() ).toHaveLength( 7 );
		expect( shaft.carScale.toArray() ).toEqual( shaft.car.scale.toArray() );

	} );

} );

/**
 * One 3.5 m shaft serving floors 0, 2 and 7 of a core turned `angle` degrees,
 * placed as Interior places it; `mounted` picks the lift modules a world
 * publishes, all of them unless an older world is asked for, and
 * `landingsFirst` mounts each floor's landing before its car.
 */
function fixture( angle = 0, colliders = null, modules = catalog, mounted = LIFT_MODULES, landingsFirst = false ) {

	const core = {
		frame: makeFrame( angle ), vFace: 0,
		elevators: [ { id: 'elev-0', rect: { u: 0, v: 0, lu: 3.5, lv: 3.5 } } ]
	};
	const builder = new PlacementBuilder();
	lifts( builder, core, 'floor-slab-stone', 'lobby', 4.5 );

	const floors = [ 0, 2, 7 ].map( ( floor, index ) => ( {
		floor, elevation: index * 4.5, height: 4.5, coreAngleDeg: angle,
		core: { elevators: core.elevators.map( ( lift ) => ( { id: lift.id, rect: uvRectToFrameRect( lift.rect, core.frame ), doorEdge: 0 } ) ) }
	} ) );
	const elevators = new Elevators( factory, colliders );
	const [ shaft ] = elevators.add( 'p', floors, new THREE.Group() );

	for ( const floor of floors ) {

		const placements = builder.placements.filter( ( one ) => mounted.has( one.module ) );
		if ( landingsFirst ) placements.sort( ( a, b ) => Number( b.module === 'lift-doors' ) - Number( a.module === 'lift-doors' ) );
		for ( const placement of placements ) {

			expect( elevators.mount( 'p', floor.floor, placement, modules, new THREE.Group() ) ).toBe( true );

		}

	}

	return { core, builder, floors, elevators, shaft };

}

/** A body that stands where it is put. */
function standing( feet ) {

	return { feet, teleport( point ) { this.feet.copy( point ); } };

}

/** The Interactor a locked-pointer player drives, and a way to aim it at a target. */
function controls( elevators, body ) {

	const pressed = new Set();
	const controller = {
		body,
		get eye() { return body.feet.clone().add( new THREE.Vector3( 0, 1.7, 0 ) ); },
		look: new THREE.Vector3( 0, 0, 1 ),
		input: { locked: true, consume: ( key ) => pressed.delete( key ) }
	};
	const interactor = new Interactor( { crowd: { within: () => [] }, doors: [], sim: {}, controller, elevators } );
	const aim = ( target ) => {

		controller.look.copy( target.center ).sub( controller.eye ).normalize();
		interactor.update( STEP );

	};

	return { controller, interactor, pressed, aim };

}

function run( elevators, body, frames ) {

	for ( let frame = 0; frame < frames; frame ++ ) elevators.update( STEP, body );

}
