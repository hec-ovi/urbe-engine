import { Color, DynamicDrawUsage, Group, InstancedMesh } from 'three/webgpu';
import { FrameBudget } from '../../app/FrameBudget.js';

/**
 * One visible batch per model, finish and material part, across all nearby cells.
 *
 * A model and finish wears the same geometry and the same materials wherever it
 * stands, so its programs link once for the city. Its batch does not: the
 * renderer builds an instanced draw's graph for that object, against its own
 * buffers, and the shader holds the buffer's length, so every batch made, the
 * first for a model and finish or one rebuilt to hold more copies, is prepared
 * before it replaces the one drawing, which draws on until then. A batch whose
 * model leaves the window is emptied and kept out of the scene, not let go, so
 * a window that finds the model again draws it in the batch it already has.
 */
export class PropBatches {
	constructor( models, group ) { this.models = models; this.group = group; this.batches = new Map(); this.maxWorkMs = 0; }
	async sync( placements, prepare, wanted ) {
		const selected = new Map(), budget = new FrameBudget();
		for ( const item of placements ) {
			const key = `${item.model}:${item.finish}`;
			if ( ! selected.has( key ) ) selected.set( key, [] );
			selected.get( key ).push( item );
		}
		for ( const [ key, batch ] of this.batches ) if ( ! selected.has( key ) ) empty( batch );
		for ( const [ key, items ] of selected ) {
			if ( ! wanted() ) return;
			const previous = this.batches.get( key );
			const replacement = ! previous || previous.capacity < items.length;
			const batch = replacement ? this.#create( key, items ) : previous;
			if ( replacement ) write( batch, items );
			try {
				if ( prepare && replacement ) {
					await budget.step();
					if ( wanted() ) await prepare( batch.group, { wanted } );
					budget.restart();
				}
				if ( ! wanted() ) { if ( replacement ) release( batch ); return; }
				if ( ! replacement ) write( batch, items );
				else { if ( previous ) release( previous ); this.batches.set( key, batch ); }
				if ( batch.group.parent !== this.group ) this.group.add( batch.group );
			} catch ( error ) { if ( replacement ) release( batch ); throw error; }
			await budget.step(); this.maxWorkMs = Math.max( this.maxWorkMs, budget.max );
		}
	}
	#create( key, items ) {
		const capacity = Math.max( 16, 2 ** Math.ceil( Math.log2( items.length ) ) );
		const group = new Group(); group.name = `props:${key}`;
		const parts = this.models.get( items[ 0 ].model ).appearances.get( items[ 0 ].finish );
		parts.forEach( ( part, index ) => {
			const mesh = new InstancedMesh( part.geometry, part.material, capacity );
			mesh.name = `props:${key}:${index}`; mesh.castShadow = mesh.receiveShadow = true;
			mesh.instanceMatrix.setUsage( DynamicDrawUsage ); mesh.userData.tintable = part.tintable;
			group.add( mesh );
		} );
		return { group, capacity };
	}
	get count() { let count = 0; for ( const batch of this.batches.values() ) count += batch.count; return count; }
	get draws() { let count = 0; for ( const batch of this.batches.values() ) if ( batch.count ) count += batch.group.children.length; return count; }
	dispose() { for ( const batch of this.batches.values() ) release( batch ); this.batches.clear(); }
}

function write( batch, items ) {
	batch.count = items.length;
	const ids = items.map( item => item.id ), color = new Color();
	for ( const mesh of batch.group.children ) {
		mesh.count = items.length; mesh.userData.propIds = ids;
		items.forEach( ( item, index ) => { mesh.setMatrixAt( index, item.matrix ); if ( mesh.userData.tintable ) mesh.setColorAt( index, color.set( item.color ) ); } );
		mesh.instanceMatrix.needsUpdate = true;
		if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true;
		mesh.computeBoundingBox(); mesh.computeBoundingSphere();
	}
}
/** No copies and out of the scene, its meshes kept for the window that finds its model again. */
function empty( batch ) {
	batch.count = 0;
	for ( const mesh of batch.group.children ) { mesh.count = 0; mesh.userData.propIds = []; }
	batch.group.removeFromParent();
}
function release( batch ) { batch.group.removeFromParent(); for ( const mesh of batch.group.children ) mesh.dispose(); batch.group.clear(); }
