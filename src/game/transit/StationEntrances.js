import * as THREE from 'three/webgpu';
import { box, merge, solid } from './Shapes.js';
import { StationAccess } from './StationAccess.js';
import { kelvinColor } from '../light/Color.js';
import layout from './station-layout.json' with { type: 'json' };

/** Closed short stair wells with a destination machine on each lower landing. */
export class StationEntrances {
	constructor( atlas, factory ) { Object.assign( this, { atlas, factory } ); }
	build() {
		const group = new THREE.Group(); group.name = 'station-entrances';
		const parts = new Map(), collision = [], glows = [];
		const entrances = new StationAccess( this.atlas ).entrances;
		for ( const entry of entrances ) {
			const add = ( role, size, position, angle = 0, physical = true ) => {
				const geometry = box( ...size ); geometry.rotateX( angle ); geometry.translate( ...position ); geometry.rotateY( entry.heading ); geometry.translate( entry.origin[ 0 ], 0, entry.origin[ 1 ] );
				if ( ! parts.has( role ) ) parts.set( role, [] ); parts.get( role ).push( geometry );
				if ( physical ) collision.push( geometry );
			};
			const { floor, top, bounds, treads } = entry;
			let cx = 0, end = 0;
			if ( bounds ) {
				const [ left, right, back, front ] = bounds, w = layout.wall, width = right - left - 2 * w;
				cx = ( left + right ) / 2; end = front - w;
				add( 'concrete', [ right - left, 0.18, front - back ], [ cx, floor - 0.09, ( front + back ) / 2 ] );
				add( 'concrete', [ width, top - floor, layout.deck - back ], [ cx, ( floor + top ) / 2, ( layout.deck + back ) / 2 ] );
				for ( let i = 0; i < treads; i ++ ) {
					const y = top - ( i + 1 ) * layout.rise;
					add( 'concrete', [ width, y - floor + 0.18, layout.going ], [ cx, ( y + floor - 0.18 ) / 2, layout.deck + ( i + 0.5 ) * layout.going ] );
					add( 'edge', [ width, 0.006, 0.035 ], [ cx, y + 0.003, layout.deck + i * layout.going + 0.025 ], 0, false );
				}
				for ( const x of [ left + w / 2, right - w / 2 ] ) {
					add( 'concrete', [ w, top - floor + 0.18, front - back ], [ x, ( top + floor - 0.18 ) / 2, ( front + back ) / 2 ] );
					for ( const [ from, to ] of [ [ back, - 0.8 ], [ layout.deck, front ] ] ) if ( to > from ) add( 'concrete', [ w, layout.parapet, to - from ], [ x, top + layout.parapet / 2, ( from + to ) / 2 ] );
					const run = treads * layout.going, drop = top - floor;
					add( 'metal', [ 0.04, 0.04, Math.hypot( run, drop ) ], [ x + ( x < cx ? 0.12 : - 0.12 ), ( top + floor ) / 2 + 0.83, layout.deck + run / 2 ], Math.atan2( drop, run ) );
				}
				for ( const z of [ back + w / 2, front - w / 2 ] ) add( 'concrete', [ width, top + layout.parapet - floor, w ], [ cx, ( top + layout.parapet + floor ) / 2, z ] );
				add( 'sign', [ Math.min( width, 1.7 ), 0.24, 0.07 ], [ cx, top + 1.12, back + w ], 0, false );
			}
			const machineZ = end - layout.machine.depth / 2;
			add( 'paint', [ layout.machine.width, layout.machine.height, layout.machine.depth ], [ cx, floor + layout.machine.height / 2, machineZ ] );
			add( 'metal', [ 0.66, 0.07, 0.36 ], [ cx, floor + 0.035, machineZ ] );
			add( 'rubber', [ 0.49, 0.58, 0.015 ], [ cx, floor + 1.06, machineZ - 0.148 ] );
			add( 'screen', [ 0.41, 0.47, 0.008 ], [ cx, floor + 1.06, machineZ - 0.16 ], 0, false );
			for ( let row = 0; row < 3; row ++ ) add( 'text', [ 0.29 - row % 2 * 0.06, 0.016, 0.006 ], [ cx - 0.015, floor + 1.2 - row * 0.13, machineZ - 0.169 ], 0, false );
			add( 'rubber', [ 0.2, 0.018, 0.012 ], [ cx + 0.09, floor + 0.6, machineZ - 0.148 ] );
			add( 'edge', [ 0.22, 0.032, 0.004 ], [ cx - 0.06, floor + 0.34, machineZ - 0.144 ], 0, false );
			glows.push( { position: new THREE.Vector3( ...entry.point( cx, floor + 1.85, machineZ - 0.6 ) ), color: kelvinColor( 4200 ), lumens: 700, range: 7 } );
		}
		for ( const [ role, geometries ] of parts ) {
			const material = surface( this.factory, role );
			const mesh = new THREE.Mesh( merge( geometries ), material ); mesh.name = `entrance:${role}`; mesh.castShadow = mesh.receiveShadow = true; group.add( mesh );
		}
		const collider = solid( collision );
		for ( const geometries of parts.values() ) geometries.forEach( geometry => geometry.dispose() );
		return { group, glows, collider, entrances };
	}
}

function surface( factory, role ) {
	const key = { concrete: 'cyberpunk/concrete/poor', metal: 'cyberpunk/metal/poor', paint: 'cyberpunk/prop-coating/poor', rubber: 'cyberpunk/rubber/poor', edge: 'cyberpunk/prop-coating/poor', sign: 'cyberpunk/signage/rich', screen: 'cyberpunk/prop-coating/poor', text: 'cyberpunk/prop-coating/poor' }[ role ];
	if ( [ 'screen', 'text' ].includes( role ) ) return factory.variant( key, { emissive: new THREE.Color( role === 'screen' ? '#174e50' : '#94bda5' ), emissiveLevel: role === 'screen' ? 0.7 : 3 } );
	if ( role === 'sign' ) return factory.variant( key, { variantId: '1', emissive: kelvinColor( 4000 ), emissiveScale: 8 } );
	if ( role === 'edge' ) return factory.build( 'cyberpunk/metal/poor', 'zinc' );
	return factory.build( key );
}
