import * as THREE from 'three/webgpu';
import { box, tube, merge } from './Shapes.js';

const BODY_KEY = 'cyberpunk/metal/mid';
const GLASS_KEY = 'cyberpunk/glass/mid';
const UNDERCARRIAGE_KEY = 'cyberpunk/rubber/mid';

const DIMENSIONS = {
	train: { length: 44, width: 3.05, floor: 0.65, belt: 2.35, roof: 3.8, cars: 2 },
	subway: { length: 38, width: 2.85, floor: 0.5, belt: 2.05, roof: 3.25, cars: 2 }
};

/** A compact two-car rail silhouette, instanced once per active service. */
export class RailModel {

	constructor( factory, capacity, kind ) {

		const dimensions = DIMENSIONS[ kind ];
		const gap = 0.35;
		const carLength = ( dimensions.length - gap * ( dimensions.cars - 1 ) ) / dimensions.cars;
		const bodies = [];
		const glazing = [];
		const runningGear = [];

		for ( let car = 0; car < dimensions.cars; car ++ ) {

			const center = ( car - ( dimensions.cars - 1 ) / 2 ) * ( carLength + gap );
			const lower = box( dimensions.width, dimensions.belt - dimensions.floor, carLength );
			lower.translate( 0, ( dimensions.floor + dimensions.belt ) / 2, center );
			bodies.push( lower );

			const cap = box( dimensions.width - 0.14, dimensions.roof - dimensions.belt - 0.72, carLength - 0.12 );
			cap.translate( 0, ( dimensions.roof + dimensions.belt + 0.72 ) / 2, center );
			bodies.push( cap );

			const windows = box( dimensions.width + 0.02, 0.72, carLength - 0.2 );
			windows.translate( 0, dimensions.belt + 0.36, center );
			glazing.push( windows );

			for ( const offset of [ -carLength * 0.29, carLength * 0.29 ] ) {

				const bogie = box( dimensions.width - 0.45, 0.34, 2.2 );
				bogie.translate( 0, 0.32, center + offset );
				runningGear.push( bogie );

				for ( const side of [ -1, 1 ] ) {

					const wheel = tube( 0.36, 0.22, 10 );
					wheel.rotateZ( Math.PI / 2 );
					wheel.translate( side * ( dimensions.width / 2 - 0.11 ), 0.36, center + offset );
					runningGear.push( wheel );

				}

			}

		}

		this.meshes = [
			instanced( merge( bodies ), factory.build( BODY_KEY ), capacity, `${kind}:body` ),
			instanced( merge( glazing ), factory.build( GLASS_KEY ), capacity, `${kind}:glass` ),
			instanced( merge( runningGear ), factory.build( UNDERCARRIAGE_KEY ), capacity, `${kind}:running-gear` )
		];

		this.group = new THREE.Group();
		this.group.name = `${kind}s`;
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
