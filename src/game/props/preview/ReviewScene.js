import * as THREE from 'three/webgpu';
import { PropModels } from '../PropModels.js';
import { Dressing } from '../Dressing.js';
import { AuthoredRails } from '../AuthoredRails.js';
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
			new AuthoredRails( world, content ).build();
			let x = 0, z = 0, row = 0;
			const compact = mode !== 'gallery';
			const models = [ ...content.models.values() ].filter( model => ( mode === 'plastic' || mode === 'finishes' ) ? model.shape === 'polymer' : mode === 'ornaments' ? model.kind === 'ornament' : mode === 'rails' ? model.kind === 'guardrail' : true );
			for ( const model of models ) {
				for ( const [ finish, parts ] of mode === 'finishes' ? model.appearances : [ model.appearances.entries().next().value ] ) {
				if ( row === ( mode === 'finishes' ? 3 : 4 ) ) { x = 0; z += compact ? 1.5 : 18; row = 0; }
				for ( const part of parts ) {
					const mesh = new THREE.InstancedMesh( part.geometry, part.material, 1 );
					mesh.name = `${model.id}:${finish}`;
					mesh.setMatrixAt( 0, new THREE.Matrix4().makeTranslation( x, 0.2 - model.bounds.min.y, z ) );
					if ( part.tintable ) mesh.setColorAt( 0, new THREE.Color( model.tints?.[ 0 ] ?? '#ffffff' ) );
					mesh.computeBoundingSphere(); mesh.castShadow = mesh.receiveShadow = true; group.add( mesh );
				}
				x += compact ? model.size[ 0 ] + 0.3 : Math.max( 4, model.size[ 0 ] + 2 ); row ++;
				}
			}
			summary = mode === 'finishes' ? 'Each row: worn, weathered and salvaged. Grain offsets, asymmetric grime and fitted abrasion vary independently.' : mode === 'rails' ? 'Open, braced and slatted guardrails retain the published post and rail envelope.' : mode === 'ornaments' ? 'Relay cabinet, pump housing, repaired bench and memorial fixture.' : mode === 'plastic' ? 'Ribbed tote, sealed transit case, crushed bin and loose-lid case.' : `${models.length} models: plastic cases, cartons, crates, ornaments, rails, containers and trees.`;
		}
		return { group, summary, dispose() {
			group.traverse( object => { if ( object.isInstancedMesh ) { if ( mode !== 'arrangements' ) object.dispose(); } else if ( object.isMesh ) object.geometry.dispose(); } );
			content.dispose(); group.clear();
		} };
	}
}
