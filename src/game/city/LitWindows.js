import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../../city/Rng.js';
import { openingRect } from './Openings.js';

const LIT_SHARE = 0.42;
const INSET = 0.16;
/** Brightness at the head of the pane and at the sill: a room, not a swatch. */
const TOP = 1;
const SILL = 0.5;

// Interior lighting seen from the street: warm domestic, cold office, and the
// occasional screen glow. Split by building type rather than picked at random.
const PALETTES = {
	residential: [ 0xffb765, 0xffd7a0, 0xff8f52, 0x7fc4ff ],
	hotel: [ 0xffc98a, 0xffab5e, 0xffe0b0 ],
	work: [ 0xbfe4ff, 0xd8f0ff, 0x8fd0ff, 0xfff0c8 ],
	venue: [ 0xff5fae, 0x38f0ff, 0xffb03a, 0xa060ff ]
};

const TYPE_PALETTE = {
	residential: 'residential',
	hotel: 'hotel',
	restaurant: 'venue',
	coffee_shop: 'venue',
	commerce: 'venue',
	mall: 'venue'
};

/**
 * Lit windows. The exterior shell cuts real window openings but nothing puts
 * light behind them, so at night a tower reads as a black slab. This hangs a
 * small emissive pane just inside a deterministic share of each building's
 * window openings, coloured by what the building is.
 *
 * Colour, per-window brightness and the fall-off from head to sill are baked
 * into vertex colours, so the whole skyline lights up in one draw call and no
 * window reads as a flat card of one colour.
 */
export class LitWindows {

	constructor( atlas, buildings ) {

		this.atlas = atlas;
		this.buildings = buildings;

	}

	build() {

		const panes = [];

		for ( const parcel of this.atlas.parcels ) {

			const building = this.buildings.get( parcel.id );

			if ( ! building ) continue;

			const palette = PALETTES[ TYPE_PALETTE[ parcel.type ] ?? 'work' ];
			const rng = new Rng( hash( parcel.id ) );

			for ( const floor of building.blueprint.floors ) {

				if ( floor.elevation < 0 ) continue;

				for ( const opening of floor.openings ) {

					if ( opening.kind !== 'window' ) continue;
					if ( rng.next() > LIT_SHARE ) continue;

					const rect = openingRect( floor, opening );

					if ( ! rect ) continue;

					const color = new THREE.Color( palette[ Math.floor( rng.next() * palette.length ) ] );

					panes.push( pane( rect, color.multiplyScalar( rng.range( 0.45, 1 ) ) ) );

				}

			}

		}

		const group = new THREE.Group();
		group.name = 'lit-windows';

		if ( panes.length ) {

			const mesh = new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( panes, false ),
				new THREE.MeshBasicMaterial( { vertexColors: true, side: THREE.DoubleSide, fog: true } )
			);
			mesh.name = 'lit-windows:panes';
			group.add( mesh );

		}

		return group;

	}

}

/** A flat pane filling the opening, set back inside the wall, lit head to sill. */
function pane( rect, color ) {

	const positions = [];
	const colors = [];
	const dx = rect.end.x - rect.start.x;
	const dz = rect.end.z - rect.start.z;
	const ox = - rect.normal.x * INSET;
	const oz = - rect.normal.z * INSET;

	const corner = ( t, y ) => [
		rect.start.x + dx * t + ox,
		y,
		rect.start.z + dz * t + oz
	];

	const a = corner( 0, rect.y0 );
	const b = corner( 1, rect.y0 );
	const c = corner( 1, rect.y1 );
	const d = corner( 0, rect.y1 );

	positions.push( ...a, ...b, ...c, ...a, ...c, ...d );

	for ( const level of [ SILL, SILL, TOP, SILL, TOP, TOP ] ) {

		colors.push( color.r * level, color.g * level, color.b * level );

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );

	return geometry;

}

function hash( text ) {

	let h = 2166136261;

	for ( let i = 0; i < text.length; i ++ ) h = Math.imul( h ^ text.charCodeAt( i ), 16777619 );

	return h >>> 0;

}
