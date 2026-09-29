import { attribute, float, instancedBufferAttribute, int, mix, normalGeometry, positionGeometry, step, texture, vec3, vec4 } from 'three/tsl';
import { CrowdMesh } from './CrowdMesh.js';
import { PoseBuffer } from './PoseBuffer.js';
import { HAIR_SCALE } from './avatar/Tints.js';
import { HAIRSTYLES } from './CharacterCatalog.js';

/** The style a part carries when every person wears it: the eyebrows. */
export const EVERYONE = - 1;
/** The style a person without hair wears: no part has it. */
const BALD = - 2;

/**
 * Hair and eyebrows for a whole crowd in one draw: every hairstyle of the
 * body's gender and its eyebrows, merged. All of them follow only the Head
 * bone, so what is baked is that bone's transform per frame of every clip, not
 * each vertex's: a person's parts are their Head-space geometry carried by it.
 * Each vertex names the style it belongs to (`hairPart.x`, EVERYONE for the
 * brows) and which of the pack's two hair maps it paints from (`hairPart.y`);
 * each person carries their hair colour and the index of their style, and the
 * vertices of every other style fold to a point, so a street is every
 * haircut of the Source pack in the colours of its people at one draw call.
 */
export class HairMesh extends CrowdMesh {

	/** The rigid parts carry their own rest normals and style marks. */
	kept() {

		return [ 'normal', 'hairPart' ];

	}

	posed( baked, storageCapable, { row0, row1, blend } ) {

		// Colour and style are made here, before the colour: the style decides
		// which vertices stand at all.
		this.hair = this.attribute( 4 );
		this.styles = baked.styles;
		const aHair = instancedBufferAttribute( this.hair, 'vec4' );
		const head = new PoseBuffer( baked.head, 3, baked.rows, storageCapable );
		const part = attribute( 'hairPart', 'vec2' );
		const worn = float( 1 ).sub( step( 0.5, part.x.sub( aHair.w ).abs() ) );
		const shown = step( part.x, EVERYONE + 0.5 ).max( worn );
		const carry = ( row, value ) => vec3(
			head.row( row, int( 0 ) ).dot( value ),
			head.row( row, int( 1 ) ).dot( value ),
			head.row( row, int( 2 ) ).dot( value )
		);
		const at = vec4( positionGeometry, 1 );
		const along = vec4( normalGeometry, 0 );
		return {
			position: mix( carry( row0, at ), carry( row1, at ), blend ).mul( shown ),
			normal: mix( carry( row0, along ), carry( row1, along ), blend ).normalize()
		};

	}

	/** @param paint `{ maps: [ the pack's first hair map, its second ] }` */
	colorNode( geometry, { maps } ) {

		const part = attribute( 'hairPart', 'vec2' );
		const map = mix( texture( maps[ 0 ] ).rgb, texture( maps[ 1 ] ?? maps[ 0 ] ).rgb, part.y );
		const tint = instancedBufferAttribute( this.hair, 'vec4' ).xyz;
		return vec4( map.mul( vec3( HAIR_SCALE.r, HAIR_SCALE.g, HAIR_SCALE.b ) ).mul( tint ), 1 );

	}

	surface( material ) { material.roughness = 0.96; }

	setLook( slot, look ) {

		this.hair.setXYZW( slot, look.hair.r, look.hair.g, look.hair.b, this.styles.index( look.hairStyle ) );

	}

}

/**
 * The hairstyles a crowd body of a gender draws, in the order its merged hair
 * numbers them: the adult styles, then facial hair. A teen style stands for
 * its adult one, and a style of the other gender or none leaves the head bare.
 */
export function crowdHairstyles( gender ) {

	const set = HAIRSTYLES[ gender ];
	const styles = [ ...set.adult, ...set.facial ];
	return {
		paths: styles,
		index( path ) {

			if ( ! path ) return BALD;
			const index = styles.indexOf( path.replace( /_Teen\.gltf$/, '.gltf' ) );
			return index >= 0 ? index : BALD;

		}
	};

}
