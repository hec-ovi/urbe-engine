import { Vector3 } from 'three/webgpu';
import { bool, renderGroup, uniform } from 'three/tsl';
import { pointInRing } from '../ground/Polygons.js';

const EPSILON = 1e-4;

/** Scenic rooms belong to the exterior view of their own building. */
export class ExteriorScenery {

	constructor( blueprint ) {

		this.volumes = blueprint?.floors?.length ? blueprint.floors : [ {
			outline: blueprint?.bounds?.footprint,
			elevation: 0,
			height: blueprint?.bounds?.height
		} ];
		const position = new Vector3();
		this.visible = uniform( true ).setGroup( renderGroup )
			.onRenderUpdate( ( { camera } ) => this.isOutside( camera.getWorldPosition( position ) ) );

	}

	isOutside( { x, y, z } ) {

		return ! this.volumes.some( ( { outline, elevation, height } ) =>
			outline?.length >= 3 && y >= elevation - EPSILON && y <= elevation + height + EPSILON && contains( x, z, outline ) );

	}

	/** Attach to an already-owned scenic material without replacing its shading. */
	attach( material ) {

		material.maskNode = material.maskNode ? bool( material.maskNode ).and( this.visible ) : this.visible;
		material.userData.ownedScenicMaterial = true;
		return material;

	}

	/** Catalog materials remain shared and untouched. */
	material( catalog ) {

		const material = catalog.clone();
		// Basic node materials do not declare this custom scenic shading slot,
		// so Three's clone omits it even when the source uses it.
		if ( catalog.emissiveNode !== undefined ) material.emissiveNode = catalog.emissiveNode;
		// Classic materials can also acquire a floor-slice mask in the viewer.
		if ( catalog.maskNode !== undefined ) material.maskNode = catalog.maskNode;
		return this.attach( material );

	}

}

function contains( x, z, ring ) {

	if ( pointInRing( x, z, ring ) ) return true;
	// Include walls consistently, whichever way the polygon is wound.
	return ring.some( ( [ ax, az ], i ) => {

		const [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
		const dx = bx - ax, dz = bz - az;
		const lengthSquared = dx * dx + dz * dz;
		const t = lengthSquared ? Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / lengthSquared ) ) : 0;
		return Math.hypot( x - ax - t * dx, z - az - t * dz ) <= EPSILON;

	} );

}
