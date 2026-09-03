import { InvestigationBoundary } from './InvestigationBoundary.js';
import { InvestigationError } from './InvestigationError.js';

const ENTITY_GAP = 0.12;
const PLAYER_RADIUS = 0.35;
const MAX_INTERACTION_DISTANCE = 2.25;
const EPSILON = 1e-6;

/**
 * Fits only authored incident elements into one measured interior or street
 * frame. No clue, blood mark or story fact is synthesized by this layer.
 */
export class SceneAssembler {

	constructor( boundary = new InvestigationBoundary() ) {

		this.boundary = boundary;

	}

	assemble( request ) {

		this.boundary.input( 'scene-request', request );
		validateScene( request );

		const internals = placeEntities( request );
		const decals = placeDecals( request, internals );
		const visuals = evidenceVisuals( request, internals, decals );
		const approach = reachableApproaches( request.location, internals, visuals );
		const entities = internals.map( ( internal ) => publicEntity( request.location, internal ) );
		const evidence = structuredClone( request.evidence );
		const initialState = {
			contractVersion: '1.0',
			sceneId: request.sceneId,
			revision: 0,
			evidence: evidence.map( ( item ) => ( { evidenceId: item.evidenceId, status: 'undiscovered' } ) ),
			emittedTransitionIds: []
		};
		const targets = evidence.map( ( item ) => {

			const visual = visuals.get( item.evidenceId );
			return {
				targetKey: targetKey( request.sceneId, item.evidenceId ),
				evidenceId: item.evidenceId,
				entityId: visual.entityId,
				label: item.label,
				description: item.description,
				portable: item.portable,
				approachPoint: approach.get( item.evidenceId ),
				maxDistanceMeters: MAX_INTERACTION_DISTANCE,
				actions: [ 'inspect', ...( item.portable ? [ 'take' ] : [] ) ],
				available: item.prerequisiteEvidenceIds.length === 0,
				...( item.prerequisiteEvidenceIds.length ? { unavailableReason: 'prerequisite' } : {} )
			};

		} );

		return this.boundary.output( 'scene-assembly', {
			contractVersion: '1.0',
			sceneId: request.sceneId,
			questId: request.questId,
			seed: request.seed,
			incident: structuredClone( request.incident ),
			location: { kind: request.location.kind, placeId: request.location.placeId },
			entities,
			decals,
			evidence,
			targets,
			initialState
		} );

	}

}

function validateScene( request ) {

	const entityIds = unique( [ ...request.bodies, ...request.props ].map( ( item ) => item.entityId ), 'entity' );
	const decalIds = unique( request.decals.map( ( item ) => item.entityId ), 'decal entity' );
	for ( const id of decalIds ) if ( entityIds.has( id ) ) geometryError( `duplicate visual entity id ${id}` );

	const evidenceIds = unique( request.evidence.map( ( item ) => item.evidenceId ), 'evidence' );
	const surfaceIds = unique( request.location.receivingSurfaces.map( ( item ) => item.surfaceId ), 'surface' );
	unique( request.location.entries.map( ( item ) => item.entryId ), 'entry' );
	unique( request.location.blockedZones.map( ( item ) => item.blockerId ), 'blocker' );

	for ( const entry of request.location.entries ) {

		if ( ! containsPoint( request.location, entry.position ) ) geometryError( `entry ${entry.entryId} is outside the scene frame` );

	}

	for ( const entity of [ ...request.bodies, ...request.props ] ) {

		unique( entity.materials.map( ( material ) => material.slot ), `material slot on ${entity.entityId}` );
		const near = entity.placement.nearEntityId;
		if ( near && ! entityIds.has( near ) ) geometryError( `${entity.entityId} references unknown near entity ${near}` );
		if ( near === entity.entityId ) geometryError( `${entity.entityId} cannot be near itself` );

	}

	for ( const surface of request.location.receivingSurfaces ) validateSurface( surface );

	for ( const decal of request.decals ) {

		if ( ! surfaceIds.has( decal.surfaceId ) ) geometryError( `${decal.entityId} references unknown surface ${decal.surfaceId}` );
		if ( decal.nearEntityId && ! entityIds.has( decal.nearEntityId ) ) {

			geometryError( `${decal.entityId} references unknown near entity ${decal.nearEntityId}` );

		}
		if ( decal.nearEntityId && decal.localCenter ) geometryError( `${decal.entityId} has two decal anchors` );

	}

	const visualReferences = new Map();
	for ( const visual of [ ...request.bodies, ...request.props, ...request.decals ] ) {

		if ( ! visual.evidenceId ) continue;
		if ( ! evidenceIds.has( visual.evidenceId ) ) geometryError( `${visual.entityId} references unknown evidence ${visual.evidenceId}` );
		if ( visualReferences.has( visual.evidenceId ) ) geometryError( `evidence ${visual.evidenceId} has more than one visual` );
		visualReferences.set( visual.evidenceId, visual );

	}

	const transitionIds = [];
	for ( const evidence of request.evidence ) {

		if ( ! visualReferences.has( evidence.evidenceId ) ) geometryError( `evidence ${evidence.evidenceId} has no visual` );
		for ( const prerequisite of evidence.prerequisiteEvidenceIds ) {

			if ( ! evidenceIds.has( prerequisite ) ) geometryError( `evidence ${evidence.evidenceId} has unknown prerequisite ${prerequisite}` );
			if ( prerequisite === evidence.evidenceId ) geometryError( `evidence ${evidence.evidenceId} depends on itself` );

		}
		for ( const consequence of evidence.consequences ) transitionIds.push( consequence.transitionId );

		const visual = visualReferences.get( evidence.evidenceId );
		if ( evidence.portable && ( ! request.props.includes( visual ) || ! visual.portable ) ) {

			geometryError( `portable evidence ${evidence.evidenceId} must reference a portable prop` );

		}
		if ( ! evidence.portable && request.props.includes( visual ) && visual.portable ) {

			geometryError( `non-portable evidence ${evidence.evidenceId} references a portable prop` );

		}

	}
	unique( transitionIds, 'transition' );
	assertAcyclicEvidence( request.evidence );

}

function validateSurface( surface ) {

	const axes = [ surface.uAxis, surface.vAxis, surface.normal ];
	if ( axes.some( ( axis ) => Math.abs( length( axis ) - 1 ) > 1e-5 ) ) geometryError( `surface ${surface.surfaceId} axes must be unit length` );
	if ( Math.abs( dot( surface.uAxis, surface.vAxis ) ) > 1e-5 || Math.abs( dot( surface.uAxis, surface.normal ) ) > 1e-5 || Math.abs( dot( surface.vAxis, surface.normal ) ) > 1e-5 ) {

		geometryError( `surface ${surface.surfaceId} axes must be orthogonal` );

	}
	if ( Math.abs( dot( cross( surface.uAxis, surface.vAxis ), surface.normal ) ) < 1 - 1e-5 ) {

		geometryError( `surface ${surface.surfaceId} axes do not form a frame` );

	}
	for ( const blocked of surface.blockedRegions ) {

		if ( Math.abs( blocked.center.x ) + blocked.width / 2 > surface.width / 2 + EPSILON || Math.abs( blocked.center.z ) + blocked.depth / 2 > surface.height / 2 + EPSILON ) {

			geometryError( `surface ${surface.surfaceId} blocked region leaves its bounds` );

		}

	}

}

function assertAcyclicEvidence( evidence ) {

	const byId = new Map( evidence.map( ( item ) => [ item.evidenceId, item ] ) );
	const visiting = new Set();
	const visited = new Set();

	const visit = ( id ) => {

		if ( visiting.has( id ) ) geometryError( `evidence prerequisites contain a cycle at ${id}` );
		if ( visited.has( id ) ) return;
		visiting.add( id );
		for ( const prerequisite of byId.get( id ).prerequisiteEvidenceIds ) visit( prerequisite );
		visiting.delete( id );
		visited.add( id );

	};

	for ( const id of byId.keys() ) visit( id );

}

function placeEntities( request ) {

	const source = [
		...request.bodies.map( ( entity, order ) => ( { ...entity, role: 'body', order } ) ),
		...request.props.map( ( entity, order ) => ( { ...entity, role: 'prop', order: request.bodies.length + order } ) )
	];
	const pending = [ ...source ];
	const placed = [];
	const byId = new Map();

	while ( pending.length ) {

		const ready = pending.filter( ( entity ) => ! entity.placement.nearEntityId || byId.has( entity.placement.nearEntityId ) );
		if ( ! ready.length ) geometryError( 'entity placement references contain a cycle' );
		ready.sort( ( left, right ) => left.order - right.order );

		for ( const entity of ready ) {

			const result = placeEntity( request, entity, placed, byId );
			placed.push( result );
			byId.set( result.entityId, result );
			pending.splice( pending.indexOf( entity ), 1 );

		}

	}

	return placed;

}

function placeEntity( request, entity, placed, byId ) {

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

	throw new InvestigationError( 'E_INVESTIGATION_NO_FIT', `scene ${request.sceneId} cannot fit ${entity.entityId}` );

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

function publicEntity( location, entity ) {

	const contact = localToWorld( location, entity.localFootprint.center );
	const yaw = normalizeRadians( location.yawRadians + entity.localYaw );
	const ground = rotate2( { x: entity.asset.groundContact.x, z: entity.asset.groundContact.z }, yaw );
	const origin = {
		x: round( contact.x - ground.x ),
		y: round( location.origin.y - entity.asset.groundContact.y ),
		z: round( contact.z - ground.z )
	};
	return {
		entityId: entity.entityId,
		role: entity.role,
		asset: structuredClone( entity.asset ),
		dimensions: structuredClone( entity.dimensions ),
		...( entity.poseId ? { poseId: entity.poseId } : {} ),
		transform: { position: origin, yawRadians: yaw },
		footprint: {
			center: { x: contact.x, z: contact.z },
			width: entity.dimensions.width,
			depth: entity.dimensions.depth,
			yawRadians: yaw
		},
		materials: structuredClone( entity.materials ),
		blocksMovement: entity.blocksMovement,
		...( entity.role === 'prop' ? { portable: entity.portable } : {} ),
		...( entity.evidenceId ? { evidenceId: entity.evidenceId } : {} )
	};

}

function placeDecals( request, entities ) {

	const byEntity = new Map( entities.map( ( entity ) => [ entity.entityId, entity ] ) );
	const bySurface = new Map( request.location.receivingSurfaces.map( ( surface ) => [ surface.surfaceId, surface ] ) );

	return request.decals.map( ( decal ) => {

		const surface = bySurface.get( decal.surfaceId );
		const desired = decal.localCenter ?? projectedNearPoint( decal, surface, byEntity, request.location, request.seed );
		const center = fitDecal( request.seed, decal, surface, desired, entities, request.location );
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

function fitDecal( seed, decal, surface, desired, entities, location ) {

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

	if ( ! candidates.length ) throw new InvestigationError( 'E_INVESTIGATION_NO_FIT', `decal ${decal.entityId} does not fit surface ${surface.surfaceId}` );
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

function evidenceVisuals( request, entities, decals ) {

	const visuals = new Map();
	for ( const entity of entities ) if ( entity.evidenceId ) {

		const world = localToWorld( request.location, entity.localFootprint.center );
		visuals.set( entity.evidenceId, { entityId: entity.entityId, world, local: entity.localFootprint.center } );

	}
	for ( const decal of decals ) if ( decal.evidenceId ) {

		const authored = request.decals.find( ( item ) => item.entityId === decal.entityId );
		visuals.set( decal.evidenceId, {
			entityId: decal.entityId,
			relatedEntityId: authored.nearEntityId,
			world: decal.transform.position,
			local: worldToLocal( request.location, decal.transform.position )
		} );

	}
	return visuals;

}

function reachableApproaches( location, entities, visuals ) {

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
	for ( const [ evidenceId, visual ] of visuals ) {

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

		if ( ! best ) throw new InvestigationError( 'E_INVESTIGATION_NO_FIT', `evidence ${evidenceId} has no reachable approach` );
		const world = localToWorld( location, best );
		result.set( evidenceId, { x: world.x, y: round( location.origin.y ), z: world.z } );

	}
	return result;

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

function targetKey( sceneId, evidenceId ) {

	return `investigation:${encodeURIComponent( sceneId )}:${encodeURIComponent( evidenceId )}`;

}

function unique( values, label ) {

	const result = new Set();
	for ( const value of values ) {

		if ( result.has( value ) ) geometryError( `duplicate ${label} id ${value}` );
		result.add( value );

	}
	return result;

}

function geometryError( message ) {

	throw new InvestigationError( 'E_INVESTIGATION_GEOMETRY', message );

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

function localToWorld( location, point ) {

	const rotated = rotate2( point, location.yawRadians );
	return { x: round( location.origin.x + rotated.x ), y: round( location.origin.y ), z: round( location.origin.z + rotated.z ) };

}

function worldToLocal( location, point ) {

	return rotate2( { x: point.x - location.origin.x, z: point.z - location.origin.z }, -location.yawRadians );

}

function rotate2( point, yaw ) {

	const cosine = Math.cos( yaw );
	const sine = Math.sin( yaw );
	return { x: point.x * cosine + point.z * sine, z: -point.x * sine + point.z * cosine };

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

function round( value ) {

	return Math.round( value * 1e6 ) / 1e6;

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

function hash32( value ) {

	let hash = 2166136261;
	for ( let index = 0; index < value.length; index ++ ) hash = Math.imul( hash ^ value.charCodeAt( index ), 16777619 );
	return hash >>> 0;

}

function hashUnit( value ) {

	return hash32( value ) / 4294967296;

}
