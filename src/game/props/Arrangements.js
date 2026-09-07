import * as THREE from 'three/webgpu';
import layout from './arrangements.json' with { type: 'json' };
import { rectangle } from './Footprints.js';

const TRUNK = new THREE.Box3( new THREE.Vector3( - 0.18, 0, - 0.18 ), new THREE.Vector3( 0.18, 2.7, 0.18 ) );

/** Chooses a compact recipe, grounds its model bounds, and fits its rear edge to a wall. */
export class Arrangements {
	constructor( models ) { this.models = models; }
	at( site, rng ) {
		if ( site.kind !== 'tree' && rng.next() > layout.chance[ site.kind ] ) return [];
		const recipes = layout.recipes.filter( recipe => recipe.sites.includes( site.kind ) );
		const recipe = site.kind === 'tree' ? { id: 'planting', slots: [ { models: [ 'pine', 'maple' ], at: [ 0, 0 ], turn: rng.range( 0, Math.PI * 2 ) } ] } : pick( recipes, rng );
		const locals = recipe.slots.map( ( slot ) => {
			const model = this.models.get( pick( slot.models, rng ) );
			return { model, slot };
		} );
		for ( const local of locals ) {
			const support = local.slot.on !== undefined ? locals[ local.slot.on ] : null;
			local.lift = support ? support.lift + support.model.bounds.max.y - support.model.bounds.min.y : 0;
		}
		const prepared = locals.map( ( { model, slot, lift } ) => {
			const matrix = new THREE.Matrix4().makeRotationY( slot.turn ?? 0 );
			matrix.setPosition( slot.at[ 0 ], lift - model.bounds.min.y, slot.at[ 1 ] );
			return { model, matrix, color: pick( model.tints ?? [ '#ffffff', '#d8c8b3' ], rng ) };
		} );
		const rear = Math.min( ...prepared.flatMap( item => footprint( item.model.bounds, item.matrix ).map( p => p[ 1 ] ) ) );
		const turn = new THREE.Matrix4().makeRotationY( Math.atan2( site.nx, site.nz ) );
		turn.setPosition( site.x + site.nx * ( site.kind === 'tree' ? 0 : 0.14 - rear ), 0, site.z + site.nz * ( site.kind === 'tree' ? 0 : 0.14 - rear ) );
		return prepared.map( ( { model, matrix, color }, i ) => {
			matrix.premultiply( turn );
			const tree = model.kind === 'tree';
			const ring = footprint( tree ? model.bounds.clone().union( TRUNK ) : model.bounds, matrix );
			const support = tree ? footprint( TRUNK, matrix ) : ring;
			const lowFootprint = footprint( tree ? model.lowBounds.clone().union( TRUNK ) : model.lowBounds, matrix );
			return { id: `${site.id}:${i}`, arrangement: `${site.id}:${recipe.id}`, model: model.id, kind: model.kind, matrix, color, footprint: ring, lowFootprint, support, bottom: matrix.elements[ 13 ] + model.bounds.min.y, top: matrix.elements[ 13 ] + model.bounds.max.y };
		} );
	}
}

function pick( values, rng ) { return values[ Math.floor( rng.next() * values.length ) ]; }
function footprint( box, matrix ) {
	return rectangle( box.min.x, box.min.z, box.max.x, box.max.z ).map( ( [ x, z ] ) => { const p = new THREE.Vector3( x, 0, z ).applyMatrix4( matrix ); return [ p.x, p.z ]; } );
}
