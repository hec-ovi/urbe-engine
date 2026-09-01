import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const SPACING = 22;
const POLE_HEIGHT = 6.4;
const POLE_RADIUS = 0.085;
const ARM = 1.1;
const LAMP_COLOR = 0xffcf9a;

/**
 * Lamp posts down both sides of every street and road, placed on the sidewalk
 * from the atlas street graph. Poles and heads each merge into one mesh; the
 * heads carry the materials database's emissive light-fixture entry, and every
 * head registers a glow so the light budget can put a real light in the ones
 * near the player.
 */
export class StreetLamps {

	constructor( atlas, factory ) {

		this.atlas = atlas;
		this.factory = factory;

	}

	/** @returns { group, glows } */
	build() {

		const poles = [];
		const heads = [];
		const glows = [];

		for ( const edge of this.atlas.streets.edges ) {

			const offset = edge.width / 2 + Math.max( 1.1, ( edge.sidewalk?.left ?? 2.5 ) * 0.45 );

			for ( const { point, normal } of samplePath( edge.path, SPACING ) ) {

				for ( const side of [ 1, - 1 ] ) {

					const x = point.x + normal.x * offset * side;
					const z = point.z + normal.z * offset * side;
					this.#lamp( poles, heads, glows, x, z, - normal.x * side, - normal.z * side );

				}

			}

		}

		const group = new THREE.Group();
		group.name = 'lamps';

		if ( poles.length ) {

			group.add( new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( poles, false ),
				this.factory.build( 'cyberpunk/metal/rich' )
			) );

		}

		if ( heads.length ) {

			const material = this.factory.build( 'cyberpunk/light-fixture/mid' );
			material.emissiveIntensity = ( material.emissiveIntensity ?? 1 ) * 2.5;
			group.add( new THREE.Mesh( BufferGeometryUtils.mergeGeometries( heads, false ), material ) );

		}

		return { group, glows };

	}

	#lamp( poles, heads, glows, x, z, ax, az ) {

		const base = 0.12;
		const pole = new THREE.CylinderGeometry( POLE_RADIUS, POLE_RADIUS * 1.5, POLE_HEIGHT, 6, 1 );
		pole.translate( x, base + POLE_HEIGHT / 2, z );
		poles.push( strip( pole ) );

		const arm = new THREE.CylinderGeometry( POLE_RADIUS * 0.7, POLE_RADIUS * 0.7, ARM, 5, 1 );
		arm.rotateZ( Math.PI / 2 );
		arm.rotateY( - Math.atan2( az, ax ) );
		arm.translate( x + ax * ARM / 2, base + POLE_HEIGHT - 0.1, z + az * ARM / 2 );
		poles.push( strip( arm ) );

		const hx = x + ax * ARM;
		const hz = z + az * ARM;
		const head = new THREE.BoxGeometry( 0.44, 0.16, 0.8 );
		head.rotateY( - Math.atan2( az, ax ) );
		head.translate( hx, base + POLE_HEIGHT - 0.22, hz );
		heads.push( strip( head ) );

		glows.push( {
			position: new THREE.Vector3( hx, base + POLE_HEIGHT - 0.4, hz ),
			color: LAMP_COLOR,
			intensity: 42,
			distance: 24
		} );

	}

}

/** Points every `step` metres along a polyline, with the left-hand normal. */
export function samplePath( path, step ) {

	const out = [];
	let carry = step / 2;

	for ( let i = 0; i < path.length - 1; i ++ ) {

		const [ ax, az ] = path[ i ];
		const [ bx, bz ] = path[ i + 1 ];
		const dx = bx - ax;
		const dz = bz - az;
		const length = Math.hypot( dx, dz );

		if ( length < 1e-6 ) continue;

		const ux = dx / length;
		const uz = dz / length;
		const normal = new THREE.Vector3( uz, 0, - ux );

		for ( let d = carry; d < length; d += step ) {

			out.push( { point: new THREE.Vector3( ax + ux * d, 0, az + uz * d ), normal } );

		}

		carry = Math.max( 0, carry - length ) || step - ( ( length - carry ) % step );

	}

	return out;

}

/** Primitive geometries carry uv sets we never use; drop everything but the basics. */
function strip( geometry ) {

	geometry.deleteAttribute( 'uv1' );

	return geometry.index ? geometry.toNonIndexed() : geometry;

}
