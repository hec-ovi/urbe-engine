import * as THREE from 'three/webgpu';
import { MarkingPlan } from './MarkingPlan.js';
import { fail } from './MarkingPath.js';

/** Catalog-painted lane and crossing geometry, separate from ground collision. */
export class GroundMarkings {

	constructor( atlas, road, factory, bindings, settings = {} ) {

		if ( bindings?.version !== 1 || [ 'white', 'accent' ].some( role => ! bindings.surfaces?.[ role ]?.kind || ! bindings.surfaces[ role ].variant ) ) fail( 'Invalid marking material bindings' );
		this.plan = new MarkingPlan( atlas, road, settings );
		this.factory = factory;
		this.bindings = bindings;

	}

	build() {

		const { primitives, omitted } = this.plan.build();
		const group = new THREE.Group();
		group.name = 'ground:markings';
		for ( const finish of [ 'white', 'accent' ] ) {

			const positions = [], normals = [], uvs = [], indices = [];
			for ( const primitive of primitives.filter( primitive => primitive.finish === finish ) ) {

				for ( const polygon of primitive.polygons ) {

					const base = positions.length / 3;
					const triangles = THREE.ShapeUtils.triangulateShape( polygon.map( ( [ x, , z ] ) => new THREE.Vector2( x, - z ) ), [] );
					if ( ! triangles.length ) continue;
					const [ a, b, c ] = triangles[ 0 ].map( i => new THREE.Vector3( ...polygon[ i ] ) );
					const normal = b.sub( a ).cross( c.sub( a ) ).normalize();
					const u = new THREE.Vector3( 1, 0, 0 ).addScaledVector( normal, - normal.x ).normalize();
					const v = normal.clone().cross( u );
					for ( const point of polygon ) {

						positions.push( point[ 0 ], point[ 1 ] + this.plan.settings.paintOffset, point[ 2 ] );
						normals.push( normal.x, normal.y, normal.z );
						uvs.push( point[ 0 ] * u.x + point[ 1 ] * u.y + point[ 2 ] * u.z, point[ 0 ] * v.x + point[ 1 ] * v.y + point[ 2 ] * v.z );

					}
					for ( const triangle of triangles ) indices.push( ...triangle.map( i => base + i ) );

				}

			}
			if ( ! indices.length ) continue;
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
			geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
			geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
			geometry.setIndex( indices );
			const binding = this.bindings.surfaces[ finish ];
			const mesh = new THREE.Mesh( geometry, this.factory.build( `cyberpunk/${binding.kind}/mid`, binding.variant ) );
			mesh.name = `ground:markings:${finish}`;
			mesh.receiveShadow = true;
			group.add( mesh );

		}
		return { group, primitives, omitted };

	}

}
