/*
 * Carried over from the NPC Studio (codex_npcs, src/persona.js and
 * src/face.js): the rest-space shape controls of a Source body, its face and
 * the eyes and brows that move with it. The studio's tint maps are not: the
 * engine tints skin, hair and eyes in their materials (Tints.js).
 */
import { Matrix4, Vector3 } from 'three/webgpu';
import { BODY_SHAPE_KEYS, DEFAULT_SHAPE, FACE_SHAPE_KEYS, SHAPE_LIMITS } from './Recipe.js';
import { vertexNormals } from './Normals.js';
import { whole } from './Steps.js';

const SURFACE_KEYS = Object.keys( DEFAULT_SHAPE ).filter( ( key ) => key !== 'height' );
/** Vertices between yields while the bases are measured. */
const BATCH = 2048;

/**
 * What a body's shape controls do to its surface, measured once for the run
 * from its rest pose: one displacement per control and vertex for the body,
 * and the face's for the eyes and brows, so a person's shape is a weighted
 * sum and a normal pass, and no bone, skin weight or UV changes.
 */
export class BodyShapes {

	/**
	 * @param root the source body's scene, its body surface already refined
	 * @returns (a generator of work steps ending in) the body's BodyShapes
	 */
	static* measure( root ) {

		const body = bodyOf( root );
		const geometry = body.geometry;
		const positions = Float32Array.from( geometry.getAttribute( 'position' ).array );
		const normals = geometry.getAttribute( 'normal' ).array.slice();
		yield;
		const seams = smoothSeams( geometry, positions, normals );
		yield;
		const face = yield* faceBasis( body, positions, root );
		const basis = { ...( yield* shapeBasis( body, positions ) ), ...face.basis };
		return new BodyShapes( { body, positions, normals, seams, basis, auxiliaries: face.auxiliaries } );

	}

	constructor( { body, positions, normals, seams, basis, auxiliaries } ) {

		this.body = body;
		this.positions = positions;
		this.normals = normals;
		this.seams = seams;
		this.basis = basis;
		this.auxiliaries = auxiliaries;
		// The full body's triangles: the normals are those of the whole surface,
		// whatever a wardrobe later hides.
		this.index = body.geometry.index.array.slice();

	}

	/**
	 * A person's body at rest: the positions and normals of the body, and of
	 * each eye and brow mesh by name, their shape controls applied. Values are
	 * clamped to the authored limits; a neutral shape gives the source arrays
	 * back as copies.
	 */
	shaped( shape ) {

		return whole( this.shaping( shape ) );

	}

	/** `shaped` as steps: the body's controls, its normals, the face's eyes and brows. */
	* shaping( shape ) {

		const amounts = Object.fromEntries( Object.keys( DEFAULT_SHAPE ).map( ( key ) => {

			const [ min, max ] = SHAPE_LIMITS[ key ];
			return [ key, Math.max( min, Math.min( max, Number.isFinite( shape?.[ key ] ) ? shape[ key ] : 1 ) ) - 1 ];

		} ) );
		const position = this.positions.slice();
		for ( const key of SURFACE_KEYS ) {

			const amount = amounts[ key ];
			if ( ! amount ) continue;
			const delta = this.basis[ key ];
			for ( let i = 0; i < position.length; i ++ ) position[ i ] += delta[ i ] * amount;
			yield;

		}
		yield;
		const normal = SURFACE_KEYS.some( ( key ) => amounts[ key ] ) ? yield* this.#normals( position ) : this.normals.slice();
		yield;
		const auxiliaries = new Map();
		for ( const auxiliary of this.auxiliaries ) {

			auxiliaries.set( auxiliary.name, yield* auxiliaryShape( auxiliary, amounts ) );
			yield;

		}
		return { position, normal, auxiliaries };

	}

	* #normals( position ) {

		const normal = yield* vertexNormals( position, this.index );
		// Authored face and hand smoothing stays where nothing moved, and a
		// vertex split at a UV seam keeps one normal with its twin.
		for ( let i = 0; i < position.length; i += 3 ) {

			if ( position[ i ] !== this.positions[ i ] || position[ i + 1 ] !== this.positions[ i + 1 ] || position[ i + 2 ] !== this.positions[ i + 2 ] ) continue;
			normal[ i ] = this.normals[ i ];
			normal[ i + 1 ] = this.normals[ i + 1 ];
			normal[ i + 2 ] = this.normals[ i + 2 ];

		}
		smoothAcrossSeams( normal, this.seams, position, this.positions );
		return normal;

	}

}

/** The body: the largest skinned mesh that is not an eye, a brow or hair. */
export function bodyOf( root ) {

	let body = null;
	root.traverse( ( mesh ) => {

		if ( ! mesh.isSkinnedMesh || /eye|hair|brow/i.test( mesh.name ) ) return;
		if ( ! body || mesh.geometry.getAttribute( 'position' ).count > body.geometry.getAttribute( 'position' ).count ) body = mesh;

	} );
	if ( ! body ) throw new Error( 'a character recipe needs a skinned body mesh' );
	return body;

}

function* auxiliaryShape( auxiliary, amounts ) {

	const keys = auxiliary.keys.filter( ( key ) => amounts[ key ] );
	const position = auxiliary.original.slice();
	for ( const key of keys ) {

		const delta = auxiliary.basis[ key ];
		for ( let i = 0; i < position.length; i ++ ) position[ i ] += delta[ i ] * amounts[ key ];

	}
	if ( ! keys.length || ! auxiliary.normals ) return { position, normal: auxiliary.normals?.slice() ?? null };
	const normal = yield* vertexNormals( position, auxiliary.index ?? null );
	// Imported spheres and brows split vertices at UV seams: only authored
	// smooth seams are averaged, the pack's deliberate edges are kept.
	for ( let i = 0; i < position.length; i += 3 ) {

		if ( position[ i ] !== auxiliary.original[ i ] || position[ i + 1 ] !== auxiliary.original[ i + 1 ] || position[ i + 2 ] !== auxiliary.original[ i + 2 ] ) continue;
		normal[ i ] = auxiliary.normals[ i ];
		normal[ i + 1 ] = auxiliary.normals[ i + 1 ];
		normal[ i + 2 ] = auxiliary.normals[ i + 2 ];

	}
	const sum = new Vector3();
	for ( const indices of auxiliary.seams ) {

		if ( indices.every( ( i ) => position[ i ] === auxiliary.original[ i ] && position[ i + 1 ] === auxiliary.original[ i + 1 ] && position[ i + 2 ] === auxiliary.original[ i + 2 ] ) ) continue;
		sum.set( 0, 0, 0 );
		for ( const i of indices ) {

			sum.x += normal[ i ];
			sum.y += normal[ i + 1 ];
			sum.z += normal[ i + 2 ];

		}
		sum.normalize();
		for ( const i of indices ) sum.toArray( normal, i );

	}
	return { position, normal };

}

/** UV splits share skinning and authored normals, but have separate indices. */
function smoothSeams( geometry, positions, normals ) {

	const skinIndex = geometry.getAttribute( 'skinIndex' );
	const skinWeight = geometry.getAttribute( 'skinWeight' );
	const coincident = new Map();
	for ( let vertex = 0; vertex < positions.length / 3; vertex ++ ) {

		const offset = vertex * 3;
		const key = `${positions[ offset ].toFixed( 7 )},${positions[ offset + 1 ].toFixed( 7 )},${positions[ offset + 2 ].toFixed( 7 )}`;
		const weights = new Map();
		for ( let slot = 0; slot < 4; slot ++ ) {

			const weight = skinWeight.getComponent( vertex, slot );
			if ( weight > 0 ) {

				const bone = skinIndex.getComponent( vertex, slot );
				weights.set( bone, ( weights.get( bone ) ?? 0 ) + weight );

			}

		}
		const groups = coincident.get( key ) ?? [];
		const group = groups.find( ( candidate ) => {

			if ( candidate.weights.size !== weights.size ) return false;
			for ( const [ bone, weight ] of weights ) {

				if ( ! candidate.weights.has( bone ) || Math.abs( candidate.weights.get( bone ) - weight ) > 1e-6 ) return false;

			}
			// A genuine authored hard edge stays separate even where position and
			// skin match; every member is compared, so edges never chain.
			return candidate.vertices.every( ( other ) => {

				const i = other * 3;
				return normals[ i ] * normals[ offset ] + normals[ i + 1 ] * normals[ offset + 1 ] + normals[ i + 2 ] * normals[ offset + 2 ] > 0.9999;

			} );

		} );
		if ( group ) group.vertices.push( vertex );
		else groups.push( { weights, vertices: [ vertex ] } );
		coincident.set( key, groups );

	}
	return [ ...coincident.values() ].flatMap( ( groups ) => groups.filter( ( { vertices } ) => vertices.length > 1 ).map( ( { vertices } ) => vertices ) );

}

function smoothAcrossSeams( normals, groups, positions, originalPositions ) {

	for ( const vertices of groups ) {

		// A group nothing moved stays byte for byte as authored, a full reset included.
		if ( vertices.every( ( vertex ) => {

			const i = vertex * 3;
			return positions[ i ] === originalPositions[ i ] && positions[ i + 1 ] === originalPositions[ i + 1 ] && positions[ i + 2 ] === originalPositions[ i + 2 ];

		} ) ) continue;
		let x = 0, y = 0, z = 0;
		for ( const vertex of vertices ) {

			const i = vertex * 3;
			x += normals[ i ];
			y += normals[ i + 1 ];
			z += normals[ i + 2 ];

		}
		const length = Math.hypot( x, y, z );
		if ( length < 1e-8 ) continue;
		x /= length;
		y /= length;
		z /= length;
		for ( const vertex of vertices ) {

			const i = vertex * 3;
			normals[ i ] = x;
			normals[ i + 1 ] = y;
			normals[ i + 2 ] = z;

		}

	}

}

function* shapeBasis( mesh, positions ) {

	const basis = Object.fromEntries( BODY_SHAPE_KEYS.filter( ( key ) => key !== 'height' ).map( ( key ) => [ key, new Float32Array( positions.length ) ] ) );
	const { skeleton } = mesh;
	const intoMesh = mesh.bindMatrix.clone().invert();
	const rest = skeleton.boneInverses.map( ( inverse ) => new Vector3().setFromMatrixPosition( new Matrix4().copy( inverse ).invert() ).applyMatrix4( intoMesh ) );
	const named = new Map( skeleton.bones.map( ( bone, i ) => [ bone.name, rest[ i ] ] ) );
	const required = ( name ) => {

		if ( ! named.has( name ) ) throw new Error( `the character rig is missing ${name}` );
		return named.get( name );

	};
	const pelvis = required( 'pelvis' );
	const waist = required( 'spine_01' );
	const chest = required( 'spine_03' );
	const neck = required( 'neck_01' );
	const shoulder = required( 'upperarm_l' );
	const torsoHeight = Math.max( 0.25, neck.y - pelvis.y );
	const thighLength = required( 'thigh_l' ).distanceTo( required( 'calf_l' ) );
	const centerline = [ pelvis, waist, required( 'spine_02' ), chest, neck ];
	const influences = skeleton.bones.map( ( bone, index ) => {

		const match = /^(upperarm|lowerarm|thigh|calf)_([lr])$/.exec( bone.name );
		if ( match ) {

			const [ , part, side ] = match;
			const end = { upperarm: 'lowerarm', lowerarm: 'hand', thigh: 'calf', calf: 'foot' }[ part ];
			const origin = rest[ index ];
			const direction = required( `${end}_${side}` ).clone().sub( origin );
			return {
				kind: /arm/.test( part ) ? 'arms' : 'legs', origin, direction,
				lengthSq: direction.lengthSq(), upperArm: part === 'upperarm', thigh: part === 'thigh'
			};

		}
		return { kind: /^(pelvis|spine_|clavicle_)/.test( bone.name ) ? 'torso' : 'fixed' };

	} );
	const skinIndex = mesh.geometry.getAttribute( 'skinIndex' );
	const skinWeight = mesh.geometry.getAttribute( 'skinWeight' );
	const point = new Vector3();
	const radial = new Vector3();

	for ( let vertex = 0; vertex < positions.length / 3; vertex ++ ) {

		if ( vertex % BATCH === 0 ) yield;
		const offset = vertex * 3;
		point.fromArray( positions, offset );
		let torsoWeight = 0;
		let legWeight = 0;
		for ( let slot = 0; slot < 4; slot ++ ) {

			const weight = skinWeight.getComponent( vertex, slot );
			if ( ! weight ) continue;
			const influence = influences[ skinIndex.getComponent( vertex, slot ) ];
			if ( influence.kind === 'torso' ) {

				torsoWeight += weight;

			} else if ( influence.kind === 'arms' || influence.kind === 'legs' ) {

				const { origin, direction, lengthSq, kind } = influence;
				radial.copy( point ).sub( origin );
				const along = radial.dot( direction ) / Math.max( 1e-8, lengthSq );
				radial.addScaledVector( direction, - along );
				add( basis[ kind ], offset, radial.x, radial.y, radial.z, weight );
				add( basis.build, offset, radial.x, radial.y, radial.z, weight * 0.75 );
				if ( kind === 'legs' ) {

					legWeight += weight;
					// Depth, independent of the width and radial build controls.
					basis.thickness[ offset + 2 ] += radial.z * weight;

				}
				if ( influence.thigh ) {

					// Pelvic and cleft vertices carry thigh weights too: this starts
					// below that junction, so a fuller leg never pulls the seat's
					// crease sideways, and fades out before the knee.
					const fade = smoothstep( 0.18, 0.4, along ) * ( 1 - smoothstep( 0.55, 0.85, along ) );
					add( basis.thighs, offset, radial.x, radial.y, radial.z, weight * fade );

				}
				if ( influence.upperArm ) {

					// The shoulder cap widens and fades before the elbow; hands and
					// arm lengths stay authored.
					const fade = 1 - smoothstep( 0, 0.85, along );
					basis.shoulders[ offset ] += origin.x * fade * weight;

				}

			}

		}
		const centerZ = interpolateCenter( centerline, point.y );
		const x = point.x - pelvis.x;
		const z = point.z - centerZ;
		const hipBand = bell( point.y, pelvis.y - torsoHeight * 0.08, torsoHeight * 0.44 );
		const waistBand = bell( point.y, waist.y + torsoHeight * 0.025, torsoHeight * 0.32 );
		const chestBand = bell( point.y, chest.y + torsoHeight * 0.08, torsoHeight * 0.42 );
		const shoulderBand = bell( point.y, shoulder.y, torsoHeight * 0.30 );
		add( basis.hips, offset, x, 0, z * 0.75, hipBand * ( torsoWeight + legWeight ) );
		add( basis.waist, offset, x, 0, z * 0.85, waistBand * torsoWeight );
		add( basis.chest, offset, x, 0, z * 0.8, chestBand * torsoWeight );
		add( basis.shoulders, offset, x, 0, z * 0.2, shoulderBand * torsoWeight );
		add( basis.build, offset, x, 0, z, torsoWeight * 0.85 );
		add( basis.thickness, offset, 0, 0, z, torsoWeight );

		// The rig faces +Z. A broad rear expansion keeps the authored paired
		// lobes and crease and blends into the lower back and upper thigh.
		const rearDepth = pelvis.z - point.z;
		const rear = smoothstep( torsoHeight * 0.015, torsoHeight * 0.12, rearDepth );
		const gluteCenter = pelvis.y - thighLength * 0.14;
		const gluteRadius = thighLength * 0.28;
		const gluteBand = Math.exp( - 0.5 * ( ( point.y - gluteCenter ) / gluteRadius ) ** 2 )
			* smoothstep( pelvis.y - thighLength * 0.8, pelvis.y - thighLength * 0.55, point.y )
			* ( 1 - smoothstep( pelvis.y + thighLength * 0.35, pelvis.y + thighLength * 0.55, point.y ) );
		const gluteWeight = rear * gluteBand * ( torsoWeight + legWeight );
		basis.glutes[ offset ] = x * 0.18 * gluteWeight;
		basis.glutes[ offset + 2 ] = - Math.max( 0, rearDepth ) * 1.25 * gluteWeight;

	}
	return basis;

}

/**
 * Rest-space face controls for the body skin and for the eyes and brows, one
 * field for all of them so each socket moves with its eye. The front plane
 * keeps them off the back of the skull and the ears.
 */
function* faceBasis( bodyMesh, positions, root ) {

	const auxiliaries = [];
	const intoBody = bodyMesh.bindMatrix.clone().invert();
	root.traverse( ( mesh ) => {

		if ( ! mesh.isSkinnedMesh || mesh === bodyMesh || ! /eye|brow/i.test( mesh.name ) ) return;
		const toBody = intoBody.clone().multiply( mesh.bindMatrix );
		auxiliaries.push( {
			mesh, name: mesh.name, toBody, fromBody: toBody.clone().invert(),
			original: Float32Array.from( mesh.geometry.getAttribute( 'position' ).array ),
			normals: mesh.geometry.getAttribute( 'normal' )?.array.slice() ?? null,
			index: mesh.geometry.index?.array.slice() ?? null
		} );

	} );
	const landmarks = faceLandmarks( bodyMesh, positions, auxiliaries );
	yield;
	const basis = makeFaceBasis( positions, new Matrix4(), new Matrix4(), landmarks );
	for ( const auxiliary of auxiliaries ) {

		yield;
		auxiliary.basis = makeFaceBasis( auxiliary.original, auxiliary.toBody, auxiliary.fromBody, landmarks );
		auxiliary.keys = FACE_SHAPE_KEYS.filter( ( key ) => auxiliary.basis[ key ].some( ( value ) => value !== 0 ) );
		auxiliary.seams = auxiliarySeams( auxiliary.original, auxiliary.normals );

	}
	return { basis, auxiliaries };

}

function faceLandmarks( bodyMesh, positions, auxiliaries ) {

	const eyes = [ emptyBounds(), emptyBounds() ];
	const point = new Vector3();
	for ( const { mesh, original, toBody } of auxiliaries ) {

		if ( ! /eye/i.test( mesh.name ) || /brow/i.test( mesh.name ) ) continue;
		for ( let i = 0; i < original.length; i += 3 ) {

			point.fromArray( original, i ).applyMatrix4( toBody );
			const bounds = eyes[ point.x < 0 ? 0 : 1 ];
			bounds.min.min( point );
			bounds.max.max( point );
			bounds.count ++;

		}

	}
	if ( eyes.some( ( { count } ) => ! count ) ) throw new Error( 'face controls need the character\'s two source eyes' );
	const centers = eyes.map( ( { min, max } ) => min.clone().add( max ).multiplyScalar( 0.5 ) );
	const radii = eyes.map( ( { min, max } ) => max.clone().sub( min ).multiplyScalar( 0.5 ) );
	const eyeY = ( centers[ 0 ].y + centers[ 1 ].y ) * 0.5;
	const eyeZ = ( centers[ 0 ].z + centers[ 1 ].z ) * 0.5;
	const centerX = ( centers[ 0 ].x + centers[ 1 ].x ) * 0.5;
	const halfSpacing = Math.abs( centers[ 1 ].x - centers[ 0 ].x ) * 0.5;
	const radius = ( radii[ 0 ].y + radii[ 1 ].y ) * 0.5;
	// Landmarks come from the bind pose, never from the pose playing now.
	const headIndex = bodyMesh.skeleton.bones.findIndex( ( bone ) => bone.name === 'Head' );
	if ( headIndex < 0 ) throw new Error( 'face controls need the character\'s Head bone' );
	const head = new Vector3().setFromMatrixPosition( bodyMesh.skeleton.boneInverses[ headIndex ].clone().invert() )
		.applyMatrix4( bodyMesh.bindMatrix.clone().invert() );

	let chinY = eyeY - radius * 7.8;
	let noseY = eyeY - radius * 2.7;
	let noseZ = - Infinity;
	let foundChin = false;
	for ( let i = 0; i < positions.length; i += 3 ) {

		const x = positions[ i ] - centerX, y = positions[ i + 1 ], z = positions[ i + 2 ];
		if ( Math.abs( x ) > halfSpacing * 0.48 ) continue;
		if ( y > eyeY - radius * 9 && y < eyeY - radius * 4 && z > eyeZ - radius * 0.25 && ( ! foundChin || y < chinY ) ) {

			chinY = y;
			foundChin = true;

		}
		if ( y > eyeY - radius * 4 && y < eyeY - radius * 0.6 && z > noseZ ) {

			noseY = y;
			noseZ = z;

		}

	}
	return { centers, radii, eyeY, eyeZ, centerX, halfSpacing, radius, head, chinY, noseY, mouthY: noseY - radius * 1.9 };

}

function makeFaceBasis( positions, toBody, fromBody, landmarks ) {

	const basis = Object.fromEntries( FACE_SHAPE_KEYS.map( ( key ) => [ key, new Float32Array( positions.length ) ] ) );
	const point = new Vector3();
	const moved = new Vector3();
	const deltas = Object.fromEntries( FACE_SHAPE_KEYS.map( ( key ) => [ key, new Vector3() ] ) );
	for ( let i = 0; i < positions.length; i += 3 ) {

		point.fromArray( positions, i ).applyMatrix4( toBody );
		facialDeltas( point, landmarks, deltas );
		for ( const key of FACE_SHAPE_KEYS ) {

			if ( deltas[ key ].lengthSq() === 0 ) continue;
			moved.copy( point ).add( deltas[ key ] ).applyMatrix4( fromBody );
			basis[ key ][ i ] = moved.x - positions[ i ];
			basis[ key ][ i + 1 ] = moved.y - positions[ i + 1 ];
			basis[ key ][ i + 2 ] = moved.z - positions[ i + 2 ];

		}

	}
	return basis;

}

function facialDeltas( point, landmarks, deltas ) {

	for ( const delta of Object.values( deltas ) ) delta.set( 0, 0, 0 );
	const { centers, radii, eyeY, eyeZ, centerX, halfSpacing, radius: r, chinY, noseY, mouthY, head } = landmarks;
	const x = point.x - centerX, y = point.y, z = point.z;
	const front = smoothstep( Math.max( head.z, eyeZ - r * 3 ), eyeZ - r * 1.2, z );
	const vertical = smoothstep( chinY - r * 1.2, chinY + r * 0.1, y ) * ( 1 - smoothstep( eyeY + r * 2.3, eyeY + r * 4.1, y ) );
	const face = front * vertical;
	if ( ! face ) return;

	// Width edits overlap at the lower face; bounded shares keep a narrow face,
	// jaw and mouth together from collapsing the lips.
	deltas.faceWidth.x = x * face * 0.75;
	const jaw = front * smoothstep( chinY - r * 0.8, chinY + r * 0.8, y ) * ( 1 - smoothstep( mouthY - r * 0.4, mouthY + r * 2.1, y ) );
	deltas.jawWidth.x = x * jaw * 0.65;

	const nose = ( 1 - smoothstep( r * 0.65, r * 1.75, Math.abs( x ) ) )
		* smoothstep( noseY - r * 1.4, noseY - r * 0.65, y )
		* ( 1 - smoothstep( noseY + r, noseY + r * 2.6, y ) )
		* smoothstep( eyeZ + r * 0.25, eyeZ + r * 1.1, z );
	deltas.noseSize.set( x, ( y - noseY ) * 0.35, Math.max( 0, z - eyeZ - r * 1.1 ) ).multiplyScalar( nose );

	const mouth = ( 1 - smoothstep( halfSpacing * 0.62, halfSpacing * 1.4, Math.abs( x ) ) )
		* ( 1 - smoothstep( r * 0.6, r * 1.7, Math.abs( y - mouthY ) ) )
		* smoothstep( eyeZ + r * 0.15, eyeZ + r * 0.8, z );
	deltas.mouthWidth.x = x * mouth * 0.8;

	const side = x < 0 ? 0 : 1;
	const eye = centers[ side ], eyeRadii = radii[ side ];
	const dx = point.x - eye.x, dy = y - eye.y, dz = z - eye.z;
	const distance = Math.hypot( dx / eyeRadii.x, dy / eyeRadii.y, dz / eyeRadii.z );
	// A full-strength inner region holds the whole eyeball and lid rim; the
	// cheek and brow around it fade back into the authored face.
	const socket = ( 1 - smoothstep( 1.35, 2.7, distance ) ) * smoothstep( 0, r * 0.7, Math.abs( x ) );
	deltas.eyeSize.set( dx, dy, dz ).multiplyScalar( socket );
	deltas.eyeSpacing.x = ( eye.x - centerX ) * socket;

}

function emptyBounds() {

	return { min: new Vector3( Infinity, Infinity, Infinity ), max: new Vector3( - Infinity, - Infinity, - Infinity ), count: 0 };

}

function auxiliarySeams( positions, originals ) {

	if ( ! originals ) return [];
	const groups = new Map();
	for ( let i = 0; i < positions.length; i += 3 ) {

		const key = `${positions[ i ].toFixed( 7 )},${positions[ i + 1 ].toFixed( 7 )},${positions[ i + 2 ].toFixed( 7 )}`;
		const candidates = groups.get( key ) ?? [];
		const group = candidates.find( ( indices ) => indices.every( ( j ) =>
			originals[ i ] * originals[ j ] + originals[ i + 1 ] * originals[ j + 1 ] + originals[ i + 2 ] * originals[ j + 2 ] > 0.9999 ) );
		if ( group ) group.push( i );
		else candidates.push( [ i ] );
		groups.set( key, candidates );

	}
	return [ ...groups.values() ].flat().filter( ( indices ) => indices.length > 1 );

}

function add( array, offset, x, y, z, weight ) {

	array[ offset ] += x * weight;
	array[ offset + 1 ] += y * weight;
	array[ offset + 2 ] += z * weight;

}

function bell( value, center, radius ) {

	return 1 - smoothstep( 0, radius, Math.abs( value - center ) );

}

function smoothstep( min, max, value ) {

	const t = Math.max( 0, Math.min( 1, ( value - min ) / Math.max( 1e-8, max - min ) ) );
	return t * t * ( 3 - 2 * t );

}

function interpolateCenter( points, y ) {

	if ( y <= points[ 0 ].y ) return points[ 0 ].z;
	for ( let i = 1; i < points.length; i ++ ) {

		if ( y <= points[ i ].y ) {

			const t = ( y - points[ i - 1 ].y ) / Math.max( 1e-8, points[ i ].y - points[ i - 1 ].y );
			return points[ i - 1 ].z + ( points[ i ].z - points[ i - 1 ].z ) * t;

		}

	}
	return points.at( - 1 ).z;

}
