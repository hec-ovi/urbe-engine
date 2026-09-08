import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { planDressing } from './DressingPlan.js';
import { PropStream } from './PropStream.js';

/** Public street-dressing entry. Whole arrangements are admitted before batching. */
export class Dressing {
	constructor( atlas, walk, factory, options = {} ) { Object.assign( this, { atlas, walk, factory, options } ); }
	async build() {
		const { models, placements, counts } = await planDressing( this.atlas, this.walk, this.factory, this.options );
		try { return assemble( models, placements, counts ); } catch ( error ) { models.dispose(); throw error; }
	}
	async stream( options = {} ) {
		PropStream.validate( options );
		return new PropStream( await planDressing( this.atlas, this.walk, this.factory, this.options ), options );
	}
}

function assemble( models, placements, counts ) {
	const group = new THREE.Group(); group.name = 'props';
	const batches = new Map(), solids = [];
	for ( const item of placements ) {
		const model = models.get( item.model ), position = new THREE.Vector3().setFromMatrixPosition( item.matrix );
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
