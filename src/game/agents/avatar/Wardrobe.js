/*
 * Carried over from the NPC Studio (codex_npcs, src/clothing/core.js): fitted
 * garment shells derived from the body they dress and skinned by its own
 * skeleton. The studio rebuilt a live mesh's wardrobe in place; here a fit is
 * made once for a person's shaped body and handed out as geometry.
 */
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from 'three/webgpu';
import { appendCollar } from './Collars.js';
import { TOPS } from './Tops.js';
import { PANTS, FOOTWEAR } from './Lower.js';
import { SLOTS } from './Recipe.js';

const GROUPS = [ 'head', 'neck', 'torso', 'pelvis', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot' ];
const GROUP_INDEX = Object.fromEntries( GROUPS.map( ( group, index ) => [ group, index ] ) );
const PATTERNS = { top: TOPS, pants: PANTS, footwear: FOOTWEAR };
/** Triangles, or vertices, between yields: a few milliseconds of the loops below. */
const BATCH = 1024;
/**
 * Triangles, or edges, between yields while a shell is cut: each of its
 * vertices is shaped, skinned and weighted as it is first met, a few times
 * the work of a vertex of the loops above, so its stride is a quarter.
 */
const SHELL_BATCH = 256;

/**
 * A person's outfit fitted to their shaped body at rest.
 *
 * Every body triangle a garment covers is hidden, the union of all of them,
 * and the body draws what is left. Each garment is one shell over the
 * triangles it covers, pushed out along the body's normals by its pattern's
 * ease and shaped by it, closed at every cuff, hem and sole by a short wall
 * back to the skin, and at a top's neck by a collar band. Its vertices keep
 * their source vertex's four skin influences, so it moves on the body's own
 * skeleton with no rig of its own. Trousers keep their whole high waistband
 * under an outer jacket, which carries the trousers' shaped seat under its own
 * ease; a tucked top ends at the waistband, and boots are the outer layer
 * below the knee.
 *
 * @param geometry the shaped body: position, normal, skinIndex, skinWeight and its full index
 * @param bones the skeleton's bone names, in skin index order
 * @param outfit `{ top, pants, footwear }` garment ids, or 'none' per slot
 * @returns (a generator of work steps ending in) `{ index, groups, hidden, garments }`:
 *   the triangles the body still draws, its material groups over them, how
 *   many it hides, and `{ id, slot, geometry }` per garment worn
 */
export function* fitOutfit( geometry, bones, outfit ) {

	const positions = geometry.getAttribute( 'position' );
	const normals = geometry.getAttribute( 'normal' );
	const skinIndex = geometry.getAttribute( 'skinIndex' );
	const skinWeight = geometry.getAttribute( 'skinWeight' );
	if ( ! positions || ! normals || ! skinIndex || ! skinWeight || ! geometry.index ) throw new Error( 'a wardrobe needs a skinned, indexed body' );
	const completeIndex = geometry.index.array;
	const selected = SLOTS.flatMap( ( slot ) => {

		const id = outfit[ slot ];
		if ( ! id || id === 'none' ) return [];
		const pattern = PATTERNS[ slot ].find( ( entry ) => entry.id === id );
		if ( ! pattern ) throw new Error( `Unknown ${slot} garment: ${id}` );
		return [ { ...pattern, category: slot } ];

	} ).sort( ( a, b ) => ( b.priority ?? 0 ) - ( a.priority ?? 0 ) );

	geometry.computeBoundingBox();
	const bottom = Math.min( 0, geometry.boundingBox.min.y );
	const height = Math.max( 0.1, geometry.boundingBox.max.y - bottom );
	const weights = classifyWeights( bones, skinIndex, skinWeight, positions.count );
	yield;
	const vertices = yield* vertexContexts( positions, normals, weights, height, bottom );
	const welded = vertices.map( ( context ) => context.weld );
	yield;
	const triangle = makeContext( height );
	const assignments = new Int8Array( completeIndex.length / 3 ).fill( - 1 );
	const byGarment = selected.map( () => [] );
	const topIndex = selected.findIndex( ( { category } ) => category === 'top' );
	const pantsIndex = selected.findIndex( ( { category } ) => category === 'pants' );
	const footwearIndex = selected.findIndex( ( { category } ) => category === 'footwear' );
	const visible = new ( completeIndex.constructor )( completeIndex.length );
	let visibleCount = 0;
	for ( let offset = 0; offset < completeIndex.length; offset += 3 ) {

		if ( offset % ( BATCH * 3 ) === 0 ) yield;
		const a = completeIndex[ offset ];
		const b = completeIndex[ offset + 1 ];
		const c = completeIndex[ offset + 2 ];
		setTriangleContext( triangle, vertices[ a ], vertices[ b ], vertices[ c ] );
		const covered = selected.map( ( descriptor ) => descriptor.includes( triangle ) );
		// Boots stay the outer layer at the lower leg; a tucked top ends at the
		// trousers' waistband while a jacket keeps its own outer silhouette.
		if ( pantsIndex >= 0 && footwearIndex >= 0 && covered[ footwearIndex ] ) covered[ pantsIndex ] = false;
		if ( topIndex >= 0 && pantsIndex >= 0 && selected[ topIndex ].tucked && covered[ pantsIndex ] ) covered[ topIndex ] = false;
		const firstOwner = covered.findIndex( Boolean );
		assignments[ offset / 3 ] = firstOwner;
		if ( firstOwner < 0 ) {

			visible[ visibleCount ++ ] = a;
			visible[ visibleCount ++ ] = b;
			visible[ visibleCount ++ ] = c;

		} else {

			for ( let owner = 0; owner < covered.length; owner ++ ) if ( covered[ owner ] ) byGarment[ owner ].push( a, b, c );

		}

	}
	const groups = bodyGroups( geometry.groups, assignments );
	yield;
	const seamEdges = yield* sharedGarmentEdges( byGarment, welded );
	// Fitted surfaces are prepared once: an outer jacket inherits the shaped
	// seat of the trousers under it before adding its own ease.
	const fitted = [];
	for ( const [ index, descriptor ] of selected.entries() ) {

		yield;
		fitted.push( { ...descriptor, ...descriptor.prepare?.( vertices, byGarment[ index ] ) } );

	}
	const garments = [];
	for ( let index = 0; index < selected.length; index ++ ) {

		yield;
		if ( ! byGarment[ index ].length ) continue;
		const descriptor = fitted[ index ];
		const underlayer = index === topIndex && ! descriptor.tucked && pantsIndex >= 0 ? fitted[ pantsIndex ] : null;
		const shell = yield* createShell( geometry, descriptor, byGarment[ index ], vertices, welded, seamEdges, underlayer );
		garments.push( { id: descriptor.id, slot: descriptor.category, geometry: shell } );

	}
	// Slot order, whatever order they were fitted in.
	garments.sort( ( a, b ) => SLOTS.indexOf( a.slot ) - SLOTS.indexOf( b.slot ) );
	return { index: visible.slice( 0, visibleCount ), groups, hidden: ( completeIndex.length - visibleCount ) / 3, garments };

}

/** Which of the body's parts each vertex's bones belong to, as shares per group. */
function classifyWeights( bones, skinIndex, skinWeight, count ) {

	const boneGroups = bones.map( ( name ) => {

		if ( /^head$/i.test( name ) ) return GROUP_INDEX.head;
		if ( /^neck/i.test( name ) ) return GROUP_INDEX.neck;
		if ( /^(spine|clavicle)/i.test( name ) ) return GROUP_INDEX.torso;
		if ( /^pelvis/i.test( name ) ) return GROUP_INDEX.pelvis;
		if ( /^upperarm/i.test( name ) ) return GROUP_INDEX.upperarm;
		if ( /^lowerarm/i.test( name ) ) return GROUP_INDEX.lowerarm;
		if ( /^(hand|thumb|index|middle|ring|pinky)/i.test( name ) ) return GROUP_INDEX.hand;
		if ( /^thigh/i.test( name ) ) return GROUP_INDEX.thigh;
		if ( /^calf/i.test( name ) ) return GROUP_INDEX.calf;
		if ( /^(foot|ball)/i.test( name ) ) return GROUP_INDEX.foot;
		return - 1;

	} );
	const result = new Float32Array( count * GROUPS.length );
	for ( let vertex = 0; vertex < count; vertex ++ ) {

		for ( let influence = 0; influence < 4; influence ++ ) {

			const group = boneGroups[ skinIndex.getComponent( vertex, influence ) ];
			if ( group >= 0 ) result[ vertex * GROUPS.length + group ] += skinWeight.getComponent( vertex, influence );

		}

	}
	return result;

}

function makeContext( height ) {

	return {
		x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, height, weld: - 1,
		isFront: false, side: 'l', weights: new Float32Array( GROUPS.length ),
		weight( group ) {

			return this.weights[ GROUP_INDEX[ group ] ] ?? 0;

		}
	};

}

/**
 * Each vertex as the patterns read it: its bind position and normal as shares
 * of body height, its body-part shares, the side it is on, the extent of that
 * side's bare foot and the weld it shares with vertices at the same point.
 */
function* vertexContexts( positions, normals, weights, height, bottom ) {

	const welds = new Map();
	const result = [];
	for ( let vertex = 0; vertex < positions.count; vertex ++ ) {

		if ( vertex % BATCH === 0 ) yield;
		const context = makeContext( height );
		context.x = positions.getX( vertex ) / height;
		context.y = ( positions.getY( vertex ) - bottom ) / height;
		context.z = positions.getZ( vertex ) / height;
		context.nx = normals.getX( vertex );
		context.ny = normals.getY( vertex );
		context.nz = normals.getZ( vertex );
		context.isFront = context.nz > 0.15;
		context.side = context.x >= 0 ? 'l' : 'r';
		context.weights.set( weights.subarray( vertex * GROUPS.length, ( vertex + 1 ) * GROUPS.length ) );
		const key = `${Math.round( context.x * 1e6 )},${Math.round( context.y * 1e6 )},${Math.round( context.z * 1e6 )}`;
		if ( ! welds.has( key ) ) welds.set( key, welds.size );
		context.weld = welds.get( key );
		result.push( context );

	}
	const feet = {
		l: { minX: Infinity, maxX: - Infinity, minZ: Infinity, maxZ: - Infinity },
		r: { minX: Infinity, maxX: - Infinity, minZ: Infinity, maxZ: - Infinity }
	};
	for ( const context of result ) {

		if ( context.y > 0.065 || context.weight( 'foot' ) < 0.45 ) continue;
		const foot = feet[ context.side ];
		foot.minX = Math.min( foot.minX, context.x );
		foot.maxX = Math.max( foot.maxX, context.x );
		foot.minZ = Math.min( foot.minZ, context.z );
		foot.maxZ = Math.max( foot.maxZ, context.z );

	}
	for ( const context of result ) {

		const foot = feet[ context.side ];
		context.footCenterX = Number.isFinite( foot.minX ) ? ( foot.minX + foot.maxX ) / 2 : context.x;
		context.footHalfWidth = Number.isFinite( foot.minX ) ? ( foot.maxX - foot.minX ) / 2 : 0.025;
		context.footHeelZ = Number.isFinite( foot.minZ ) ? foot.minZ : - 0.045;
		context.footToeZ = Number.isFinite( foot.minZ ) ? foot.maxZ : 0.08;

	}
	return result;

}

function setTriangleContext( context, a, b, c ) {

	context.x = ( a.x + b.x + c.x ) / 3;
	context.y = ( a.y + b.y + c.y ) / 3;
	context.z = ( a.z + b.z + c.z ) / 3;
	context.nx = ( a.nx + b.nx + c.nx ) / 3;
	context.ny = ( a.ny + b.ny + c.ny ) / 3;
	context.nz = ( a.nz + b.nz + c.nz ) / 3;
	for ( let group = 0; group < GROUPS.length; group ++ ) context.weights[ group ] = ( a.weights[ group ] + b.weights[ group ] + c.weights[ group ] ) / 3;
	context.isFront = context.nz > 0.15;
	context.side = context.x >= 0 ? 'l' : 'r';
	for ( const key of [ 'footCenterX', 'footHalfWidth', 'footHeelZ', 'footToeZ' ] ) context[ key ] = ( a[ key ] + b[ key ] + c[ key ] ) / 3;

}

/** The body's material groups over the triangles it still draws. */
function bodyGroups( groups, assignments ) {

	const result = [];
	let nextStart = 0;
	for ( const group of groups ) {

		let count = 0;
		const end = Math.min( assignments.length, ( group.start + group.count ) / 3 );
		for ( let index = group.start / 3; index < end; index ++ ) if ( assignments[ index ] < 0 ) count += 3;
		if ( count ) result.push( { start: nextStart, count, materialIndex: group.materialIndex } );
		nextStart += count;

	}
	return result;

}

function* createShell( body, descriptor, faces, contexts, welded, seamEdges, underlayer ) {

	const sourcePosition = body.attributes.position;
	const sourceIndex = body.attributes.skinIndex;
	const sourceWeight = body.attributes.skinWeight;
	const positions = [];
	const normals = [];
	const joints = [];
	const weights = [];
	const garmentCoordinates = [];
	const garmentNormals = [];
	const garmentWeights = [];
	const garmentRims = [];
	const sources = [];
	const indices = [];
	const vertexMap = new Map();
	const edgeMap = new Map();
	const displaced = new Map();
	const shadedNormals = new Map();
	const boundaryPlanes = new Map();
	const delta = [ 0, 0, 0 ];
	const underneath = [ 0, 0, 0 ];
	const weldCount = welded.reduce( ( max, weld ) => Math.max( max, weld ), 0 ) + 1;

	function overlapAmount( context ) {

		if ( ! underlayer ) return 0;
		const waist = underlayer.waistHeight ?? 0.625;
		const amount = Math.max( 0, Math.min( 1, ( waist + 0.025 - context.y ) / 0.035 ) );
		return amount * amount * ( 3 - 2 * amount );

	}

	function outerPosition( index ) {

		if ( displaced.has( index ) ) return displaced.get( index );
		const context = contexts[ index ];
		const offset = Math.max( 0.0008, descriptor.offset?.( context ) ?? 0.004 ) * context.height;
		delta.fill( 0 );
		descriptor.shape?.( context, delta );
		const overlap = overlapAmount( context );
		if ( overlap ) {

			underneath.fill( 0 );
			underlayer.shape?.( context, underneath );
			const padding = Math.max( 0.0008, underlayer.offset?.( context ) ?? 0.004 );
			delta[ 0 ] += ( underneath[ 0 ] + context.nx * padding ) * overlap;
			delta[ 1 ] += ( underneath[ 1 ] + context.ny * padding ) * overlap;
			delta[ 2 ] += ( underneath[ 2 ] + context.nz * padding ) * overlap;

		}
		const point = [
			sourcePosition.getX( index ) + context.nx * offset + delta[ 0 ] * context.height,
			sourcePosition.getY( index ) + context.ny * offset + delta[ 1 ] * context.height,
			sourcePosition.getZ( index ) + context.nz * offset + delta[ 2 ] * context.height
		];
		const plane = boundaryPlanes.get( welded[ index ] );
		if ( plane ) point[ plane.axis ] = sourcePosition.getComponent( index, plane.axis ) + ( plane.value - context[ plane.axis === 0 ? 'x' : 'y' ] ) * context.height;
		displaced.set( index, point );
		return point;

	}

	function innerPosition( index ) {

		const point = [ sourcePosition.getX( index ), sourcePosition.getY( index ), sourcePosition.getZ( index ) ];
		const plane = boundaryPlanes.get( welded[ index ] );
		if ( plane?.shared ) point[ plane.axis ] += ( plane.value - contexts[ index ][ plane.axis === 0 ? 'x' : 'y' ] ) * contexts[ index ].height;
		return point;

	}

	function addVertex( index, inner = false, wallNormal = null ) {

		const key = `${index}:${inner ? 1 : 0}:${wallNormal ? wallNormal.join( ',' ) : ''}`;
		if ( vertexMap.has( key ) ) return vertexMap.get( key );
		const next = positions.length / 3;
		const context = contexts[ index ];
		positions.push( ...( inner ? innerPosition( index ) : outerPosition( index ) ) );
		if ( ! shadedNormals.has( index ) ) {

			const normal = [ context.nx, context.ny, context.nz ];
			descriptor.normal?.( context, normal );
			const overlap = overlapAmount( context );
			if ( overlap && underlayer.normal ) {

				const lowerNormal = [ context.nx, context.ny, context.nz ];
				underlayer.normal( context, lowerNormal );
				for ( let axis = 0; axis < 3; axis ++ ) normal[ axis ] += ( lowerNormal[ axis ] - normal[ axis ] ) * overlap;

			}
			const length = Math.hypot( ...normal ) || 1;
			shadedNormals.set( index, normal.map( ( component ) => component / length ) );

		}
		normals.push( ...( wallNormal ?? shadedNormals.get( index ) ) );
		for ( let influence = 0; influence < 4; influence ++ ) {

			joints.push( sourceIndex.getComponent( index, influence ) );
			weights.push( sourceWeight.getComponent( index, influence ) );

		}
		garmentCoordinates.push( context.x, context.y, context.z );
		garmentNormals.push( ...shadedNormals.get( index ) );
		garmentWeights.push( context.weight( 'torso' ) + context.weight( 'pelvis' ), context.weight( 'upperarm' ) + context.weight( 'lowerarm' ),
			context.weight( 'neck' ), context.weight( 'foot' ) );
		garmentRims.push( wallNormal ? 1 : 0 );
		sources.push( index );
		vertexMap.set( key, next );
		return next;

	}

	function edge( a, b, inside ) {

		const key = Math.min( welded[ a ], welded[ b ] ) * weldCount + Math.max( welded[ a ], welded[ b ] );
		const existing = edgeMap.get( key );
		if ( existing ) existing.count ++;
		else edgeMap.set( key, { a, b, inside, key, count: 1 } );

	}

	for ( let index = 0; index < faces.length; index += 3 ) {

		if ( index && index % ( BATCH * 3 ) === 0 ) yield;
		const a = faces[ index ], b = faces[ index + 1 ], c = faces[ index + 2 ];
		edge( a, b, c );
		edge( b, c, a );
		edge( c, a, b );

	}
	yield;
	alignBoundaryRings( edgeMap, welded, contexts, seamEdges, boundaryPlanes, descriptor );
	yield;
	for ( let index = 0; index < faces.length; index += 3 ) {

		if ( index % ( SHELL_BATCH * 3 ) === 0 ) yield;
		indices.push( addVertex( faces[ index ] ), addVertex( faces[ index + 1 ] ), addVertex( faces[ index + 2 ] ) );

	}
	yield;
	const collarStart = positions.length / 3;
	const collarEdges = appendCollar( {
		descriptor, edgeMap, welded, contexts, sourcePosition, sourceIndex, sourceWeight, outerPosition,
		positions, normals, joints, weights, garmentCoordinates, garmentNormals, garmentWeights, garmentRims, indices
	} );
	// The collar's vertices keep their binding source's skin: its ring vertex's
	// or the neck's (Collars.js).
	for ( let vertex = collarStart; vertex < positions.length / 3; vertex ++ ) sources.push( - 1 );
	yield;
	// A short inward wall closes each cuff, collar, hem and sole against the
	// body. Welding is only for finding edges, so authored UV seams are no hems.
	let walled = 0;
	for ( const { a, b, key, count } of edgeMap.values() ) {

		if ( count !== 1 || collarEdges.has( key ) ) continue;
		if ( ++ walled % SHELL_BATCH === 0 ) yield;
		const pa = outerPosition( a );
		const pb = outerPosition( b );
		const inner = innerPosition( a );
		const edgeX = pb[ 0 ] - pa[ 0 ], edgeY = pb[ 1 ] - pa[ 1 ], edgeZ = pb[ 2 ] - pa[ 2 ];
		const inX = inner[ 0 ] - pa[ 0 ], inY = inner[ 1 ] - pa[ 1 ], inZ = inner[ 2 ] - pa[ 2 ];
		const wall = [ edgeY * inZ - edgeZ * inY, edgeZ * inX - edgeX * inZ, edgeX * inY - edgeY * inX ];
		const length = Math.hypot( ...wall ) || 1;
		for ( let axis = 0; axis < 3; axis ++ ) wall[ axis ] /= length;
		const oa = addVertex( a, false, wall );
		const ob = addVertex( b, false, wall );
		const ia = addVertex( a, true, wall );
		const ib = addVertex( b, true, wall );
		indices.push( oa, ia, ob, ob, ia, ib );

	}
	yield;

	const geometry = new BufferGeometry();
	const height = contexts[ 0 ].height;
	const bottom = sourcePosition.getY( 0 ) - contexts[ 0 ].y * height;
	const surface = new Float32Array( positions.length );
	for ( let i = 0; i < positions.length; i ++ ) surface[ i ] = ( positions[ i ] - ( i % 3 === 1 ? bottom : 0 ) ) / height;
	// The rim share rides in the body-part shares' last lane, which the panels
	// do not read: seven vertex buffers, one under WebGPU's eight.
	const shares = new Float32Array( garmentWeights );
	for ( let vertex = 0; vertex < garmentRims.length; vertex ++ ) shares[ vertex * 4 + 3 ] = garmentRims[ vertex ];
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new Float32BufferAttribute( normals, 3 ) );
	// Panels are painted in the finished shell's own rest surface, so flattened
	// hems and shaped cuffs keep straight trims.
	geometry.setAttribute( 'garmentSurface', new Float32BufferAttribute( surface, 3 ) );
	geometry.setAttribute( 'garmentNormal', new Float32BufferAttribute( garmentNormals, 3 ) );
	geometry.setAttribute( 'garmentShares', new Float32BufferAttribute( shares, 4 ) );
	geometry.setAttribute( 'skinIndex', new Uint16BufferAttribute( joints, 4 ) );
	geometry.setAttribute( 'skinWeight', new Float32BufferAttribute( weights, 4 ) );
	geometry.setIndex( positions.length / 3 > 65535 ? new Uint32BufferAttribute( indices, 1 ) : new Uint16BufferAttribute( indices, 1 ) );
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	// Which body vertex each garment vertex is fitted over (-1 on the collar
	// band), and that vertex's rest point as a share of height: provenance for
	// checks, never drawn.
	geometry.userData.sources = Int32Array.from( sources );
	geometry.userData.fitted = Float32Array.from( garmentCoordinates );
	return geometry;

}

/** Edges two garments share: a seam between them, which neither closes with a wall. */
function* sharedGarmentEdges( garments, welded ) {

	const owners = new Map();
	const shared = new Set();
	const size = welded.reduce( ( max, weld ) => Math.max( max, weld ), 0 ) + 1;
	for ( let owner = 0; owner < garments.length; owner ++ ) {

		const faces = garments[ owner ];
		for ( let index = 0; index < faces.length; index += 3 ) {

			if ( index % ( BATCH * 3 ) === 0 ) yield;
			for ( let side = 0; side < 3; side ++ ) {

				const a = welded[ faces[ index + side ] ];
				const b = welded[ faces[ index + ( side + 1 ) % 3 ] ];
				const key = Math.min( a, b ) * size + Math.max( a, b );
				if ( ! owners.has( key ) ) owners.set( key, owner );
				else if ( owners.get( key ) !== owner ) shared.add( key );

			}

		}

	}
	return shared;

}

/** Straight cuff and hem rings on the same source joints, keeping the hidden-body mask. */
function alignBoundaryRings( edges, welded, contexts, seamEdges, planes, descriptor ) {

	const adjacent = new Map();
	for ( const edge of edges.values() ) {

		if ( edge.count !== 1 ) continue;
		for ( const index of [ edge.a, edge.b ] ) {

			const key = welded[ index ];
			if ( ! adjacent.has( key ) ) adjacent.set( key, [] );
			adjacent.get( key ).push( edge );

		}

	}
	const visited = new Set();
	for ( const start of adjacent.keys() ) {

		if ( visited.has( start ) ) continue;
		const pending = [ start ];
		const vertices = new Map();
		const ringEdges = new Set();
		while ( pending.length ) {

			const key = pending.pop();
			if ( visited.has( key ) ) continue;
			visited.add( key );
			for ( const edge of adjacent.get( key ) ?? [] ) {

				ringEdges.add( edge );
				for ( const index of [ edge.a, edge.b ] ) {

					const next = welded[ index ];
					vertices.set( next, contexts[ index ] );
					if ( ! visited.has( next ) ) pending.push( next );

				}

			}

		}
		// Only complete contour loops flatten; open or branched authored seams
		// keep their shape rather than pull unrelated surfaces flat.
		if ( vertices.size < 4 || [ ...vertices.keys() ].some( ( key ) => adjacent.get( key )?.length !== 2 ) ) continue;
		const values = [ ...vertices.values() ];
		const arms = values.reduce( ( sum, context ) => sum + context.weight( 'upperarm' ) + context.weight( 'lowerarm' ) + context.weight( 'hand' ), 0 ) / values.length;
		const meanY = values.reduce( ( sum, context ) => sum + context.y, 0 ) / values.length;
		const sideLoop = values.every( ( { x } ) => x > 0.035 ) || values.every( ( { x } ) => x < - 0.035 );
		const armhole = descriptor.armholeAxis === 'x' && sideLoop && meanY > 0.7 && arms > 0.08;
		const axis = arms > 0.55 || armhole ? 0 : 1;
		const coordinate = axis === 0 ? 'x' : 'y';
		let value = values.reduce( ( sum, context ) => sum + context[ coordinate ], 0 ) / values.length;
		const span = Math.max( ...values.map( ( context ) => context[ coordinate ] ) ) - Math.min( ...values.map( ( context ) => context[ coordinate ] ) );
		if ( span > 0.09 ) continue;
		const shared = [ ...ringEdges ].every( ( edge ) => seamEdges.has( edge.key ) );
		// An exposed edge extends past every uneven source cut. Its adjacent
		// garment triangles say which way is inside, for shorts hems, waists,
		// necks and either sleeve alike, with no garment ids.
		if ( ! shared ) {

			const interior = [ ...ringEdges ].reduce( ( sum, edge ) => sum + contexts[ edge.inside ][ coordinate ], 0 ) / ringEdges.size;
			value = interior > value
				? Math.min( ...values.map( ( context ) => context[ coordinate ] ) )
				: Math.max( ...values.map( ( context ) => context[ coordinate ] ) );

		}
		for ( const key of vertices.keys() ) planes.set( key, { axis, value, shared } );

	}

}
