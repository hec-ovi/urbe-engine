import { describe, expect, it } from 'vitest';
import { MAX_INTERACTION_DISTANCE, PLAYER_RADIUS, reachableApproaches } from './StagingAssembler.js';

/** A 6 by 6 m room frame at the origin with its door on the -z wall. */
function room( blockedZones = [] ) {

	return {
		origin: { x: 0, y: 0, z: 0 }, yawRadians: 0, width: 6, depth: 6,
		entries: [ { entryId: 'door', position: { x: 0, z: - 2.9 }, clearanceRadius: 0.8 } ],
		blockedZones
	};

}

/** A body lying across the middle of the room, and a tag 0.15 m off its +x side. */
const body = { entityId: 'body', blocksMovement: true, localFootprint: { center: { x: 0, z: 0 }, width: 1.05, depth: 1.95 } };
const tag = { entityId: 'tag', blocksMovement: false, localFootprint: { center: { x: 0.69, z: 0.6 }, width: 0.09, depth: 0.05 } };

describe( 'evidence approaches', () => {

	it( 'sees a prop lying beside a body past it, from a point the player can stand on', () => {

		const approach = reachableApproaches( room(), [ body, tag ], new Map( [ [ 'ev', { entityId: 'tag', local: tag.localFootprint.center } ] ] ) ).get( 'ev' );
		expect( approach ).not.toBeNull();
		const standing = { x: approach.x - tag.localFootprint.center.x, z: approach.z - tag.localFootprint.center.z };
		expect( Math.hypot( standing.x, standing.z ) ).toBeLessThanOrEqual( MAX_INTERACTION_DISTANCE );
		// The player stands clear of the body by their own radius.
		const clear = Math.abs( approach.x ) > body.localFootprint.width / 2 + PLAYER_RADIUS || Math.abs( approach.z ) > body.localFootprint.depth / 2 + PLAYER_RADIUS;
		expect( clear ).toBe( true );

	} );

	it( 'finds no approach to a prop that a blocker covers', () => {

		const chest = { blockerId: 'chest', center: { x: 0.69, z: 0.6 }, width: 0.8, depth: 0.8 };
		expect( reachableApproaches( room( [ chest ] ), [ tag ], new Map( [ [ 'ev', { entityId: 'tag', local: tag.localFootprint.center } ] ] ) ).get( 'ev' ) ).toBeNull();

	} );

} );
