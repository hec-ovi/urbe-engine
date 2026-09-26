/**
 * Placement geometry for authored scene elements inside one measured frame,
 * shared by investigation scenes and staged scenery. Pure: the same request
 * gives byte-equivalent placements on the same JavaScript runtime, and nothing
 * is added that the request does not name.
 *
 * A frame is `location`: a world origin and yaw, a width along local x and a
 * depth along local z, entries, blocked zones and receiving surfaces. Bodies
 * and props are footprints snapped to quarter turns; decals are fitted on a
 * surface's own (u, v) frame. Failures go through `fail.geometry(message)` for
 * references and frames that disagree, and `fail.noFit(message)` for elements
 * that cannot be placed, so each caller throws its own error type.
 */

export const ENTITY_GAP = 0.12;
export const PLAYER_RADIUS = 0.35;
export const MAX_INTERACTION_DISTANCE = 2.25;
const EPSILON = 1e-6;

/** Ids, frames, entries, surfaces and references that must agree before anything is placed. */
export function validateStaging( request, fail ) {

	const entities = [ ...request.bodies, ...request.props ];
	const entityIds = unique( entities.map( ( item ) => item.entityId ), 'entity', fail );
	const decalIds = unique( request.decals.map( ( item ) => item.entityId ), 'decal entity', fail );
	for ( const id of decalIds ) if ( entityIds.has( id ) ) fail.geometry( `duplicate visual entity id ${id}` );
	const location = request.location;
	const surfaceIds = unique( location.receivingSurfaces.map( ( item ) => item.surfaceId ), 'surface', fail );
	unique( location.entries.map( ( item ) => item.entryId ), 'entry', fail );
	unique( location.blockedZones.map( ( item ) => item.blockerId ), 'blocker', fail );

	for ( const entry of location.entries ) {

		if ( ! containsPoint( location, entry.position ) ) fail.geometry( `entry ${entry.entryId} is outside the scene frame` );

	}

	for ( const entity of entities ) {

		unique( ( entity.materials ?? [] ).map( ( material ) => material.slot ), `material slot on ${entity.entityId}`, fail );
		if ( entity.missionAsset ) validateMissionAssetProp( entity, fail );
		const near = entity.placement.nearEntityId;
		if ( near && ! entityIds.has( near ) ) fail.geometry( `${entity.entityId} references unknown near entity ${near}` );
		if ( near === entity.entityId ) fail.geometry( `${entity.entityId} cannot be near itself` );

	}

	for ( const surface of location.receivingSurfaces ) validateSurface( surface, fail );

	for ( const decal of request.decals ) {

		if ( ! surfaceIds.has( decal.surfaceId ) ) fail.geometry( `${decal.entityId} references unknown surface ${decal.surfaceId}` );
		if ( decal.nearEntityId && ! entityIds.has( decal.nearEntityId ) ) {

			fail.geometry( `${decal.entityId} references unknown near entity ${decal.nearEntityId}` );

		}
		if ( decal.nearEntityId && decal.localCenter ) fail.geometry( `${decal.entityId} has two decal anchors` );

	}

}

/**
 * Bodies first, then props, each placed once every entity it is placed near
 * stands. Returns the internal records: the authored entity plus its local
 * footprint, local yaw and whether it blocks movement.
 */
export function placeEntities( request, fail ) {

	const source = [
		...request.bodies.map( ( entity, order ) => ( { ...entity, role: 'body', order } ) ),
		...request.props.map( ( entity, order ) => ( { ...entity, role: 'prop', order: request.bodies.length + order } ) )
	];
	const pending = [ ...source ];
	const placed = [];
	const byId = new Map();

	while ( pending.length ) {

		const ready = pending.filter( ( entity ) => ! entity.placement.nearEntityId || byId.has( entity.placement.nearEntityId ) );
		if ( ! ready.length ) fail.geometry( 'entity placement references contain a cycle' );
		ready.sort( ( left, right ) => left.order - right.order );

		for ( const entity of ready ) {

			const result = placeEntity( request, entity, placed, byId, fail );
			placed.push( result );
			byId.set( result.entityId, result );
			pending.splice( pending.indexOf( entity ), 1 );

		}

	}

	return placed;

}

/** One placed entity in world space: its origin from the declared ground contact, its yaw and footprint. */
export function publicEntity( location, entity ) {

	const contact = localToWorld( location, entity.localFootprint.center );
	const yaw = normalizeRadians( location.yawRadians + entity.localYaw );
	const groundContact = entity.asset?.groundContact ?? entity.missionAsset.groundContactOrigin;
	const ground = rotate2( { x: groundContact.x, z: groundContact.z }, yaw );
	const origin = {
		x: round( contact.x - ground.x ),
		y: round( location.origin.y - groundContact.y ),
		z: round( contact.z - ground.z )
	};
	return {
		entityId: entity.entityId,
		role: entity.role,
		...( entity.asset ? { asset: structuredClone( entity.asset ) } : {} ),
		...( entity.missionAsset ? { missionAsset: structuredClone( entity.missionAsset ) } : {} ),
		dimensions: structuredClone( entity.dimensions ),
		...( entity.poseId ? { poseId: entity.poseId } : {} ),
		...( entity.animationAsset ? { animationAsset: structuredClone( entity.animationAsset ) } : {} ),
		...( entity.sourceMaterialPolicy ? { sourceMaterialPolicy: entity.sourceMaterialPolicy } : {} ),
		...( entity.appearance ? { appearance: structuredClone( entity.appearance ) } : {} ),
		transform: { position: origin, yawRadians: yaw },
		footprint: {
			center: { x: contact.x, z: contact.z },
			width: entity.dimensions.width,
			depth: entity.dimensions.depth,
			yawRadians: yaw
		},
		...( entity.materials ? { materials: structuredClone( entity.materials ) } : {} ),
		blocksMovement: entity.blocksMovement,
		...( entity.role === 'prop' ? { portable: entity.portable } : {} ),
		...( entity.evidenceId ? { evidenceId: entity.evidenceId } : {} )
	};

}

/** Every decal fitted on its surface, clear of blocked regions and of the footprints it is not near. */
export function placeDecals( request, entities, fail ) {

	const byEntity = new Map( entities.map( ( entity ) => [ entity.entityId, entity ] ) );
	const bySurface = new Map( request.location.receivingSurfaces.map( ( surface ) => [ surface.surfaceId, surface ] ) );

	return request.decals.map( ( decal ) => {

		const surface = bySurface.get( decal.surfaceId );
		const desired = decal.localCenter ?? projectedNearPoint( decal, surface, byEntity, request.location, request.seed );
		const center = fitDecal( request.seed, decal, surface, desired, entities, request.location, fail );
		const position = add3(
			surface.origin,
			scale3( surface.uAxis, center.x ),
			scale3( surface.vAxis, center.z ),
			scale3( surface.normal, decal.offsetMeters )
		);

		return {
			entityId: decal.entityId,
			surfaceId: decal.surfaceId,
			transform: {
				position: roundedVector( position ),
				uAxis: structuredClone( surface.uAxis ),
				vAxis: structuredClone( surface.vAxis ),
				normal: structuredClone( surface.normal )
			},
			width: decal.width,
			height: decal.height,
			offsetMeters: decal.offsetMeters,
			material: structuredClone( decal.material ),
			...( decal.evidenceId ? { evidenceId: decal.evidenceId } : {} )
		};

	} );

}

/**
 * The nearest point to each visual an entrance reaches on a walking grid
 * around every blocker, within interaction distance and in clear line to the
 * visual, or null where there is none. `visuals` maps a key to
 * `{ entityId, relatedEntityId?, local }`.
 */
export function reachableApproaches( location, entities, visuals ) {

	const area = location.width * location.depth;
	const step = Math.max( 0.35, Math.sqrt( area / 150000 ) );
	const columns = Math.max( 1, Math.floor( location.width / step ) );
	const rows = Math.max( 1, Math.floor( location.depth / step ) );
	const cellWidth = location.width / columns;
	const cellDepth = location.depth / rows;
	const blocked = [
		...location.blockedZones.map( ( zone ) => ( { ...zone, width: zone.width + PLAYER_RADIUS * 2, depth: zone.depth + PLAYER_RADIUS * 2 } ) ),
		...entities.filter( ( entity ) => entity.blocksMovement ).map( ( entity ) => ( {
			...entity.localFootprint,
			entityId: entity.entityId,
			width: entity.localFootprint.width + PLAYER_RADIUS * 2,
			depth: entity.localFootprint.depth + PLAYER_RADIUS * 2
		} ) )
	];
	const visited = new Uint8Array( columns * rows );
	const queue = new Int32Array( columns * rows );
	let head = 0;
	let tail = 0;

	for ( const entry of location.entries ) {

		const seed = nearestFreeCell( entry.position, columns, rows, cellWidth, cellDepth, location, blocked );
		if ( seed !== null && ! visited[ seed ] ) {

			visited[ seed ] = 1;
			queue[ tail ++ ] = seed;

		}

	}

	while ( head < tail ) {

		const index = queue[ head ++ ];
		const column = index % columns;
		const row = Math.floor( index / columns );
		for ( const [ dc, dr ] of [ [ 1, 0 ], [ -1, 0 ], [ 0, 1 ], [ 0, -1 ] ] ) {

			const nextColumn = column + dc;
			const nextRow = row + dr;
			if ( nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows ) continue;
			const next = nextRow * columns + nextColumn;
			if ( visited[ next ] ) continue;
			const point = cellCenter( nextColumn, nextRow, cellWidth, cellDepth, location );
			if ( blocked.some( ( rect ) => pointInRect( point, rect ) ) ) continue;
			visited[ next ] = 1;
			queue[ tail ++ ] = next;

		}

	}

	const result = new Map();
	for ( const [ key, visual ] of visuals ) {

		let best = null;
		let bestDistance = Infinity;
		for ( let i = 0; i < tail; i ++ ) {

			const index = queue[ i ];
			const point = cellCenter( index % columns, Math.floor( index / columns ), cellWidth, cellDepth, location );
			const distance = Math.hypot( point.x - visual.local.x, point.z - visual.local.z );
			if ( distance > MAX_INTERACTION_DISTANCE || distance >= bestDistance ) continue;
			const occluders = blocked.filter( ( rect ) => rect.entityId !== visual.entityId && rect.entityId !== visual.relatedEntityId );
			if ( occluders.some( ( rect ) => segmentIntersectsRect( point, visual.local, rect ) ) ) continue;
			best = point;
			bestDistance = distance;

		}

		if ( ! best ) {

			result.set( key, null );
			continue;

		}
		const world = localToWorld( location, best );
		result.set( key, { x: world.x, y: round( location.origin.y ), z: world.z } );

	}
	return result;

}

/** A frame-local point in world space at the frame's ground. */
export function localToWorld( location, point ) {

	const rotated = rotate2( point, location.yawRadians );
	return { x: round( location.origin.x + rotated.x ), y: round( location.origin.y ), z: round( location.origin.z + rotated.z ) };

}

/** A world point in the frame's local plane. */
export function worldToLocal( location, point ) {

	return rotate2( { x: point.x - location.origin.x, z: point.z - location.origin.z }, -location.yawRadians );

}

/** Rotation about +Y by `yaw`: +Z turns toward +X. */
export function rotate2( point, yaw ) {

	const cosine = Math.cos( yaw );
	const sine = Math.sin( yaw );
	return { x: point.x * cosine + point.z * sine, z: -point.x * sine + point.z * cosine };

}

export function round( value ) {

	return Math.round( value * 1e6 ) / 1e6;

}

export function hash32( value ) {

	let hash = 2166136261;
	for ( let index = 0; index < value.length; index ++ ) hash = Math.imul( hash ^ value.charCodeAt( index ), 16777619 );
	return hash >>> 0;

}

function validateMissionAssetProp( entity, fail ) {

	const asset = entity.missionAsset;
	if ( JSON.stringify( entity.dimensions ) !== JSON.stringify( asset.dimensions ) ) {

		fail.geometry( `${entity.entityId} dimensions differ from mission asset ${asset.assetId}` );

	}
	if ( entity.portable !== asset.portable ) fail.geometry( `${entity.entityId} portability differs from mission asset ${asset.assetId}` );
	if ( JSON.stringify( entity.materials ) !== JSON.stringify( asset.materials ) ) {

		fail.geometry( `${entity.entityId} materials differ from mission asset ${asset.assetId}` );

	}

}

function validateSurface( surface, fail ) {

	const axes = [ surface.uAxis, surface.vAxis, surface.normal ];
	if ( axes.some( ( axis ) => Math.abs( length( axis ) - 1 ) > 1e-5 ) ) fail.geometry( `surface ${surface.surfaceId} axes must be unit length` );
	if ( Math.abs( dot( surface.uAxis, surface.vAxis ) ) > 1e-5 || Math.abs( dot( surface.uAxis, surface.normal ) ) > 1e-5 || Math.abs( dot( surface.vAxis, surface.normal ) ) > 1e-5 ) {

		fail.geometry( `surface ${surface.surfaceId} axes must be orthogonal` );

	}
	if ( Math.abs( dot( cross( surface.uAxis, surface.vAxis ), surface.normal ) ) < 1 - 1e-5 ) {

		fail.geometry( `surface ${surface.surfaceId} axes do not form a frame` );

	}
	for ( const blocked of surface.blockedRegions ) {

		if ( Math.abs( blocked.center.x ) + blocked.width / 2 > surface.width / 2 + EPSILON || Math.abs( blocked.center.z ) + blocked.depth / 2 > surface.height / 2 + EPSILON ) {

			fail.geometry( `surface ${surface.surfaceId} blocked region leaves its bounds` );

		}

	}

}

function placeEntity( request, entity, placed, byId, fail ) {

	const location = request.location;
	const candidates = entityCandidates( request, entity, byId );
	const yawStart = entity.placement.preferredYawRadians === undefined
		? hash32( `${request.seed}:${entity.entityId}:yaw` ) % 4
		: positiveModulo( Math.round( entity.placement.preferredYawRadians / ( Math.PI / 2 ) ), 4 );
	const yawOrder = [ 0, 1, 3, 2 ].map( ( offset ) => positiveModulo( yawStart + offset, 4 ) );

	for ( const point of candidates ) {

		for ( const quarter of yawOrder ) {

			const swap = quarter % 2 === 1;
			const width = swap ? entity.dimensions.depth : entity.dimensions.width;
			const depth = swap ? entity.dimensions.width : entity.dimensions.depth;
			const rect = { center: point, width, depth };
			if ( ! rectInside( location, rect, ENTITY_GAP ) ) continue;
			if ( location.blockedZones.some( ( blocked ) => overlaps( rect, blocked, ENTITY_GAP ) ) ) continue;
			if ( placed.some( ( other ) => overlaps( rect, other.localFootprint, ENTITY_GAP ) ) ) continue;
			if ( location.entries.some( ( entry ) => circleTouchesRect( entry.position, entry.clearanceRadius, rect ) ) ) continue;

			return {
				...entity,
				localYaw: quarter * Math.PI / 2,
				localFootprint: rect,
				blocksMovement: entity.role === 'body' || ! entity.portable
			};

		}

	}

	return fail.noFit( `scene ${request.sceneId} cannot fit ${entity.entityId}` );

}

function entityCandidates( request, entity, byId ) {

	const location = request.location;
	const area = location.width * location.depth;
	const step = Math.max( 0.4, Math.sqrt( area / 50000 ) );
	const halfMin = Math.min( entity.dimensions.width, entity.dimensions.depth ) / 2 + ENTITY_GAP;
	const points = [];
	const desired = desiredPoint( location, entity, byId );
	const maxDistance = entity.placement.maxDistanceMeters ?? Infinity;

	for ( let z = -location.depth / 2 + halfMin; z <= location.depth / 2 - halfMin + EPSILON; z += step ) {

		for ( let x = -location.width / 2 + halfMin; x <= location.width / 2 - halfMin + EPSILON; x += step ) {

			const point = { x: round( x ), z: round( z ) };
			const distance = Math.hypot( point.x - desired.x, point.z - desired.z );
			if ( distance > maxDistance + EPSILON ) continue;
			const score = placementScore( location, entity.placement.zone, point, desired );
			points.push( { point, score: score + hashUnit( `${request.seed}:${entity.entityId}:${point.x}:${point.z}` ) * 1e-4 } );

		}

	}

	points.sort( ( left, right ) => left.score - right.score );
	return points.map( ( candidate ) => candidate.point );

}

function desiredPoint( location, entity, byId ) {

	if ( entity.placement.nearEntityId ) return byId.get( entity.placement.nearEntityId ).localFootprint.center;
	if ( entity.placement.point ) return entity.placement.point;
	if ( entity.placement.zone === 'incident' ) {

		const body = [ ...byId.values() ].find( ( item ) => item.role === 'body' );
		if ( body ) return body.localFootprint.center;

	}
	if ( entity.placement.zone === 'entry-side' ) return location.entries[ 0 ].position;
	return { x: 0, z: 0 };

}

function placementScore( location, zone, point, desired ) {

	if ( zone === 'perimeter' ) {

		const edge = Math.min( location.width / 2 - Math.abs( point.x ), location.depth / 2 - Math.abs( point.z ) );
		return edge * edge + squaredDistance( point, desired ) * 0.002;

	}
	return squaredDistance( point, desired );

}

function projectedNearPoint( decal, surface, byEntity, location, seed ) {

	if ( ! decal.nearEntityId ) return { x: 0, z: 0 };
	const entity = byEntity.get( decal.nearEntityId );
	const world = localToWorld( location, entity.localFootprint.center );
	const delta = subtract3( world, surface.origin );
	const center = { x: dot( delta, surface.uAxis ), z: dot( delta, surface.vAxis ) };
	const quarter = hash32( `${seed}:${decal.entityId}:near-side` ) % 4;
	const distance = Math.max( entity.localFootprint.width, entity.localFootprint.depth ) / 2 + Math.min( decal.width, decal.height ) / 4;
	const direction = [ { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 } ][ quarter ];
	return { x: center.x + direction.x * distance, z: center.z + direction.z * distance };

}

function fitDecal( seed, decal, surface, desired, entities, location, fail ) {

	const exact = Boolean( decal.localCenter );
	const step = Math.max( 0.08, Math.min( decal.width, decal.height ) / 4 );
	const candidates = [];
	const covered = surface.kind === 'floor'
		? entities.filter( ( entity ) => entity.entityId !== decal.nearEntityId ).map( ( entity ) => footprintOnSurface( entity, surface, location ) )
		: [];

	for ( let z = -surface.height / 2 + decal.height / 2; z <= surface.height / 2 - decal.height / 2 + EPSILON; z += step ) {

		for ( let x = -surface.width / 2 + decal.width / 2; x <= surface.width / 2 - decal.width / 2 + EPSILON; x += step ) {

			const center = exact ? desired : { x: round( x ), z: round( z ) };
			const rect = { center, width: decal.width, depth: decal.height };
			if ( ! rectInsideSurface( surface, rect ) ) {

				if ( exact ) break;
				continue;

			}
			if ( surface.blockedRegions.some( ( blocked ) => overlaps( rect, blocked, 0.002 ) ) ) {

				if ( exact ) break;
				continue;

			}
			if ( covered.some( ( occupied ) => overlaps( rect, occupied, 0.02 ) ) ) {

				if ( exact ) break;
				continue;

			}
			candidates.push( {
				center,
				score: squaredDistance( center, desired ) + hashUnit( `${seed}:${decal.entityId}:${center.x}:${center.z}` ) * 1e-5
			} );
			if ( exact ) break;

		}
		if ( exact ) break;

	}

	if ( ! candidates.length ) fail.noFit( `decal ${decal.entityId} does not fit surface ${surface.surfaceId}` );
	candidates.sort( ( left, right ) => left.score - right.score );
	return candidates[ 0 ].center;

}

function footprintOnSurface( entity, surface, location ) {

	const rect = entity.localFootprint;
	const points = [
		{ x: rect.center.x - rect.width / 2, z: rect.center.z - rect.depth / 2 },
		{ x: rect.center.x + rect.width / 2, z: rect.center.z - rect.depth / 2 },
		{ x: rect.center.x - rect.width / 2, z: rect.center.z + rect.depth / 2 },
		{ x: rect.center.x + rect.width / 2, z: rect.center.z + rect.depth / 2 }
	].map( ( local ) => {

		const delta = subtract3( localToWorld( location, local ), surface.origin );
		return { x: dot( delta, surface.uAxis ), z: dot( delta, surface.vAxis ) };

	} );
	const minX = Math.min( ...points.map( ( point ) => point.x ) );
	const maxX = Math.max( ...points.map( ( point ) => point.x ) );
	const minZ = Math.min( ...points.map( ( point ) => point.z ) );
	const maxZ = Math.max( ...points.map( ( point ) => point.z ) );
	return { center: { x: ( minX + maxX ) / 2, z: ( minZ + maxZ ) / 2 }, width: maxX - minX, depth: maxZ - minZ };

}

function nearestFreeCell( desired, columns, rows, cellWidth, cellDepth, location, blocked ) {

	const baseColumn = clamp( Math.floor( ( desired.x + location.width / 2 ) / cellWidth ), 0, columns - 1 );
	const baseRow = clamp( Math.floor( ( desired.z + location.depth / 2 ) / cellDepth ), 0, rows - 1 );
	const limit = Math.max( columns, rows );
	for ( let radius = 0; radius < limit; radius ++ ) {

		for ( let row = Math.max( 0, baseRow - radius ); row <= Math.min( rows - 1, baseRow + radius ); row ++ ) {

			for ( let column = Math.max( 0, baseColumn - radius ); column <= Math.min( columns - 1, baseColumn + radius ); column ++ ) {

				if ( Math.max( Math.abs( column - baseColumn ), Math.abs( row - baseRow ) ) !== radius ) continue;
				const point = cellCenter( column, row, cellWidth, cellDepth, location );
				if ( ! blocked.some( ( rect ) => pointInRect( point, rect ) ) ) return row * columns + column;

			}

		}

	}
	return null;

}

function cellCenter( column, row, cellWidth, cellDepth, location ) {

	return {
		x: -location.width / 2 + ( column + 0.5 ) * cellWidth,
		z: -location.depth / 2 + ( row + 0.5 ) * cellDepth
	};

}

function segmentIntersectsRect( start, end, rect ) {

	const minX = rect.center.x - rect.width / 2;
	const maxX = rect.center.x + rect.width / 2;
	const minZ = rect.center.z - rect.depth / 2;
	const maxZ = rect.center.z + rect.depth / 2;
	let lo = 0;
	let hi = 1;
	for ( const [ a, b, min, max ] of [ [ start.x, end.x, minX, maxX ], [ start.z, end.z, minZ, maxZ ] ] ) {

		const delta = b - a;
		if ( Math.abs( delta ) < EPSILON ) {

			if ( a < min || a > max ) return false;
			continue;

		}
		const first = ( min - a ) / delta;
		const second = ( max - a ) / delta;
		lo = Math.max( lo, Math.min( first, second ) );
		hi = Math.min( hi, Math.max( first, second ) );
		if ( lo > hi ) return false;

	}
	return true;

}

function unique( values, label, fail ) {

	const result = new Set();
	for ( const value of values ) {

		if ( result.has( value ) ) fail.geometry( `duplicate ${label} id ${value}` );
		result.add( value );

	}
	return result;

}

function containsPoint( location, point ) {

	return Math.abs( point.x ) <= location.width / 2 + EPSILON && Math.abs( point.z ) <= location.depth / 2 + EPSILON;

}

function rectInside( location, rect, gap = 0 ) {

	return Math.abs( rect.center.x ) + rect.width / 2 + gap <= location.width / 2 + EPSILON &&
		Math.abs( rect.center.z ) + rect.depth / 2 + gap <= location.depth / 2 + EPSILON;

}

function rectInsideSurface( surface, rect ) {

	return Math.abs( rect.center.x ) + rect.width / 2 <= surface.width / 2 + EPSILON &&
		Math.abs( rect.center.z ) + rect.depth / 2 <= surface.height / 2 + EPSILON;

}

function overlaps( left, right, gap = 0 ) {

	return Math.abs( left.center.x - right.center.x ) < ( left.width + right.width ) / 2 + gap - EPSILON &&
		Math.abs( left.center.z - right.center.z ) < ( left.depth + right.depth ) / 2 + gap - EPSILON;

}

function circleTouchesRect( point, radius, rect ) {

	const x = clamp( point.x, rect.center.x - rect.width / 2, rect.center.x + rect.width / 2 );
	const z = clamp( point.z, rect.center.z - rect.depth / 2, rect.center.z + rect.depth / 2 );
	return Math.hypot( point.x - x, point.z - z ) < radius - EPSILON;

}

function pointInRect( point, rect ) {

	return Math.abs( point.x - rect.center.x ) <= rect.width / 2 && Math.abs( point.z - rect.center.z ) <= rect.depth / 2;

}

function squaredDistance( left, right ) {

	return ( left.x - right.x ) ** 2 + ( left.z - right.z ) ** 2;

}

function length( vector ) {

	return Math.hypot( vector.x, vector.y, vector.z );

}

function dot( left, right ) {

	return left.x * right.x + left.y * right.y + left.z * right.z;

}

function cross( left, right ) {

	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x
	};

}

function add3( ...vectors ) {

	return vectors.reduce( ( result, vector ) => ( {
		x: result.x + vector.x,
		y: result.y + vector.y,
		z: result.z + vector.z
	} ), { x: 0, y: 0, z: 0 } );

}

function subtract3( left, right ) {

	return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };

}

function scale3( vector, scale ) {

	return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };

}

function roundedVector( vector ) {

	return { x: round( vector.x ), y: round( vector.y ), z: round( vector.z ) };

}

function normalizeRadians( value ) {

	return round( positiveModulo( value + Math.PI, Math.PI * 2 ) - Math.PI );

}

function positiveModulo( value, modulus ) {

	return ( ( value % modulus ) + modulus ) % modulus;

}

function clamp( value, minimum, maximum ) {

	return Math.max( minimum, Math.min( maximum, value ) );

}

function hashUnit( value ) {

	return hash32( value ) / 4294967296;

}
