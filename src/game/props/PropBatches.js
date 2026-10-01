import { Color, Group } from 'three/webgpu';
import { FrameBudget } from '../../app/FrameBudget.js';
import { MaterialBatches } from '../city/kit/MaterialBatches.js';

/** Copies admitted between two asks of the frame budget. */
const ADMIT_STRIDE = 64;

/**
 * The street props within the window, drawn one batch per material and vertex
 * layout for every model that wears it, the way the kit draws its buildings
 * ([MaterialBatches.js](../city/kit/MaterialBatches.js)).
 *
 * A model and finish is an entry of the batches: each part's geometry joins the
 * batch of the material it wears once, the first time the window holds that
 * model and finish, and every placement is a copy of the entry at its matrix,
 * its tint on the parts that take one and white on the others. So the draws
 * follow the props' materials, not the models standing, a copy is culled on
 * its own sphere, and a model the window leaves keeps its geometry in the
 * batches for the window that finds it again. Parts with a different vertex
 * layout under one material go to a batch of their own, so no attribute is
 * rewritten and every part draws exactly the values its model carries.
 *
 * A batch is prepared before it first draws: one a model brings is held out
 * of the scene while the `prepare` port builds it, and the batches grow under
 * the draws they have, so admitting more copies or more models builds nothing
 * again.
 */
export class PropBatches {

	constructor( models, group ) {

		this.models = models;
		this.group = group;
		this.materials = new MaterialBatches( 'props', { colored: true } );
		this.group.add( this.materials.group );
		/** model and finish entries the batches hold. */
		this.entries = new Set();
		/** Placement id to its handle in the batches. */
		this.standing = new Map();
		this.maxWorkMs = 0;

	}

	async sync( placements, prepare, wanted ) {

		const budget = new FrameBudget();
		const fresh = new Set();
		for ( const item of placements ) if ( ! this.entries.has( keyOf( item ) ) ) fresh.add( keyOf( item ) );
		if ( fresh.size ) {

			const before = new Set( this.materials.batches.values() );
			this.materials.add( [ ...fresh ].map( ( key ) => this.#entry( key ) ), { castShadow: true } );
			for ( const key of fresh ) this.entries.add( key );
			const born = [ ...this.materials.batches.values() ].filter( ( batch ) => ! before.has( batch ) );
			if ( born.length && prepare ) {

				// Held out of the scene while prepared, then drawn.
				const staging = new Group();
				staging.name = 'props:preparing';
				for ( const batch of born ) staging.add( batch.mesh );
				try {

					await budget.step();
					if ( wanted() ) await prepare( staging, { wanted } );
					budget.restart();

				} finally {

					for ( const batch of born ) this.materials.group.add( batch.mesh );

				}

			}

		}
		if ( ! wanted() ) return;

		const selected = new Set( placements.map( ( item ) => item.id ) );
		for ( const [ id, handle ] of this.standing ) {

			if ( selected.has( id ) ) continue;
			this.materials.release( handle );
			this.standing.delete( id );

		}
		this.materials.reserve( placements.filter( ( item ) => ! this.standing.has( item.id ) ).map( keyOf ) );
		let admitted = 0;
		for ( const item of placements ) {

			if ( this.standing.has( item.id ) ) continue;
			this.standing.set( item.id, this.materials.admit( keyOf( item ), item.matrix, _color.set( item.color ) ) );
			if ( ++ admitted % ADMIT_STRIDE === 0 ) {

				await budget.step();
				this.maxWorkMs = Math.max( this.maxWorkMs, budget.max );
				if ( ! wanted() ) return;

			}

		}
		this.maxWorkMs = Math.max( this.maxWorkMs, budget.max );

	}

	/** One model and finish as a batch entry: each part in the batch of its material and vertex layout. */
	#entry( key ) {

		const [ model, finish ] = key.split( '\u0000' );
		const parts = this.models.get( model ).appearances.get( finish );

		return {
			id: key,
			surfaces: parts.map( ( part ) => ( {
				bucket: `${part.material.uuid}|${layoutOf( part.geometry )}`,
				geometry: part.geometry,
				material: part.material,
				castShadow: true,
				tinted: Boolean( part.tintable )
			} ) )
		};

	}

	/** Placements standing. */
	get count() {

		return this.standing.size;

	}

	/** The batches with a copy standing: the draws a frame makes of them at most. */
	get draws() {

		let count = 0;
		for ( const batch of this.materials.batches.values() ) if ( batch.count ) count ++;
		return count;

	}

	dispose() {

		this.materials.dispose();
		this.entries.clear();
		this.standing.clear();

	}

}

const _color = new Color();

/** A model and finish, as one key. */
function keyOf( item ) {

	return `${item.model}\u0000${item.finish}`;

}

/** A geometry's vertex layout: indexed or not, and each attribute's name, size, type and normalization. */
function layoutOf( geometry ) {

	const attributes = Object.keys( geometry.attributes ).sort().map( ( name ) => {

		const attribute = geometry.getAttribute( name );
		const array = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
		return `${name}:${attribute.itemSize}:${array.constructor.name}:${attribute.normalized ? 'n' : ''}`;

	} );

	return `${geometry.getIndex() ? 'i' : ''}|${attributes.join( ',' )}`;

}
