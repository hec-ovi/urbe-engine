import * as THREE from 'three/webgpu';
import { attribute, texture, vec3 } from 'three/tsl';
import { Rng } from '../../city/Rng.js';
import { nightLevel } from '../light/NightSwitch.js';
import { openingRect } from './Openings.js';
import { windowBay, appendBay } from './WindowBay.js';

const LIT_SHARE = 0.42;

/** Fitted scenic rooms behind closed shells, sharing two city-wide draws. */
export class LitWindows {

	constructor( atlas, buildings, factory ) {

		this.atlas = atlas;
		this.buildings = buildings;
		this.factory = factory;
		this.group = new THREE.Group();
		this.group.name = 'lit-windows';

	}

	build( { enabled = true } = {} ) {

		this.dispose();
		if ( ! enabled ) return this.group;
		const surfaces = { position: [], color: [], uv: [] };
		const fixtures = { position: [], color: [], uv: [] };

		for ( const parcel of this.atlas.parcels ) {

			const building = this.buildings.get( parcel.id );
			if ( building?.hasInterior !== false ) continue;
			const domestic = [ 'residential', 'hotel' ].includes( parcel.type );
			for ( const floor of building.blueprint.floors ) {

				if ( floor.elevation < 0 ) continue;
				const occupied = [];
				for ( const opening of floor.openings ) {

					if ( opening.kind !== 'window' ) continue;
					const rect = openingRect( floor, opening );
					if ( ! rect ) continue;
					const rng = new Rng( hash( `${this.atlas.meta?.seed ?? ''}:${parcel.id}:${floor.elevation}:${opening.id ?? `${opening.edge}:${opening.offset}`}` ) );
					const bay = windowBay( floor, rect, building.blueprint.facade?.wallDepth ?? 0.5, occupied );
					if ( ! bay ) continue;
					occupied.push( bay.footprint );
					const lit = rng.next() < LIT_SHARE;
					const color = new THREE.Color( domestic ? 0xffd7b0 : 0xe4edff );
					const level = lit ? rng.range( 8, 16 ) : 0.045;
					appendBay( bay, surfaces, fixtures, color, level, lit );

				}

			}

		}

		if ( surfaces.position.length ) {

			const map = this.factory.build( 'cyberpunk/plaster/mid', 'plain' ).map;
			this.group.add( mesh( 'rooms', surfaces, map ) );
			if ( fixtures.position.length ) this.group.add( mesh( 'fixtures', fixtures ) );

		}
		return this.group;

	}

	/** Owned geometry and materials only; catalog maps remain factory-owned. */
	dispose() {

		for ( const child of this.group.children ) {

			child.geometry.dispose();
			child.material.dispose();

		}
		this.group.clear();

	}

}

function mesh( name, data, map = null ) {

	const geometry = new THREE.BufferGeometry();
	for ( const [ name, size ] of [ [ 'position', 3 ], [ 'color', 3 ], [ 'uv', 2 ] ] ) {

		geometry.setAttribute( name, new THREE.Float32BufferAttribute( data[ name ], size ) );

	}
	geometry.computeBoundingSphere();
	const material = new THREE.MeshBasicNodeMaterial( { side: THREE.DoubleSide, fog: true } );
	material.colorNode = vec3( 0 );
	const tint = attribute( 'color', 'vec3' ).mul( nightLevel );
	material.emissiveNode = map ? tint.mul( texture( map ).rgb ) : tint;
	const result = new THREE.Mesh( geometry, material );
	result.name = `lit-windows:${name}`;
	return result;

}

function hash( text ) {

	let h = 2166136261;
	for ( let i = 0; i < text.length; i ++ ) h = Math.imul( h ^ text.charCodeAt( i ), 16777619 );
	return h >>> 0;

}
