import { BufferAttribute, BufferGeometry } from 'three/webgpu';
import { refineSurface } from './BodySurface.js';
import { BodyShapes, bodyOf } from './BodyShape.js';
import { fitOutfit } from './Wardrobe.js';
import { stepped } from './Steps.js';
import { DEFAULT_SHAPE, SLOTS } from './Recipe.js';

/** People whose fitted bodies stay built after nobody wears them. */
const CAPACITY = 8;
const SURFACE_KEYS = Object.keys( DEFAULT_SHAPE ).filter( ( key ) => key !== 'height' );

/**
 * What a recipe's geometry depends on: its body, the shape of its surface and
 * the garments it wears. Height is the rig's, hair is attached, colours are
 * uniforms, so none of them builds anything.
 */
export function fitKey( recipe ) {

	return JSON.stringify( [ recipe.body, SURFACE_KEYS.map( ( key ) => recipe.shape[ key ] ), SLOTS.map( ( slot ) => recipe.outfit[ slot ] ) ] );

}

/**
 * Builds people. A body is prepared once for the run: its seat surface
 * refined and its shape controls measured. A person is fitted once while they
 * are wanted: their shaped body with what their garments cover hidden, their
 * face's eyes and brows, and a skinned shell per garment. Fits are cached by
 * `fitKey` and counted out: `fit` hands one out and `release` takes it back,
 * and the least recently used of those nobody holds are disposed past the
 * capacity. All of it runs in steps under the frame budget `slice`.
 */
export class Tailor {

	constructor( { capacity = CAPACITY, slice = null } = {} ) {

		this.capacity = capacity;
		this.slice = slice;
		this.fits = new Map();
		this.pending = new Map();
		/** Fits built and how long the longest took, in milliseconds of wall time. */
		this.built = 0;
		this.slowest = 0;

	}

	/** Refines the body model's surface and measures its shapes, once. */
	prepare( model ) {

		model.tailoring ??= stepped( prepareBody( model.scene ), this.slice );
		return model.tailoring;

	}

	/**
	 * The fitted body of a recipe on a prepared body model, counted as held
	 * until `release`.
	 */
	async fit( model, recipe ) {

		const key = `${model.descriptor?.id ?? ''}|${fitKey( recipe )}`;
		let fit = this.fits.get( key );
		if ( fit ) {

			// Most recently used last.
			this.fits.delete( key );
			this.fits.set( key, fit );

		} else {

			if ( ! this.pending.has( key ) ) {

				this.pending.set( key, this.#build( model, recipe, key ).finally( () => this.pending.delete( key ) ) );

			}
			fit = await this.pending.get( key );

		}
		fit.users ++;
		this.#evict();
		return fit;

	}

	/** Hands a fit back; it stays built until the cache needs its place. */
	release( fit ) {

		if ( ! fit || fit.users <= 0 ) return;
		fit.users --;
		this.#evict();

	}

	/** Every fit nobody holds, disposed. */
	clear() {

		for ( const [ key, fit ] of this.fits ) {

			if ( fit.users > 0 ) continue;
			this.fits.delete( key );
			dispose( fit );

		}

	}

	async #build( model, recipe, key ) {

		const started = performance.now();
		const shapes = await this.prepare( model );
		const fit = await stepped( tailor( shapes, recipe, key ), this.slice );
		fit.ms = performance.now() - started;
		this.built ++;
		this.slowest = Math.max( this.slowest, fit.ms );
		this.fits.set( key, fit );
		return fit;

	}

	#evict() {

		for ( const [ key, fit ] of this.fits ) {

			if ( this.fits.size <= this.capacity ) return;
			if ( fit.users > 0 ) continue;
			this.fits.delete( key );
			dispose( fit );

		}

	}

}

function* prepareBody( scene ) {

	const body = bodyOf( scene );
	const refined = yield* refineSurface( body );
	if ( refined !== body.geometry ) {

		body.geometry.dispose();
		body.geometry = refined;

	}
	return yield* BodyShapes.measure( scene );

}

function* tailor( shapes, recipe, key ) {

	const shaped = yield* shapes.shaping( recipe.shape );
	yield;
	const source = shapes.body.geometry;
	const body = new BufferGeometry();
	body.name = 'fitted-body';
	body.setAttribute( 'position', new BufferAttribute( shaped.position, 3 ) );
	body.setAttribute( 'normal', new BufferAttribute( shaped.normal, 3 ) );
	for ( const name of [ 'uv', 'skinIndex', 'skinWeight' ] ) body.setAttribute( name, source.getAttribute( name ).clone() );
	body.setIndex( new BufferAttribute( shapes.index, 1 ) );
	for ( const group of source.groups ) body.addGroup( group.start, group.count, group.materialIndex );
	const outfit = yield* fitOutfit( body, shapes.body.skeleton.bones.map( ( bone ) => bone.name ), recipe.outfit );
	body.setIndex( new BufferAttribute( outfit.index, 1 ) );
	body.clearGroups();
	for ( const group of outfit.groups ) body.addGroup( group.start, group.count, group.materialIndex );
	body.computeBoundingBox();
	body.computeBoundingSphere();
	const auxiliaries = new Map();
	for ( const auxiliary of shapes.auxiliaries ) {

		const geometry = auxiliary.mesh.geometry.clone();
		const { position, normal } = shaped.auxiliaries.get( auxiliary.name );
		geometry.setAttribute( 'position', new BufferAttribute( position, 3 ) );
		if ( normal ) geometry.setAttribute( 'normal', new BufferAttribute( normal, 3 ) );
		geometry.computeBoundingSphere();
		auxiliaries.set( auxiliary.name, geometry );

	}
	return { key, body, auxiliaries, garments: outfit.garments, hidden: outfit.hidden, users: 0, ms: 0 };

}

function dispose( fit ) {

	fit.body.dispose();
	for ( const geometry of fit.auxiliaries.values() ) geometry.dispose();
	for ( const garment of fit.garments ) garment.geometry.dispose();
	fit.disposed = true;

}
