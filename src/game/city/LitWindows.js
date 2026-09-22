import * as THREE from 'three/webgpu';
import { attribute, texture, vec3 } from 'three/tsl';
import { Rng } from '../../city/Rng.js';
import { nightLevel } from '../light/NightSwitch.js';
import { openingRect } from './Openings.js';
import { windowBay, appendBay } from './WindowBay.js';
import { ExteriorScenery } from './ExteriorScenery.js';
import roomBindings from '../../../../materials/bindings/window-room-surfaces.json';

const LIT_SHARE = 0.42;
const WHITE = new THREE.Color( 0xffffff );

/** Fitted scenic upper rooms; furnished buildings show them only from outside. */
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
		const fixtures = new Map();
		const surfaces = new Map();
		const surfaceFor = ( role, binding, back, lit, owner, exterior ) => {

			const { kind, variant: id } = lit ? ( role === 'back' ? back : binding[ role ] ) : binding.left;
			const bucket = `${kind}:${id}:${owner}`;
			if ( ! surfaces.has( bucket ) ) {

				const [ w, h ] = this.factory.resolver.resolve( `cyberpunk/${kind}/mid` )?.aspect ?? [ 1, 1 ];
				surfaces.set( bucket, { kind, id, exterior, aspect: w / h, data: { position: [], color: [], uv: [] } } );

			}
			const surface = surfaces.get( bucket );
			return { data: surface.data, aspect: surface.aspect, color: WHITE };

		};

		for ( const parcel of this.atlas.parcels ) {

			const building = this.buildings.get( parcel.id );
			if ( ! building ) continue;
			const exterior = building.hasInterior !== false ? new ExteriorScenery( building.blueprint ) : null;
			const owner = exterior ? parcel.id : '';
			if ( ! fixtures.has( owner ) ) fixtures.set( owner, { exterior, data: { position: [], color: [], uv: [] } } );
			const domestic = [ 'residential', 'hotel' ].includes( parcel.type );
			const variant = domestic ? 'apartment' : [ 'offices', 'corpo' ].includes( parcel.type ) ? 'office' : 'lobby';
			const binding = roomBindings.rooms[ variant ];
			for ( const floor of building.blueprint.floors ) {

				if ( floor.elevation <= 0 ) continue;
				const occupied = [];
				for ( const opening of floor.openings ) {

					if ( opening.kind !== 'window' || opening.scenery ) continue;
					if ( opening.material && this.factory.resolver.resolve( opening.material )?.physical?.transmission === 0 ) continue;
					const rect = openingRect( floor, opening.glazing ? { ...opening, ...opening.glazing } : opening );
					if ( ! rect ) continue;
					rect.housingBackDepth = opening.glazing?.housingBackDepth;
					rect.glassDepth = opening.glazing?.glassDepth;
					const seed = `${this.atlas.meta?.seed ?? ''}:${parcel.id}:${floor.elevation}:${opening.id ?? `${opening.edge}:${opening.offset}`}`;
					const rng = new Rng( hash( seed ) );
					const bay = windowBay( floor, rect, building.blueprint.facade?.wallDepth ?? 0.5, occupied );
					if ( ! bay ) continue;
					occupied.push( bay.footprint );
					const lit = rng.next() < LIT_SHARE;
					const color = new THREE.Color( domestic ? 0xffd7b0 : 0xe4edff );
					const level = lit ? rng.range( 8, 16 ) : 0;
					const back = binding.backPool[ Math.floor( rng.next() * binding.backPool.length ) ];
					appendBay( bay, ( role ) => surfaceFor( role, binding, back, lit, owner, exterior ), fixtures.get( owner ).data, color, level, lit );

				}

			}

		}

		for ( const { kind, id, data, exterior } of surfaces.values() ) {

			// Exact role variants are independent of the quality tier's pattern budget.
			const material = this.factory.build( `cyberpunk/${kind}/mid`, id );
			const room = mesh( `${kind}:${id}`, data, material );
			if ( exterior ) exterior.attach( room.material );
			this.group.add( room );

		}
		for ( const { data, exterior } of fixtures.values() ) if ( data.position.length ) {

			const lamps = mesh( 'fixtures', data );
			if ( exterior ) exterior.attach( lamps.material );
			this.group.add( lamps );

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

function mesh( name, data, catalog = null ) {

	const geometry = new THREE.BufferGeometry();
	for ( const [ name, size ] of [ [ 'position', 3 ], [ 'color', 3 ], [ 'uv', 2 ] ] ) {

		geometry.setAttribute( name, new THREE.Float32BufferAttribute( data[ name ], size ) );

	}
	geometry.computeBoundingSphere();
	const material = new THREE.MeshBasicNodeMaterial( { side: THREE.DoubleSide, fog: true } );
	material.colorNode = vec3( 0 );
	const tint = attribute( 'color', 'vec3' ).mul( nightLevel );
	const fallback = catalog?.color ?? new THREE.Color( catalog ? 0xff00ff : 0xffffff );
	const surface = catalog?.map ? texture( catalog.map ).rgb : vec3( fallback.r, fallback.g, fallback.b );
	material.emissiveNode = tint.mul( surface );
	const result = new THREE.Mesh( geometry, material );
	result.name = `lit-windows:${name}`;
	return result;

}

function hash( text ) {

	let h = 2166136261;
	for ( let i = 0; i < text.length; i ++ ) h = Math.imul( h ^ text.charCodeAt( i ), 16777619 );
	return h >>> 0;

}
