import * as THREE from 'three/webgpu';
import { attribute, color, float, floor, max, mod, texture, uv, vec2 } from 'three/tsl';
import { CHARSET } from '../../../assembly/signText.js';

/** The Materials letter atlas is eight columns by six rows, row major. */
const COLUMNS = 8, ROWS = 6;
/** The sheet every sign in the city letters from, and how the streets light it. */
const ATLAS = { key: 'cyberpunk/letter-atlas/rich', variant: 'neon' };
const TINT = '#d5f8ff', BRIGHTNESS = 2.5, ROUGHNESS = 0.25;
/** Clear of the sign plate, so the glyph never fights it for depth. */
const LIFT = 0.01;
/** A blank cell draws nothing, so a space is a gap and not an instance. */
const BLANK = CHARSET.indexOf( ' ' );
const FIRST_CAPACITY = 64;

/**
 * The words the city letters on its buildings.
 *
 * A shared plan is drawn with an empty sign field and never a word, so a hotel,
 * a market and a diner stand the same building. What tells them apart is here:
 * each parcel's own word, lettered on the field its plan publishes, one quad
 * per letter reading its cell of the Materials letter atlas. Every sign in the
 * city wears that one sheet, so all of them draw in one batch however many
 * buildings stand, and a cell takes its letters back out when it drops.
 */
export class KitSigns {

	/**
	 * @param factory the shared PBR factory, which owns the atlas texture
	 * @param onError receives an atlas this machine cannot serve
	 */
	constructor( { factory, name = 'kit-signs', onError = console.error } ) {

		this.count = 0;
		this.capacity = FIRST_CAPACITY;
		this.owners = [];
		this.matrices = instanceBuffer( FIRST_CAPACITY, 16 );
		this.glyphs = instanceBuffer( FIRST_CAPACITY, 1 );
		this.group = new THREE.Group();
		this.group.name = name;
		this.atlas = atlasTexture( factory );
		this.geometry = new THREE.PlaneGeometry( 1, 1 );
		this.material = this.atlas ? lettering( this.atlas ) : null;
		this.mesh = this.atlas ? this.#mesh( name ) : null;

		if ( this.mesh ) this.group.add( this.mesh );
		else onError( `${ATLAS.key}#${ATLAS.variant} serves no map, so the city letters no signs` );

	}

	/**
	 * Letters one parcel's word across the field its building carries.
	 * @param sign a `signage` entry of the parcel's blueprint, in world metres
	 * @param word what this parcel reads, from its placement record
	 * @returns the handle that takes these letters back out, or null when there
	 * is nothing to letter
	 */
	admit( sign, word ) {

		const row = field( sign );
		const glyphs = [ ...( word ?? '' ) ].map( ( char ) => cellOf( char ) );

		if ( ! this.mesh || ! row || ! glyphs.length ) return null;

		const handle = { slots: [] };
		const size = Math.min( row.height, row.width / glyphs.length );

		for ( const [ index, glyph ] of glyphs.entries() ) {

			if ( glyph === BLANK ) continue;

			handle.slots.push( this.#add( place( row, size, index - ( glyphs.length - 1 ) / 2 ), glyph, handle ) );

		}

		return handle.slots.length ? handle : null;

	}

	/** Takes one parcel's letters out of the batch. */
	release( handle ) {

		if ( ! handle ) return;
		// Highest first, so a letter this call is about to free is never the one
		// swapped into an earlier slot.
		for ( const slot of [ ...handle.slots ].sort( ( a, b ) => b - a ) ) this.#remove( slot, handle );
		handle.slots.length = 0;

	}

	/** The buffers, the quad and the material are this batch's; the atlas sheet is the factory's. */
	dispose() {

		this.mesh?.dispose();
		this.material?.dispose();
		this.geometry.dispose();
		this.group.clear();
		this.group.removeFromParent();
		this.mesh = null;
		this.owners = [];
		this.count = 0;

	}

	#add( matrix, glyph, handle ) {

		if ( this.count === this.capacity ) this.#grow( this.capacity * 2 );

		const slot = this.count ++;

		matrix.toArray( this.matrices.array, slot * 16 );
		this.glyphs.array[ slot ] = glyph;
		this.owners[ slot ] = handle;
		this.#published( slot );

		return slot;

	}

	#remove( slot, handle ) {

		if ( this.owners[ slot ] !== handle ) return;

		const last = -- this.count;

		if ( slot !== last ) {

			this.matrices.array.copyWithin( slot * 16, last * 16, last * 16 + 16 );
			this.glyphs.array[ slot ] = this.glyphs.array[ last ];
			this.owners[ slot ] = this.owners[ last ];
			// The letter that moved is one of its own parcel's, named by where it
			// stood; it now stands here.
			const moved = this.owners[ slot ].slots;
			moved[ moved.indexOf( last ) ] = slot;

		}

		this.owners.length = this.count;
		this.#published( slot === last ? - 1 : slot );

	}

	#mesh( name ) {

		const mesh = new THREE.InstancedMesh( this.geometry, this.material, 0 );

		mesh.name = name;
		mesh.instanceMatrix = this.matrices;
		mesh.count = this.count;
		this.geometry.setAttribute( 'glyph', this.glyphs );
		// A letter is a lit decal on a facade that already stands: it shadows
		// nothing, and one sphere over every sign in the city answers "visible".
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.frustumCulled = false;

		return mesh;

	}

	/** A cell wanted more letters than the buffers hold. */
	#grow( capacity ) {

		const matrices = instanceBuffer( capacity, 16 );
		const glyphs = instanceBuffer( capacity, 1 );

		matrices.array.set( this.matrices.array );
		glyphs.array.set( this.glyphs.array );
		this.matrices = matrices;
		this.glyphs = glyphs;
		this.capacity = capacity;

		const previous = this.mesh;

		this.mesh = this.#mesh( this.group.name );
		previous.dispose();
		previous.removeFromParent();
		this.group.add( this.mesh );

	}

	/** @param slot the one that changed, or -1 when only the count did */
	#published( slot ) {

		this.mesh.count = this.count;
		if ( slot < 0 ) return;

		this.matrices.needsUpdate = true;
		this.glyphs.needsUpdate = true;

	}

}

/** Which cell of the sheet a character reads; anything outside it is blank. */
function cellOf( char ) {

	const at = CHARSET.indexOf( char );

	return at < 0 ? BLANK : at;

}

/**
 * The sign field of a building that stands from a shared plan: the one its plan
 * carries no word of its own on. A plan drawn with a word letters itself.
 */
export function signField( blueprint ) {

	return ( blueprint?.signage ?? [] ).find( ( sign ) => ! sign.text ) ?? null;

}

/**
 * Where a word stands: the field's own frame, clear of the plate, with the
 * letters running along the facade and the row centred on the field.
 */
function field( sign ) {

	const forward = new THREE.Vector3( sign?.normal?.[ 0 ] ?? 0, 0, sign?.normal?.[ 1 ] ?? 0 );

	if ( ! sign || ! ( forward.lengthSq() > 0 ) || ! ( sign.width > 0 ) || ! ( sign.height > 0 ) ) return null;

	forward.normalize();

	const up = new THREE.Vector3( 0, 1, 0 );

	return {
		right: new THREE.Vector3().crossVectors( up, forward ),
		up, forward,
		centre: new THREE.Vector3( ...sign.center )
			.addScaledVector( forward, ( sign.standoff ?? 0 ) + ( sign.depth ?? 0 ) + LIFT ),
		width: sign.width,
		height: sign.height
	};

}

/** One letter's square cell, `cells` cells along the row from its centre. */
function place( row, size, cells ) {

	return new THREE.Matrix4()
		.makeBasis( row.right, row.up, row.forward )
		.scale( new THREE.Vector3( size, size, 1 ) )
		.setPosition( row.centre.clone().addScaledVector( row.right, cells * size ) );

}

/** The atlas sheet, through the factory that owns every map the city loads. */
function atlasTexture( factory ) {

	const material = factory.build( ATLAS.key, ATLAS.variant );

	return material?.emissiveMap ?? material?.map ?? null;

}

/**
 * One quad, one glyph: the cell the instance's own index names, read off the
 * sheet. The art is light on black and carries no alpha, so the glyph's own
 * brightness is what stands on the facade and the sheet behind it shows
 * nothing, which is the way the streets letter their marquee face.
 */
function lettering( atlas ) {

	const glyph = attribute( 'glyph', 'float' );
	const cell = uv();
	const column = mod( glyph, COLUMNS );
	const row = floor( glyph.div( COLUMNS ) );
	// A sheet loaded the way the city loads its maps runs top down, so the
	// glyph's first row is the sheet's first row.
	const down = row.add( cell.y.oneMinus() ).div( ROWS );
	const up = float( ROWS ).sub( row ).sub( 1 ).add( cell.y ).div( ROWS );
	const art = texture( atlas, vec2( column.add( cell.x ).div( COLUMNS ), atlas.flipY ? up : down ) );
	const lit = art.rgb.mul( color( TINT ) );
	const material = new THREE.MeshStandardNodeMaterial( { name: 'kit-signs:letters', metalness: 0 } );

	material.colorNode = lit;
	material.emissiveNode = lit.mul( BRIGHTNESS );
	material.roughnessNode = float( ROUGHNESS );
	material.opacityNode = max( max( art.r, art.g ), art.b );
	material.transparent = true;
	material.depthWrite = false;

	return material;

}

function instanceBuffer( capacity, itemSize ) {

	const buffer = new THREE.InstancedBufferAttribute( new Float32Array( capacity * itemSize ), itemSize );

	buffer.setUsage( THREE.DynamicDrawUsage );

	return buffer;

}
