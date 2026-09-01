import * as THREE from 'three/webgpu';
import { box, tube, merge } from './Shapes.js';

// A twelve metre city bus, in the dimensions one is built in: 11.9 m over the
// bumpers, 2.55 m wide (the legal maximum), 3.1 m to the roof, floor skirt
// clearing the road at 0.35 m, 1.0 m wheels on a 6 m wheelbase.
const LENGTH = 11.9;
const WIDTH = 2.55;
const ROOF = 3.1;
const SKIRT = [ 0.35, 0.85 ];
const BODY = [ 0.85, 1.9 ];
const GLAZING = [ 1.9, 2.85 ];
const WHEEL_RADIUS = 0.5;
const WHEEL_WIDTH = 0.3;
const WHEELBASE = 6;
const AXLE_OFFSET = 1.2;

const BODY_KEY = 'cyberpunk/metal/mid';
const GLASS_KEY = 'cyberpunk/glass/mid';
const TYRE_KEY = 'cyberpunk/rubber/mid';

/**
 * One bus, modelled once and instanced. The CC0 vehicle pack has no bus, so
 * this is built from a real one's dimensions out of database materials, the
 * same way a lamp post is: painted panels below the window line, a glazed band
 * that wraps the flanks and both ends, a roof cap, and four wheels.
 *
 * Three instanced meshes, one per material, is the whole fleet's cost: the
 * body, the glass and the tyres. The origin sits on the road at the middle of
 * the bus, with +Z forward, because that is the frame the transit library
 * reports a vehicle's position and heading in.
 */
export class BusModel {

	/** @param capacity how many buses may be on screen at once */
	constructor( factory, capacity ) {

		const painted = [];

		const skirt = box( WIDTH - 0.12, SKIRT[ 1 ] - SKIRT[ 0 ], LENGTH - 0.5 );
		skirt.translate( 0, ( SKIRT[ 0 ] + SKIRT[ 1 ] ) / 2, 0 );
		painted.push( skirt );

		const body = box( WIDTH, BODY[ 1 ] - BODY[ 0 ], LENGTH );
		body.translate( 0, ( BODY[ 0 ] + BODY[ 1 ] ) / 2, 0 );
		painted.push( body );

		const roof = box( WIDTH, ROOF - GLAZING[ 1 ], LENGTH );
		roof.translate( 0, ( GLAZING[ 1 ] + ROOF ) / 2, 0 );
		painted.push( roof );

		// A shade proud of the panels either side, which is what makes the
		// window band read as glass set into a body rather than as paint.
		const glazing = box( WIDTH + 0.02, GLAZING[ 1 ] - GLAZING[ 0 ], LENGTH + 0.02 );
		glazing.translate( 0, ( GLAZING[ 0 ] + GLAZING[ 1 ] ) / 2, 0 );

		const tyres = [];

		for ( const sx of [ - 1, 1 ] ) {

			for ( const sz of [ - 1, 1 ] ) {

				const wheel = tube( WHEEL_RADIUS, WHEEL_WIDTH, 12 );
				wheel.rotateZ( Math.PI / 2 );
				wheel.translate(
					sx * ( WIDTH / 2 - WHEEL_WIDTH / 2 ),
					WHEEL_RADIUS,
					sz * WHEELBASE / 2 - AXLE_OFFSET
				);
				tyres.push( wheel );

			}

		}

		this.meshes = [
			instanced( merge( painted ), factory.build( BODY_KEY ), capacity, 'bus:body' ),
			instanced( glazing, factory.build( GLASS_KEY ), capacity, 'bus:glass' ),
			instanced( merge( tyres ), factory.build( TYRE_KEY ), capacity, 'bus:tyres' )
		];

		this.group = new THREE.Group();
		this.group.name = 'buses';
		this.group.add( ...this.meshes );

	}

	setInstance( slot, matrix ) {

		for ( const mesh of this.meshes ) mesh.setMatrixAt( slot, matrix );

	}

	commit( count ) {

		for ( const mesh of this.meshes ) {

			mesh.count = count;
			mesh.visible = count > 0;
			mesh.instanceMatrix.needsUpdate = true;

		}

	}

}

function instanced( geometry, material, capacity, name ) {

	const mesh = new THREE.InstancedMesh( geometry, material, capacity );
	mesh.name = name;
	mesh.count = 0;
	mesh.visible = false;
	mesh.castShadow = true;
	mesh.frustumCulled = false;
	mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );

	return mesh;

}
