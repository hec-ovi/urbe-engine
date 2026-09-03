import * as THREE from 'three/webgpu';
import { pointInRing } from '../ground/Polygons.js';
import { BODY_RADIUS } from '../physics/PlayerBody.js';

/** Atlas publishes a tree anchor point, not a crown radius. */
const TREE_HEAD_CLEARANCE = 0;
/** Pedestrians and street vehicles occupy at most this much air above their route. */
const MOVEMENT_ENVELOPE_HEIGHT = 3;

/** Rejects overhead lamp heads that intersect an authored world volume. */
export class StreetLampClearance {

	constructor( atlas, walk ) {

		this.atlas = atlas;
		this.walk = walk;

	}

	allows( head ) {

		const segment = headSegment( head );
		const radius = head.width / 2;
		const top = head.underside + head.height;

		for ( const building of this.atlas.volumetric.buildings ) {

			if ( building.height >= head.underside && segmentToRing( segment, building.footprint ) < radius ) return false;

		}

		for ( const planting of this.atlas.streets.planting ) {

			if ( planting.kind === 'tree'
				&& pointToSegment( planting.position, segment[ 0 ], segment[ 1 ] ) < TREE_HEAD_CLEARANCE + radius ) return false;

		}

		for ( const highway of this.atlas.streets.highwayStructures ) {

			if ( ! clearsHighway( head, segment, radius, top, highway ) ) return false;

		}

		return clearsMovement( head, segment, radius + BODY_RADIUS, top, this.walk );

	}

}

function clearsHighway( head, segment, radius, top, highway ) {

	for ( const support of highway.supports ) {

		if ( support.top >= head.underside && segmentToRing( segment, support.footprint ) < radius ) return false;

	}

	let along = 0;

	for ( let index = 0; index < highway.path.length - 1; index ++ ) {

		const a = highway.path[ index ];
		const b = highway.path[ index + 1 ];
		const nearest = segmentDistance( segment[ 0 ], segment[ 1 ], a, b );
		const length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		const level = profileLevel( highway.elevationProfile, along + nearest.right * length );
		const bottom = level - highway.deckThickness;

		if ( nearest.distance < highway.width / 2 + radius && top > bottom && head.underside < level ) return false;
		along += length;

	}

	return true;

}

function clearsMovement( head, segment, radius, top, walk ) {

	for ( const edge of walk?.edges ?? [] ) {

		const path = edge.path3 ?? edge.path.map( ( point ) => [ point[ 0 ], edge.level ?? 0, point[ 1 ] ] );

		for ( let index = 0; index < path.length - 1; index ++ ) {

			const a = path[ index ];
			const b = path[ index + 1 ];
			const nearest = segmentDistance( segment[ 0 ], segment[ 1 ], [ a[ 0 ], a[ 2 ] ], [ b[ 0 ], b[ 2 ] ] );
			if ( nearest.distance >= radius ) continue;
			const level = THREE.MathUtils.lerp( a[ 1 ], b[ 1 ], nearest.right );
			if ( top > level && head.underside < level + MOVEMENT_ENVELOPE_HEIGHT ) return false;

		}

	}

	return true;

}

function headSegment( head ) {

	const half = head.length / 2;

	return [
		[ head.center.x - head.aim.x * half, head.center.z - head.aim.z * half ],
		[ head.center.x + head.aim.x * half, head.center.z + head.aim.z * half ]
	];

}

function segmentToRing( segment, ring ) {

	if ( pointInRing( ...segment[ 0 ], ring ) || pointInRing( ...segment[ 1 ], ring ) ) return 0;
	let distance = Infinity;

	for ( let index = 0; index < ring.length; index ++ ) {

		distance = Math.min( distance, segmentDistance(
			segment[ 0 ], segment[ 1 ], ring[ index ], ring[ ( index + 1 ) % ring.length ]
		).distance );

	}

	return distance;

}

function pointToSegment( point, a, b ) {

	return segmentDistance( point, point, a, b ).distance;

}

/** Closest distance and both normalized positions for two 2D segments. */
function segmentDistance( a, b, c, d ) {

	const ux = b[ 0 ] - a[ 0 ];
	const uz = b[ 1 ] - a[ 1 ];
	const vx = d[ 0 ] - c[ 0 ];
	const vz = d[ 1 ] - c[ 1 ];
	const wx = a[ 0 ] - c[ 0 ];
	const wz = a[ 1 ] - c[ 1 ];
	const uu = ux * ux + uz * uz;
	const uv = ux * vx + uz * vz;
	const vv = vx * vx + vz * vz;
	const uw = ux * wx + uz * wz;
	const vw = vx * wx + vz * wz;
	const denominator = uu * vv - uv * uv;
	let left = denominator > 1e-12 ? THREE.MathUtils.clamp( ( uv * vw - vv * uw ) / denominator, 0, 1 ) : 0;
	let right = vv > 1e-12 ? THREE.MathUtils.clamp( ( uv * left + vw ) / vv, 0, 1 ) : 0;
	left = uu > 1e-12 ? THREE.MathUtils.clamp( ( uv * right - uw ) / uu, 0, 1 ) : 0;
	if ( vv > 1e-12 ) right = THREE.MathUtils.clamp( ( uv * left + vw ) / vv, 0, 1 );

	return {
		distance: Math.hypot( a[ 0 ] + ux * left - c[ 0 ] - vx * right, a[ 1 ] + uz * left - c[ 1 ] - vz * right ),
		left, right
	};

}

function profileLevel( profile, distance ) {

	for ( let index = 0; index < profile.length - 1; index ++ ) {

		const a = profile[ index ];
		const b = profile[ index + 1 ];
		if ( distance > b.distance ) continue;
		const span = b.distance - a.distance;

		return THREE.MathUtils.lerp( a.level, b.level, span > 0 ? ( distance - a.distance ) / span : 0 );

	}

	return profile.at( -1 )?.level ?? 0;

}
