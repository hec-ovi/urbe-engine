import * as THREE from 'three/webgpu';

/**
 * The ground-floor anchors an interior publishes (../../../../interior/CONTRACT.md
 * npc.json), as the crowd takes them: the counter a person on duty serves at,
 * the work spots behind it, and the seats a guest sits on, in world space at
 * the lobby floor height. Interior facingDeg is a +Y yaw: zero faces +Z,
 * ninety degrees faces +X, exactly as the authored characters do.
 */
const ANCHOR_KINDS = { counter_spot: 'counter', work_spot: 'work', seat: 'seat' };

export function groundAnchors( npc, y, interior = null ) {

	const anchors = { counter: [], work: [], seat: [] };
	const floor = interior?.building?.floors?.find( ( entry ) => entry.index === 0 );
	const layout = floor && interior.layouts?.[ floor.layout ];
	const furniture = new Map( ( layout?.placements ?? [] ).map( ( item ) => [ item.id, item ] ) );

	for ( const anchor of npc?.anchors ?? [] ) {

		const list = anchors[ ANCHOR_KINDS[ anchor.kind ] ] ?? null;
		if ( ! list || anchor.floor !== 0 ) continue;

		const placement = anchor.kind === 'seat' && anchor.furniture
			? furniture.get( anchor.furniture.replace( /^floor:0\//, '' ) )
			: null;
		const heading = placement?.rotationY ?? THREE.MathUtils.degToRad( anchor.facingDeg );
		list.push( {
			id: anchor.id,
			position: placement ? seatedOrigin( placement, y, heading )
				: new THREE.Vector3( anchor.position[ 0 ], y, anchor.position[ 1 ] ),
			heading
		} );

	}

	for ( const list of Object.values( anchors ) ) list.sort( ( a, b ) => a.id.localeCompare( b.id ) );

	return anchors;

}

// Authored support planes of the shared Interior modules, before placement scale.
// Catalogue props retain their floor datum when no support plane is published.
const SEAT_TOP = { 'fit-chair': 0.56, 'fit-sofa': 0.45, 'fit-bench': 0.45, 'fit-stool': 0.65 };
const SEAT_FORWARD = { 'fit-sofa': 0.105 };

/**
 * Navigation snaps a sofa's anchor onto reachable floor beside the furniture.
 * Render its occupant on the actual placement instead. The transferred Source
 * Sitting loops put the pelvis 0.34 m behind the root and the supporting thigh
 * surface about 0.49 m above it; both crowd and focused rigs share that pose.
 */
function seatedOrigin( placement, floorY, heading ) {

	const top = SEAT_TOP[ placement.module ];
	const forward = 0.34 + ( SEAT_FORWARD[ placement.module ] ?? 0 ) * placement.scale[ 2 ];
	return new THREE.Vector3(
		placement.position[ 0 ] + Math.sin( heading ) * forward,
		floorY + placement.position[ 1 ] + ( top === undefined ? 0 : top * placement.scale[ 1 ] - 0.49 ),
		placement.position[ 2 ] + Math.cos( heading ) * forward
	);

}
