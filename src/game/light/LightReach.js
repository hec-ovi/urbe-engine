import * as THREE from 'three/webgpu';
import { If, Loop, getDistanceAttenuation, positionView, vec3 } from 'three/tsl';
import PointLightDataNode from 'three/addons/tsl/lighting/data/PointLightDataNode.js';

const _frustum = new THREE.Frustum();
const _projection = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _position = new THREE.Vector3();

/**
 * Whether a light's colour at a fragment is anything at all. Colours are never
 * negative, so the largest channel above zero is the whole test.
 */
export const reaches = ( color ) => color.x.max( color.y ).max( color.z ).greaterThan( 0 );

/**
 * The street's batched point lights, costing a fragment only the lights that
 * reach it.
 *
 * Three's batched point lights evaluate the full surface response for every
 * slot at every fragment, and the city keeps its whole pool of slots in the
 * scene whether or not a fixture stands in them. A slot's light ends at its
 * cutoff, where the window term is exactly zero, and most of the pool stands
 * tens of metres from most of the frame, so almost all of that work adds
 * nothing: on the WebGL2 path it was the largest share of the frame's GPU time.
 *
 * So each render hands the loop only the lights that can reach something the
 * camera sees: a dark slot, or one whose sphere of reach lies wholly outside
 * the frustum, is left out of the uniform arrays, and the count the loop runs
 * to is what is left. The loop skips the surface response for a fragment past
 * a light's cutoff. Neither changes a single lit value; the slot objects, the
 * arrays and the shader stay the same, so nothing recompiles as lights come
 * and go.
 */
export class ReachedPointLightDataNode extends PointLightDataNode {

	static get type() {

		return 'ReachedPointLightDataNode';

	}

	update( frame ) {

		const camera = frame.camera;
		if ( ! camera ) return super.update( frame );
		_projection.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		_frustum.setFromProjectionMatrix( _projection, camera.coordinateSystem, camera.reversedDepth === true );
		let count = 0;
		for ( const light of this._lights ) {

			if ( count >= this.maxCount ) break;
			if ( ! ( light.intensity > 0 ) || ( light.color.r <= 0 && light.color.g <= 0 && light.color.b <= 0 ) ) continue;
			_position.setFromMatrixPosition( light.matrixWorld );
			// A cutoff of zero is a light with no end, which reaches the whole frustum.
			if ( light.distance > 0 ) {

				_sphere.center.copy( _position );
				_sphere.radius = light.distance;
				if ( ! _frustum.intersectsSphere( _sphere ) ) continue;

			}
			this._colors[ count ].copy( light.color ).multiplyScalar( light.intensity );
			_position.applyMatrix4( camera.matrixWorldInverse );
			this._positionsAndCutoff[ count ].set( _position.x, _position.y, _position.z, light.distance );
			this._decays[ count ].x = light.decay;
			count ++;

		}
		this.countNode.value = count;

	}

	setup( builder ) {

		const surfacePosition = builder.context.positionView || positionView;
		const { lightingModel, reflectedLight } = builder.context;
		const dynDiffuse = vec3( 0 ).toVar( 'dynPointDiffuse' );
		const dynSpecular = vec3( 0 ).toVar( 'dynPointSpecular' );

		Loop( this.countNode, ( { i } ) => {

			const positionAndCutoff = this.positionsAndCutoffNode.element( i );
			const cutoffDistance = positionAndCutoff.w.toVar();
			const lightVector = positionAndCutoff.xyz.sub( surfacePosition ).toVar();
			const lightDistance = lightVector.length().toVar();

			If( cutoffDistance.lessThanEqual( 0 ).or( lightDistance.lessThan( cutoffDistance ) ), () => {

				const lightDirection = lightVector.normalize().toVar();
				const attenuation = getDistanceAttenuation( {
					lightDistance,
					cutoffDistance,
					decayExponent: this.decaysNode.element( i ).x
				} );
				const lightColor = this.colorsNode.element( i ).mul( attenuation ).toVar();

				lightingModel.direct( {
					lightDirection,
					lightColor,
					lightNode: { light: {}, shadowNode: null },
					reflectedLight: { directDiffuse: dynDiffuse, directSpecular: dynSpecular }
				}, builder );

			} );

		} );

		reflectedLight.directDiffuse.addAssign( dynDiffuse );
		reflectedLight.directSpecular.addAssign( dynSpecular );

	}

}
