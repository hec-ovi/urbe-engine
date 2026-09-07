import * as THREE from 'three/webgpu';
import layout from './arrangements.json' with { type: 'json' };
import { footprint, placement, pick } from './Placement.js';

/** Asymmetric recipes remain deterministic and keep stacked items on their support. */
export class Arrangements {
	constructor( models ) { this.models = models; this.previous = new Map(); }
	at( site, rng ) {
		if ( site.kind !== 'tree' && rng.next() > layout.chance[ site.kind ] ) return [];
		const recipes = layout.recipes.filter( recipe => recipe.sites.includes( site.kind ) );
		const alternatives = recipes.filter( recipe => recipe.id !== this.previous.get( site.owner ) );
		const recipe = site.kind === 'tree' ? { id: 'planting', slots: [ { models: [ 'pine', 'maple' ], at: [ 0, 0 ], turn: rng.range( 0, Math.PI * 2 ), jitter: [ 0, 0 ], yaw: 0 } ] } : pick( alternatives.length ? alternatives : recipes, rng );
		this.previous.set( site.owner, recipe.id );
		const mirror = site.kind !== 'tree' && rng.next() < 0.5 ? - 1 : 1;
		const locals = [];
		for ( const slot of recipe.slots ) {
			const support = slot.on !== undefined ? locals[ slot.on ] : null;
			if ( ( slot.on !== undefined && ! support ) || rng.next() > ( slot.chance ?? 1 ) ) { locals.push( null ); continue; }
			const model = this.models.get( pick( slot.models, rng ) );
			const jitter = slot.jitter ?? layout.variation.jitter;
			const yaw = ( slot.turn ?? 0 ) + rng.range( - ( slot.yaw ?? layout.variation.yaw ), slot.yaw ?? layout.variation.yaw );
			const x = ( slot.at[ 0 ] + rng.range( - jitter[ 0 ], jitter[ 0 ] ) ) * mirror, z = slot.at[ 1 ] + rng.range( - jitter[ 1 ], jitter[ 1 ] );
			let matrix;
			if ( support ) matrix = stacked( model, support, x, z, yaw * mirror );
			else matrix = new THREE.Matrix4().makeRotationY( yaw * mirror ).setPosition( x, - model.bounds.min.y, z );
			if ( ! matrix ) { locals.push( null ); continue; }
			locals.push( { model, matrix, finish: pick( [ ...model.appearances.keys() ], rng ), color: pick( model.tints ?? [ '#ffffff', '#d8c8b3', '#aeb6af', '#bec2c4' ], rng ) } );
		}
		const prepared = locals.filter( Boolean );
		if ( ! prepared.length ) return [];
		const rear = Math.min( ...prepared.flatMap( item => footprint( item.model.bounds, item.matrix ).map( p => p[ 1 ] ) ) );
		const turn = new THREE.Matrix4().makeRotationY( Math.atan2( site.nx, site.nz ) );
		const setback = site.kind === 'tree' ? 0 : rng.range( 0.14, 0.32 ) - rear;
		turn.setPosition( site.x + site.nx * setback, 0, site.z + site.nz * setback );
		return prepared.map( ( { model, matrix, color, finish }, i ) => placement( model, matrix.premultiply( turn ), { id: `${site.id}:${i}`, arrangement: `${site.id}:${recipe.id}`, color, finish } ) );
	}
}

function stacked( model, support, x, z, yaw ) {
	for ( const amount of [ 1, 0.5, 0.2, 0 ] ) {
		const local = new THREE.Matrix4().makeRotationY( yaw * amount );
		local.setPosition( x * amount, support.model.bounds.max.y - model.bounds.min.y, z * amount );
		const fits = footprint( model.bounds, local ).every( ( [ px, pz ] ) => px >= support.model.bounds.min.x - 1e-6 && px <= support.model.bounds.max.x + 1e-6 && pz >= support.model.bounds.min.z - 1e-6 && pz <= support.model.bounds.max.z + 1e-6 );
		if ( fits ) return local.premultiply( support.matrix );
	}
	return null;
}
