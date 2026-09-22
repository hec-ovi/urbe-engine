import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { generate, expandBuilding, makePlacementFixture } from '../../../../interior/src/index.ts';
import { groundAnchors } from './Anchors.js';

it( 'keeps occupants on the published chairs and sofas facing their fronts at every building rotation', async () => {

	const seen = new Set();
	for ( const rotationDeg of [ 0, 90, 180, 270 ] ) {

		const result = await generate( makePlacementFixture( {
			width: 24, depth: 32, floors: 3, rotationDeg, type: 'offices', tier: 'high_rich', seed: 11
		} ) );
		const npc = expandBuilding( result ).npc;
		const before = JSON.stringify( { result, npc } );
		const anchors = groundAnchors( npc, 0.15, result );
		const placements = new Map( result.layouts.ground.placements.map( ( item ) => [ item.id, item ] ) );
		expect( anchors.seat.length ).toBeGreaterThan( 0 );
		for ( const anchor of anchors.seat ) {

			const authored = npc.anchors.find( ( item ) => item.id === anchor.id );
			const placement = placements.get( authored.furniture.replace( /^floor:0\//, '' ) );
			const front = new THREE.Vector3( 0, 0, 1 ).applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), placement.rotationY );
			const facing = new THREE.Vector3( Math.sin( anchor.heading ), 0, Math.cos( anchor.heading ) );
			expect( facing.dot( front ) ).toBeCloseTo( 1, 7 );
			// The purchased sit clip's pelvis is 34 cm behind its root. Its body
			// must sit on the furniture, even when navigation put its approach aside.
			const hips = anchor.position.clone().addScaledVector( facing, - 0.34 );
			const cushion = new THREE.Vector3( ...placement.position )
				.addScaledVector( front, placement.module === 'fit-sofa' ? 0.105 * placement.scale[ 2 ] : 0 );
			expect( hips.x ).toBeCloseTo( cushion.x, 5 );
			expect( hips.z ).toBeCloseTo( cushion.z, 5 );
			if ( placement.module === 'fit-chair' || placement.module === 'fit-sofa' ) {

				seen.add( placement.module );
				const top = placement.module === 'fit-chair' ? 0.56 : 0.45;
				expect( anchor.position.y + 0.49 ).toBeCloseTo( 0.15 + placement.position[ 1 ] + top * placement.scale[ 1 ], 5 );

			}

		}
		// A navigation fallback may approach from the opposite side. The body
		// still faces the actual furniture's front when it finishes sitting.
		const opposite = { ...npc, anchors: npc.anchors.map( ( anchor ) => ( {
			...anchor, facingDeg: anchor.kind === 'seat' ? anchor.facingDeg + 180 : anchor.facingDeg
		} ) ) };
		expect( groundAnchors( opposite, 0.15, result ).seat.map( ( anchor ) => anchor.heading ) )
			.toEqual( anchors.seat.map( ( anchor ) => anchor.heading ) );
		expect( JSON.stringify( { result, npc } ) ).toBe( before );

	}
	expect( seen ).toEqual( new Set( [ 'fit-chair', 'fit-sofa' ] ) );

}, 15000 );

it( 'reads the published +Z yaw directly for staff and legacy anchors and excludes upper floors', () => {

	const npc = { anchors: [
		{ id: 'counter', kind: 'counter_spot', floor: 0, position: [ 4, 8 ], facingDeg: 90 },
		{ id: 'seat', kind: 'seat', floor: 0, position: [ 5, 9 ], facingDeg: 0 },
		{ id: 'upper', kind: 'seat', floor: 1, position: [ 5, 9 ], facingDeg: 180 }
	] };
	const anchors = groundAnchors( npc, 0.15 );
	expect( anchors.counter[ 0 ].heading ).toBeCloseTo( Math.PI / 2 );
	expect( anchors.seat ).toHaveLength( 1 );
	expect( anchors.seat[ 0 ].heading ).toBe( 0 );
	expect( anchors.seat[ 0 ].position.toArray() ).toEqual( [ 5, 0.15, 9 ] );

} );
