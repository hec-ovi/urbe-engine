import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../../city/Rng.js';
import { PropModels } from './PropModels.js';
import { Sites } from './Sites.js';
import { Clearance } from './Clearance.js';
import { Arrangements } from './Arrangements.js';
import { AuthoredRails } from './AuthoredRails.js';
import { seedOf } from './Placement.js';

/** Public street-dressing entry. Whole arrangements are admitted before batching. */
export class Dressing {
	constructor( atlas, walk, factory, options = {} ) { Object.assign( this, { atlas, walk, factory, options } ); }
	async build() {
		const models = await new PropModels( this.factory, this.options.loadAsset ).load();
		try {
			const clearance = new Clearance( this.atlas, this.walk, this.options.obstacles ), arrange = new Arrangements( models );
			const placements = new AuthoredRails( this.atlas, models ).build();
			for ( const rail of placements ) clearance.block( rail.footprint, rail.bottom, rail.top, 0.12 );
			for ( const site of new Sites( this.atlas ).all() ) {
				const items = arrange.at( site, new Rng( seedOf( `${this.atlas.meta.seed}:${site.id}` ) ) );
				if ( ! items.length ) continue;
				const elevation = clearance.claim( items, site.kind === 'yard' );
				if ( elevation === null ) continue;
				for ( const item of items ) { item.matrix.elements[ 13 ] += elevation; item.bottom += elevation; item.top += elevation; placements.push( item ); }
			}
			return assemble( models, placements );
		} catch ( error ) { models.dispose(); throw error; }
	}
}

function assemble( models, placements ) {
	const group = new THREE.Group(); group.name = 'props';
	const batches = new Map(), counts = { total: placements.length, guardrail: 0 }, solids = [];
	for ( const spec of models.models.values() ) counts[ spec.kind ] = 0;
	for ( const item of placements ) {
		const model = models.get( item.model ), position = new THREE.Vector3().setFromMatrixPosition( item.matrix );
		counts[ item.kind ] ++;
		const key = `${item.model}:${item.finish}:${Math.floor( position.x / 64 )}:${Math.floor( position.z / 64 )}`;
		if ( ! batches.has( key ) ) batches.set( key, [] );
		batches.get( key ).push( item );
		if ( model.collider ) solids.push( model.collider.clone().applyMatrix4( item.matrix ) );
	}
	for ( const [ key, items ] of batches ) {
		const model = models.get( items[ 0 ].model );
		model.appearances.get( items[ 0 ].finish ).forEach( ( part, partIndex ) => {
			const mesh = new THREE.InstancedMesh( part.geometry, part.material, items.length );
			mesh.name = `props:${key}:${partIndex}`; mesh.castShadow = mesh.receiveShadow = true;
			items.forEach( ( item, i ) => { mesh.setMatrixAt( i, item.matrix ); if ( part.tintable ) mesh.setColorAt( i, new THREE.Color( item.color ) ); } );
			mesh.instanceMatrix.needsUpdate = true;
			if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true;
			mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add( mesh );
		} );
	}
	const colliders = new Map();
	if ( solids.length ) colliders.set( 'props', mergeGeometries( solids ) );
	solids.forEach( geometry => geometry.dispose() );
	let disposed = false;
	return { group, counts, placements, colliders, dispose() {
		if ( disposed ) return; disposed = true;
		group.traverse( object => { if ( object.isInstancedMesh ) object.dispose(); } ); group.clear();
		for ( const geometry of colliders.values() ) geometry.dispose(); colliders.clear(); models.dispose();
	} };
}
