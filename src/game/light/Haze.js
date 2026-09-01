import * as THREE from 'three/webgpu';
import {
	attribute, cameraProjectionMatrix, modelViewMatrix, positionLocal, uv, vec4, float,
	linearDepth, viewportLinearDepth, remapClamp
} from 'three/tsl';

/** How the brightness falls from the source to the edge of the glow. */
const FALLOFF = 2.4;
/** Metres of scene depth over which a glow fades out against what is behind it. */
const SOFTNESS = 1.2;
/** Scattering fraction: how much of a fixture's flux the air sends back. */
const SCATTER = 2.2e-4;

/**
 * The glow around a fixture that is not bloom.
 *
 * The two are different mechanisms wearing one name, and the reference frames
 * measure apart cleanly: a street lamp in thin air has a tight halo that falls
 * below a tenth of its peak within about three source radii, which is lens
 * bloom; a panel in a hazy room has a wide weak wash reaching a fifth of the
 * frame, which is light scattering in the air between the fixture and the eye.
 * Bloom cannot make the wide one without smearing the whole frame, so the wide
 * one is geometry: a camera-facing quad per fixture, additive, its brightness
 * set by the fixture's own flux, faded where it meets a surface so it never
 * cuts a hard disc into the floor.
 *
 * One merged mesh per set, so a street of lamps is one draw call.
 */
export class Haze {

	/**
	 * @param fixtures [{ position, lumens, color, range }]
	 * @param spread glow radius as a fraction of a fixture's useful range
	 * @param cap largest glow radius in metres
	 */
	static build( fixtures, { spread = 0.35, cap = 2.4 } = {} ) {

		if ( ! fixtures.length ) return null;

		const count = fixtures.length;
		const position = new Float32Array( count * 4 * 3 );
		const corner = new Float32Array( count * 4 * 2 );
		const uvs = new Float32Array( count * 4 * 2 );
		const tint = new Float32Array( count * 4 * 3 );
		const index = new Uint32Array( count * 6 );
		const corners = [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ];

		fixtures.forEach( ( fixture, i ) => {

			const radius = Math.min( cap, fixture.range * spread );
			// Radiance of the air in the glow: flux spread over the sphere the
			// glow occupies, times the fraction the medium scatters back.
			const level = SCATTER * fixture.lumens / ( 4 * Math.PI * radius * radius );

			for ( let v = 0; v < 4; v ++ ) {

				const p = ( i * 4 + v ) * 3;
				const q = ( i * 4 + v ) * 2;

				position[ p ] = fixture.position.x;
				position[ p + 1 ] = fixture.position.y;
				position[ p + 2 ] = fixture.position.z;

				corner[ q ] = corners[ v ][ 0 ] * radius;
				corner[ q + 1 ] = corners[ v ][ 1 ] * radius;

				uvs[ q ] = ( corners[ v ][ 0 ] + 1 ) / 2;
				uvs[ q + 1 ] = ( corners[ v ][ 1 ] + 1 ) / 2;

				tint[ p ] = fixture.color.r * level;
				tint[ p + 1 ] = fixture.color.g * level;
				tint[ p + 2 ] = fixture.color.b * level;

			}

			const base = i * 4;
			index.set( [ base, base + 1, base + 2, base, base + 2, base + 3 ], i * 6 );

		} );

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( position, 3 ) );
		geometry.setAttribute( 'corner', new THREE.BufferAttribute( corner, 2 ) );
		geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
		geometry.setAttribute( 'tint', new THREE.BufferAttribute( tint, 3 ) );
		geometry.setIndex( new THREE.BufferAttribute( index, 1 ) );
		geometry.computeBoundingSphere();

		const mesh = new THREE.Mesh( geometry, hazeMaterial() );
		mesh.name = 'haze';
		mesh.frustumCulled = false;

		return mesh;

	}

}

/** The quad expands in view space, so every glow faces the camera for free. */
function hazeMaterial() {

	if ( _material ) return _material;

	const material = new THREE.MeshBasicNodeMaterial();
	const view = modelViewMatrix.mul( vec4( positionLocal, 1 ) );
	const offset = attribute( 'corner', 'vec2' );

	material.vertexNode = cameraProjectionMatrix.mul(
		vec4( view.xy.add( offset ), view.z, view.w )
	);

	const radial = uv().sub( 0.5 ).mul( 2 ).length().oneMinus().max( 0 ).pow( FALLOFF );
	const soft = remapClamp( viewportLinearDepth.sub( linearDepth() ), float( 0 ), float( SOFTNESS ), 0, 1 );

	material.colorNode = attribute( 'tint', 'vec3' );
	material.opacityNode = radial.mul( soft );
	material.transparent = true;
	material.blending = THREE.AdditiveBlending;
	material.depthWrite = false;
	material.fog = false;
	_material = material;

	return material;

}

let _material = null;
