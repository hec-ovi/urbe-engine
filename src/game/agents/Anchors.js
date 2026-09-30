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

// The sitting surface of each seat the interiors place, before placement scale:
// the cushion's top and its back and front edges along the seat's facing (+Z),
// from the authored zero. Measured on the module and catalogue meshes as their
// largest upward face under 0.75 m, armrests and plinths set aside.
export const SEATS = {
	'fit-chair': [ 0.56, - 0.21, 0.21 ], 'fit-sofa': [ 0.45, - 0.19, 0.4 ], 'fit-bench': [ 0.45, - 0.2, 0.2 ],
	'fit-stool': [ 0.65, - 0.18, 0.18 ], 'fit-office-chair': [ 0.5, - 0.23, 0.27 ],
	'fit-sofa-luxury': [ 0.49, - 0.15, 0.43 ], 'fit-chair-luxury': [ 0.5, - 0.14, 0.32 ],
	'fit-corporate-bench': [ 0.48, - 0.28, 0.46 ], 'fit-sofa-corpo': [ 0.42, - 0.33, 0.39 ],
	'fit-chair-corpo': [ 0.42, - 0.26, 0.31 ], 'fit-damaged-office-chair': [ 0.48, - 0.21, 0.23 ],
	'office_chair': [ 0.52, - 0.11, 0.25 ]
};
/** A seated pelvis rests this far in front of the cushion's back edge... */
const PELVIS_FROM_BACK = 0.2;
/** ...but no further from its front edge than this, so the knees clear a deep seat. */
const PELVIS_FROM_FRONT = 0.35;

/**
 * Navigation snaps a sofa's anchor onto reachable floor beside the furniture.
 * Render its occupant on the actual placement instead. The transferred Source
 * Sitting loops put the pelvis 0.34 m behind the root and the supporting thigh
 * surface about 0.49 m above it; both crowd and focused rigs share that pose.
 * The thighs rest on the cushion's top and the pelvis near its back, so the
 * lower legs hang in front of the seat instead of through it. A seat with no
 * measured surface keeps the root on its floor datum.
 */
function seatedOrigin( placement, floorY, heading ) {

	const seat = SEATS[ placement.module ];
	const pelvis = seat ? Math.max( seat[ 1 ] + PELVIS_FROM_BACK, seat[ 2 ] - PELVIS_FROM_FRONT ) * placement.scale[ 2 ] : 0;
	const forward = 0.34 + pelvis;
	return new THREE.Vector3(
		placement.position[ 0 ] + Math.sin( heading ) * forward,
		floorY + placement.position[ 1 ] + ( seat ? seat[ 0 ] * placement.scale[ 1 ] - 0.49 : 0 ),
		placement.position[ 2 ] + Math.cos( heading ) * forward
	);

}
