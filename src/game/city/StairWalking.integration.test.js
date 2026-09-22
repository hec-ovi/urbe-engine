import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { generate as exterior } from '../../../../exterior/src/index.ts';
import { generate as interior } from '../../../../interior/src/index.ts';
import { moduleRecipes } from '../../../../interior/src/modules/recipes.ts';
import { floorBoxes } from './InteriorBoxes.js';
import { floorPlacements, buildingFloors } from './InteriorLayouts.js';
import { BuildingsLoader } from './BuildingsLoader.js';
import { cityGltfLoader } from '../data/CityGltfLoader.js';
import { Physics } from '../physics/Physics.js';
import { PlayerBody } from '../physics/PlayerBody.js';
import { DoorColliders } from '../physics/DoorColliders.js';

const STEP = 1 / 60;
const catalog = new Map( moduleRecipes().map( recipe => [ recipe.id, recipe ] ) );
const bounds = id => catalog.get( id );
const factory = { resolver: { resolve: () => null }, build: () => new THREE.MeshBasicMaterial(), variant: () => new THREE.MeshBasicMaterial() };
const buildings = [
	[ 'balcony-grid', 20.5, 37.5, 7, 0, 'corpo', 'high_rich', 'plans:balcony-grid-commercial-high_rich-5x3x33f', 37.5 ],
	[ 'balcony-grid', 37.5, 20.5, 3, 37, 'corpo', 'high_rich', 'plans:balcony-grid-commercial-high_rich-5x3x33f', 19.5 ],
	[ 'corporate-sectors', 51, 39, 12, 0, 'offices', 'rich', 'corporate-contract', 57 ],
	[ 'faceted-bays', 42, 30, 10, 0, 'offices', 'rich', 'faceted-bays-reference', 48 ],
	[ 'white-grid', 32.5, 17.5, 7, 0, 'offices', 'rich', 'white-grid-reference', 34.5 ],
	[ 'mirror-shutters', 54, 34, 10, 0, 'offices', 'rich', 'mirror-shutters-reference', 48 ],
	[ 'mirror-frame', 35, 27, 8, 0, 'offices', 'rich', 'portal-pier-reference', 39 ],
	[ 'garden-taper', 52, 42, 4, 0, 'residential', 'rich', 'garden-reference', 21 ]
];

describe( 'real player collision through furnished stair cores', () => {

	it.each( buildings )(
		'walks entrances, every stair landing and roof of %s %s × %s, %s floors rotated %s°',
		async ( ...specification ) => {
			const { source, physics, city } = await building( ...specification );
			try {
				expect( source.building.floors ).toHaveLength( specification[ 3 ] );
				expect( Object.values( source.layouts ).some( layout => layout.npc.nav.roofAccess ) ).toBe( true );
				expect( city.doors.some( door => door.role === 'main' ) ).toBe( true );
				for ( const door of city.doors.filter( d => d.floor === 0 && d.kind === 'door' ) ) {
					const outside = door.center.clone().addScaledVector( door.normal, .8 );
					const inside = door.center.clone().addScaledVector( door.normal, - .8 );
					const player = new PlayerBody( physics, outside.clone().add( new THREE.Vector3( 0, .025, 0 ) ) );
					walkTo( physics, player, inside, `${door.id} entering` );
					walkTo( physics, player, outside, `${door.id} exiting` );
					physics.world.removeCollider( player.collider, true );
				}
				for ( const stair of source.layouts.ground.floor.core.stairs ) {
					const route = walkingRoute( source, stair.id );
					const player = new PlayerBody( physics, route[ 0 ].clone().add( new THREE.Vector3( 0, .025, 0 ) ) );
					for ( const [ index, point ] of route.entries() ) walkTo( physics, player, point, `${stair.id} ascent ${index}` );
					for ( const [ index, point ] of [ ...route ].reverse().entries() ) walkTo( physics, player, point, `${stair.id} descent ${index}` );
					physics.world.removeCollider( player.collider, true );
				}
			} finally { physics.world.free(); }
		}, 60_000
	);

	it.each( [ 0, Math.PI / 3 ] )( 'keeps standing and crouched players inside both visible guards at yaw %s', async yaw => {
		for ( const crouched of [ false, true ] ) for ( const direction of [ - 1, 1 ] ) {
			const physics = await Physics.create();
			try {
				const placement = { module: 'stair-flight-13', position: [ 4, 2, 5 ], rotationY: yaw, scale: [ 1, 1.1, 1 ] };
				physics.addBoxes( floorBoxes( [ placement ], 0, bounds ) );
				const start = pointOnFlight( placement, 0, .725, 1.54, 6 * .17 );
				const player = new PlayerBody( physics, start.clone().add( new THREE.Vector3( 0, .025, 0 ) ) );
				player.setCrouched( crouched );
				const movement = new THREE.Vector3( Math.cos( yaw ), 0, - Math.sin( yaw ) ).multiplyScalar( direction * 2 * STEP );
				for ( let frame = 0; frame < 90; frame ++ ) { physics.step( STEP ); player.move( movement, STEP ); }
				const across = player.feet.clone().sub( start ).dot( movement.clone().normalize() );
				expect( across ).toBeLessThan( .42 );
				expect( player.feet.y ).toBeGreaterThan( start.y - .06 );
			} finally { physics.world.free(); }
		}
	} );

} );

async function building( architecture, width, depth, floors, degrees, type, tier, seed, maxHeight ) {
	const angle = degrees * Math.PI / 180;
	const rotate = ( x, z ) => [ x * Math.cos( angle ) - z * Math.sin( angle ), x * Math.sin( angle ) + z * Math.cos( angle ) ];
	const request = {
		seed, buildingId: architecture === 'balcony-grid' ? 'walk-stairs' : `review-${architecture}`, theme: 'cyberpunk',
		parcel: { footprint: [ rotate( 0, 0 ), rotate( width, 0 ), rotate( width, depth ), rotate( 0, depth ) ],
			accessPoint: architecture === 'balcony-grid' ? rotate( 0, depth / 2 ) : rotate( width / 2, 0 ), maxHeight },
		building: { type, tier, floors }, options: { architecture, glb: 'merged' }
	};
	const { blueprint, glb } = await exterior( request, { textures: { mode: 'keys' } } );
	const source = await interior( { seed: request.seed, building: { id: request.buildingId, type, tier }, blueprint, materialTheme: 'cyberpunk' } );
	const loader = { loadAsync: async url => {
		// Imported plants are decorative; this checks the real shell and room solids.
		if ( url !== '/walk-stairs.glb' ) throw new Error( 'Decorative models have no collision' );
		return cityGltfLoader().parseAsync( glb.buffer.slice( glb.byteOffset, glb.byteOffset + glb.byteLength ), '' );
	} };
	const city = await new BuildingsLoader( factory, loader ).load( new Map( [ [ request.buildingId, {
		parcelId: request.buildingId, blueprint, shellUrl: '/walk-stairs.glb', hasInterior: true, interior: source
	} ] ] ) );
	const physics = await Physics.create();
	physics.addHalfSpace( -.01 );
	for ( const geometry of city.shellColliders.values() ) if ( geometry ) physics.addTrimesh( geometry );
	for ( const floor of buildingFloors( request.buildingId, source ) ) physics.addBoxes( floorBoxes( floorPlacements( floor ), floor.elevation, bounds ) );
	const doors = new DoorColliders( physics, city.doors );
	for ( const door of city.doors ) { door.motion.apply( door.pivots, 1 ); doors.sync( door ); }
	physics.step( STEP );
	return { source, physics, city };
}

function walkingRoute( source, stairId ) {
	const route = [];
	for ( const floor of source.building.floors ) {
		const layout = source.layouts[ floor.layout ];
		const stair = layout.floor.core.stairs.find( entry => entry.id === stairId );
		const flights = layout.placements.filter( p => p.connector === stairId && p.module?.startsWith( 'stair-flight-' ) ).sort( ( a, b ) => a.position[ 1 ] - b.position[ 1 ] );
		const door = layout.placements.filter( p => p.module === 'door-header' ).sort( ( a, b ) =>
			Math.hypot( a.position[ 0 ] - stair.entry[ 0 ], a.position[ 2 ] - stair.entry[ 1 ] )
			- Math.hypot( b.position[ 0 ] - stair.entry[ 0 ], b.position[ 2 ] - stair.entry[ 1 ] ) )[ 0 ];
		const entry = new THREE.Vector3( stair.entry[ 0 ], floor.elevation, stair.entry[ 1 ] );
		const threshold = new THREE.Vector3( door.position[ 0 ], floor.elevation, door.position[ 2 ] );
		if ( route.length ) { route.push( threshold, entry, threshold ); } else route.push( entry, threshold );
		for ( const flight of flights ) {
			const count = Number( flight.module.split( '-' ).at( - 1 ) );
			route.push( pointOnFlight( flight, floor.elevation, .725, -.55, 0 ) );
			for ( let step = 0; step < count; step ++ ) route.push( pointOnFlight( flight, floor.elevation, .725, ( step + .5 ) * .28, ( step + 1 ) * .17 ) );
			route.push( pointOnFlight( flight, floor.elevation, .725, count * .28 + .55, count * .17 ) );
		}
		const roof = layout.npc.nav.roofAccess;
		if ( roof && stairId === roof.stair ) {
			const { position, normal } = roof.door;
			route.push( new THREE.Vector3( position[ 0 ] - normal[ 0 ] * .45, floor.elevation + roof.elevation, position[ 1 ] - normal[ 1 ] * .45 ),
				new THREE.Vector3( position[ 0 ], floor.elevation + roof.elevation, position[ 1 ] ),
				new THREE.Vector3( roof.entry[ 0 ], floor.elevation + roof.elevation, roof.entry[ 1 ] ) );
		}
	}
	return route;
}

function pointOnFlight( placement, elevation, x, z, y ) {
	return new THREE.Vector3( x * placement.scale[ 0 ], y * placement.scale[ 1 ], z * placement.scale[ 2 ] )
		.applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), placement.rotationY )
		.add( new THREE.Vector3( placement.position[ 0 ], elevation + placement.position[ 1 ], placement.position[ 2 ] ) );
}

/** Every metre is character-controller movement: no teleport, lift carry, jump or height correction. */
function walkTo( physics, player, target, label ) {
	for ( let step = 0; step < 600; step ++ ) {
		const movement = target.clone().sub( player.feet ); movement.y = 0;
		if ( movement.length() < .035 ) break;
		movement.clampLength( 0, 2.5 * STEP );
		physics.step( STEP ); player.move( movement, STEP );
	}
	const distance = new THREE.Vector2( target.x - player.feet.x, target.z - player.feet.z ).length();
	for ( let frame = 0; frame < 3; frame ++ ) { physics.step( STEP ); player.move( new THREE.Vector3(), STEP ); }
	expect( distance, `${label}: requested ${target.toArray()}, reached ${player.feet.toArray()}` ).toBeLessThan( .05 );
	expect( Math.abs( player.feet.y - target.y ), `${label}: floor height ${target.y}, feet ${player.feet.y}` ).toBeLessThan( .24 );
}
