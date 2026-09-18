import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three/webgpu';

/**
 * What a batch needs of the geometries it is handed: each drawing only its own
 * vertices, all of them agreeing on whether they carry an index, and one
 * attribute layout across them.
 *
 * A producer publishes a piece as several primitives over one shared vertex
 * buffer, and quantizes each attribute to whatever fits it. Neither survives a
 * batch: a primitive copied whole carries the other primitives' vertices with
 * it, and a batch has one buffer per attribute, so two geometries that disagree
 * on a type cannot both be written into it. A batch is also indexed or not as a
 * whole, so a bucket that mixes the two has to settle it before it is filled.
 */

/** Every geometry of one batch, ready to be written into it. Returns them in order. */
export function prepare( geometries ) {

	const ready = geometries.map( ( geometry ) => ( exclusive( geometry ) ? geometry : compact( geometry ) ) );

	if ( ready.some( ( geometry ) => geometry.getIndex() ) ) {

		for ( const geometry of ready ) if ( ! geometry.getIndex() ) sequence( geometry );

	}

	return conform( ready );

}

/**
 * True when the geometry's buffers hold its vertices and nothing else: no
 * interleaving, no room for a neighbouring primitive, and every vertex drawn.
 * A batch copies a plain attribute array whole, so anything else is carried in.
 */
function exclusive( geometry ) {

	const vertices = geometry.getAttribute( 'position' )?.count;
	if ( ! vertices ) return false;

	for ( const attribute of Object.values( geometry.attributes ) ) {

		if ( attribute.isInterleavedBufferAttribute ) return false;
		if ( attribute.count !== vertices || attribute.array.length !== vertices * attribute.itemSize ) return false;

	}

	const index = geometry.getIndex();
	if ( ! index ) return true;

	const drawn = new Uint8Array( vertices );
	let used = 0;
	for ( let i = 0; i < index.count; i ++ ) {

		const vertex = index.getX( i );
		if ( ! drawn[ vertex ] ) {

			drawn[ vertex ] = 1;
			used ++;

		}

	}

	return used === vertices;

}

/** The index a geometry drawn straight from its vertices needs to join an indexed batch. */
function sequence( geometry ) {

	const count = geometry.getAttribute( 'position' ).count;
	const drawn = new Uint32Array( count );
	for ( let i = 0; i < count; i ++ ) drawn[ i ] = i;

	geometry.setIndex( new BufferAttribute( drawn, 1 ) );

}

/** Exactly the vertices this geometry's index draws, renumbered in first-use order. */
export function compact( geometry ) {

	const index = geometry.getIndex();
	if ( ! index ) return geometry.clone();

	const moved = new Int32Array( geometry.getAttribute( 'position' ).count ).fill( - 1 );
	const kept = [];
	const drawn = new Uint32Array( index.count );

	for ( let i = 0; i < index.count; i ++ ) {

		const vertex = index.getX( i );
		if ( moved[ vertex ] < 0 ) {

			moved[ vertex ] = kept.length;
			kept.push( vertex );

		}
		drawn[ i ] = moved[ vertex ];

	}

	const compacted = new BufferGeometry();
	for ( const name of Object.keys( geometry.attributes ) ) {

		compacted.setAttribute( name, picked( geometry.getAttribute( name ), kept ) );

	}
	compacted.setIndex( new BufferAttribute( drawn, 1 ) );
	compacted.userData = geometry.userData;

	return compacted;

}

/**
 * One layout across these geometries: every attribute any of them carries,
 * rewritten as plain floats wherever they disagree on a type and zero filled
 * wherever one of them lacks it. Returns them, changed in place.
 */
function conform( geometries ) {

	const layout = new Map();

	for ( const geometry of geometries ) {

		for ( const name of Object.keys( geometry.attributes ) ) {

			const attribute = geometry.getAttribute( name );
			const held = layout.get( name );

			if ( ! held ) {

				layout.set( name, { itemSize: attribute.itemSize, type: attribute.array.constructor, normalized: attribute.normalized, plain: false } );
				continue;

			}
			if ( held.itemSize !== attribute.itemSize ) {

				throw new Error( `batch attribute ${name} has itemSize ${attribute.itemSize} and ${held.itemSize}` );

			}
			if ( held.type !== attribute.array.constructor || held.normalized !== attribute.normalized ) held.plain = true;

		}

	}

	for ( const [ name, held ] of layout ) {

		if ( ! held.plain && geometries.every( ( geometry ) => geometry.getAttribute( name ) ) ) continue;
		for ( const geometry of geometries ) rewrite( geometry, name, held.itemSize );

	}

	return geometries;

}

/** One attribute as plain floats, zero filled where the geometry lacks it. */
function rewrite( geometry, name, itemSize ) {

	const attribute = geometry.getAttribute( name );
	const count = geometry.getAttribute( 'position' ).count;
	const values = new Float32Array( count * itemSize );

	if ( attribute ) {

		for ( let i = 0; i < count; i ++ ) {

			for ( let c = 0; c < itemSize; c ++ ) values[ i * itemSize + c ] = attribute.getComponent( i, c );

		}

	}
	geometry.setAttribute( name, new Float32BufferAttribute( values, itemSize ) );

}

/** One attribute over the vertices a compaction kept, in that order and that type. */
function picked( attribute, kept ) {

	const { itemSize, normalized } = attribute;
	const values = new attribute.array.constructor( kept.length * itemSize );
	const stride = attribute.isInterleavedBufferAttribute ? attribute.data.stride : itemSize;
	const offset = attribute.offset ?? 0;
	const source = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;

	for ( let i = 0; i < kept.length; i ++ ) {

		for ( let c = 0; c < itemSize; c ++ ) values[ i * itemSize + c ] = source[ kept[ i ] * stride + offset + c ];

	}

	return new BufferAttribute( values, itemSize, normalized );

}
