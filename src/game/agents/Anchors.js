import * as THREE from 'three/webgpu';

/**
 * The ground-floor anchors an interior publishes (../../../../interior/CONTRACT.md
 * npc.json), as the crowd takes them: the counter a person on duty serves at,
 * the work spots behind it, and the seats a guest sits on, in world space at
 * the lobby floor height. facingDeg counts from
 * +x toward +z; a body heading is the yaw whose forward is (sin, cos).
 */
const ANCHOR_KINDS = { counter_spot: 'counter', work_spot: 'work', seat: 'seat' };

export function groundAnchors( npc, y ) {

	const anchors = { counter: [], work: [], seat: [] };

	for ( const anchor of npc?.anchors ?? [] ) {

		const list = anchors[ ANCHOR_KINDS[ anchor.kind ] ] ?? null;
		if ( ! list || anchor.floor !== 0 ) continue;

		const facing = THREE.MathUtils.degToRad( anchor.facingDeg );
		list.push( {
			id: anchor.id,
			position: new THREE.Vector3( anchor.position[ 0 ], y, anchor.position[ 1 ] ),
			heading: Math.atan2( Math.cos( facing ), Math.sin( facing ) )
		} );

	}

	for ( const list of Object.values( anchors ) ) list.sort( ( a, b ) => a.id.localeCompare( b.id ) );

	return anchors;

}
