import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../../city/Rng.js';
import { Parts, metreUvs } from './Geometry.js';
import { SurfaceVariation } from './SurfaceVariation.js';
import { placement, pick, seedOf } from './Placement.js';
import catalog from './catalog.json' with { type: 'json' };

/** Published posts and rails with infill contained by the same reserved envelope. */
export class AuthoredRails {
	constructor( atlas, models ) { Object.assign( this, { atlas, models } ); }
	build() {
		const modules = this.atlas.streets.construction?.modules;
		if ( ! modules ) return [];
		const definitions = new Map( modules.definitions.filter( definition => definition.parts.length && definition.parts.every( part => part.role === 'guardrail' ) ).map( definition => [ definition.id, definition ] ) );
		for ( const definition of definitions.values() ) for ( const style of [ 'open', 'braced', 'slatted' ] ) {
			const appearances = new Map();
			for ( const finish of catalog.finishes ) appearances.set( finish.id, SurfaceVariation.apply( rail( definition, style, role => this.models.material( role, finish ) ), finish ) );
			const geometries = appearances.values().next().value.map( part => {
				const geometry = new THREE.BufferGeometry(); geometry.setAttribute( 'position', part.geometry.attributes.position.clone() ); return geometry;
			} );
			const collider = mergeGeometries( geometries ); geometries.forEach( geometry => geometry.dispose() );
			this.models.add( { id: `rail:${definition.id}:${style}`, kind: 'guardrail', style }, appearances, collider );
		}
		const items = [];
		modules.placements.forEach( ( record, index ) => {
			if ( ! definitions.has( record.moduleId ) ) return;
			const rng = new Rng( seedOf( `${this.atlas.meta.seed}:rail:${record.blockId}:${index}` ) );
			const model = this.models.get( `rail:${record.moduleId}:${pick( [ 'open', 'braced', 'slatted' ], rng )}` );
			const c = [ 1, 0, - 1, 0 ][ record.turn ], s = [ 0, 1, 0, - 1 ][ record.turn ];
			for ( let i = 0; i < record.count; i ++ ) {
				const matrix = new THREE.Matrix4().set( c, 0, - s, record.origin[ 0 ] + c * i * record.step,
					0, 1, 0, 0, s, 0, c, record.origin[ 1 ] + s * i * record.step, 0, 0, 0, 1 );
				items.push( placement( model, matrix, { id: `rail:${index}:${i}`, arrangement: `rail:${index}`, finish: pick( catalog.finishes, rng ).id,
					color: pick( [ '#82908d', '#a3967d', '#6b7b7d', '#8b8582' ], rng ) } ) );
			}
		} );
		return items;
	}
}

function rail( definition, style, material ) {
	const p = new Parts(), bounds = new THREE.Box3();
	for ( const prism of definition.parts ) {
		const shape = new THREE.Shape( prism.polygon.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );
		const geometry = new THREE.ExtrudeGeometry( shape, { depth: prism.top - prism.bottom, bevelEnabled: false, steps: 1 } ).rotateX( - Math.PI / 2 ).translate( 0, prism.bottom, 0 );
		geometry.computeBoundingBox(); bounds.union( geometry.boundingBox ); p.add( 'paint', metreUvs( geometry ) );
	}
	const size = bounds.getSize( new THREE.Vector3() ), center = bounds.getCenter( new THREE.Vector3() );
	const width = size.x - 0.24, height = size.y * 0.35;
	if ( width > 0.4 && size.z > 0.02 ) {
		if ( style === 'braced' ) p.box( 'paint', [ Math.hypot( width, height ) - 0.07, 0.035, size.z * 0.7 ], [ center.x, bounds.max.y - height / 2 - 0.11, center.z ], [ 0, 0, Math.atan2( height, width ) ] );
		if ( style === 'slatted' ) for ( let i = 0; i < 5; i ++ ) {
			p.box( 'paint', [ width / 9, size.y * ( i % 2 ? 0.45 : 0.63 ), size.z * 0.5 ], [ center.x + ( i - 2 ) * width / 5, center.y + 0.04, center.z ] );
		}
	}
	return p.finish( material );
}
