import * as THREE from 'three/webgpu';
import { PropModels } from '../PropModels.js';
import { Dressing } from '../Dressing.js';
import world from './review-world.json' with { type: 'json' };

export class ReviewScene {
	constructor( factory ) { this.factory = factory; }
	async build( mode ) {
		const group = new THREE.Group();
		let content, summary;
		if ( mode === 'arrangements' ) {
			content = await new Dressing( world, { edges: [] }, this.factory ).build();
			group.add( content.group );
			const wall = new THREE.Mesh( new THREE.BoxGeometry( 60, 4, 40 ), this.factory.build( 'cyberpunk/prop-coating/poor', 'worn' ) );
			wall.position.set( 50, 2.2, 40 ); wall.castShadow = wall.receiveShadow = true; group.add( wall );
			summary = `${content.counts.total} objects in ${new Set( content.placements.map( p => p.arrangement ) ).size} pockets. Door apron stays clear.`;
		} else {
			content = await new PropModels( this.factory ).load();
			let x = 0, z = 0, row = 0;
			for ( const model of content.models.values() ) {
				if ( row === 4 ) { x = 0; z += 18; row = 0; }
				for ( const part of model.parts ) {
					const mesh = new THREE.InstancedMesh( part.geometry, part.material, 1 );
					mesh.setMatrixAt( 0, new THREE.Matrix4().makeTranslation( x, 0.2 - model.bounds.min.y, z ) );
					if ( part.tintable ) mesh.setColorAt( 0, new THREE.Color( model.tints?.[ 0 ] ?? '#ffffff' ) );
					mesh.computeBoundingSphere(); mesh.castShadow = mesh.receiveShadow = true; group.add( mesh );
				}
				x += Math.max( 4, model.size[ 0 ] + 2 ); row ++;
			}
			summary = `${content.models.size} models: folded cartons, crates, pallet, litter, bags, dumpster, two container sizes and two trees.`;
		}
		return { group, summary, dispose() {
			group.traverse( object => { if ( object.isInstancedMesh ) { if ( mode === 'gallery' ) object.dispose(); } else if ( object.isMesh ) object.geometry.dispose(); } );
			content.dispose(); group.clear();
		} };
	}
}
