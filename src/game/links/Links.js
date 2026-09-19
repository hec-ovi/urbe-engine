import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { cutPlanes } from './Apertures.js';
import { framesAlong } from './PathFrames.js';
import { glazedBridge, rectTube, roundTube } from './Sections.js';
import { sweep } from './Sweep.js';

// One material per kind of surface, never per link: an air duct is sheet
// metal, a skybridge and a service tunnel are the same cast concrete, a
// bridge's band is window glass, a wire is insulated cable. Four keys is four
// draw calls for every link in the city.
const KEYS = {
	'ac-tube': { shell: 'cyberpunk/metal/mid' },
	bridge: { shell: 'cyberpunk/concrete/mid', glass: 'cyberpunk/window-glass/mid' },
	tunnel: { shell: 'cyberpunk/concrete/mid' },
	wire: { shell: 'cyberpunk/rubber/mid' },
	'rooftop-span': { shell: 'cyberpunk/rubber/mid' }
};
/** A 10 cm cable read from metres away; more sides would be invisible. */
const WIRE_SIDES = 5;
/** Thin rooftop spans need a round silhouette in the closer roof view. */
export const ROOFTOP_WIRE_SIDES = 8;
/** Float slack on an end that lands exactly on the roof it was planned against. */
const ROOF_SLACK = 0.001;

/**
 * Every inter-building link the connections box published, as geometry and as
 * something to stand on: bridges as enclosed glazed crossings you walk
 * through, tunnels and AC tubes as closed boxes you walk through (and over, on
 * a tube), and the wires strung across the streets.
 *
 * Each link is swept from its own centerline and cross section, and its two
 * ends are sliced by the planes of the apertures it terminates on, so the end
 * face is the hole the facade was carved with rather than a square cut near it.
 *
 * The whole city merges by material, not by link: the skyline already spends
 * its submission budget on buildings, and a draw call per bridge would put
 * a hundred more on top of it for a few thousand triangles.
 */
export class Links {

	/**
	 * @param connections the connections document (`links` and `apertures`)
	 * @param factory PbrMaterialFactory
	 * @param hosts parcel id to roof elevation, for the buildings this world
	 *   stands. Omit it to draw every published link.
	 */
	constructor( connections, factory, rooftopSpans = { spans: [] }, { hosts = null } = {} ) {

		this.links = connections.links;
		this.rooftopSpans = rooftopSpans?.spans ?? [];
		this.planes = cutPlanes( connections.apertures );
		this.factory = factory;
		this.hosts = hosts;

	}

	/** @returns { group, colliderGeometry, triangles, drawCalls, unhosted } */
	build() {

		const byKey = new Map();
		const solid = [];
		let unhosted = 0;

		for ( const link of [ ...this.links, ...this.#rooftopLinks() ] ) {

			const keys = KEYS[ link.kind ];

			if ( ! keys ) continue;

			if ( ! this.#hosted( link ) ) {

				unhosted ++;
				continue;

			}

			for ( const [ role, geometry ] of this.#sweep( link ) ) {

				const key = keys[ role ];

				if ( ! byKey.has( key ) ) byKey.set( key, [] );

				byKey.get( key ).push( geometry );

				// The shell is one surface, so walking through a bridge and
				// walking over a tube are the same triangles, and the glazing
				// is the wall that stops you leaving through it. A link that is
				// walkable in neither sense is not solid at all: a wire is
				// something to look at.
				if ( link.walkable.inside || link.walkable.over ) solid.push( positionsOnly( geometry ) );

			}

		}

		const group = new THREE.Group();
		group.name = 'links';
		let triangles = 0;

		for ( const [ key, geometries ] of byKey ) {

			const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
			geometries.forEach( ( geometry ) => geometry.dispose() );
			triangles += merged.getAttribute( 'position' ).count / 3;

			const mesh = new THREE.Mesh( merged, this.#material( key ) );
			mesh.name = `links:${key}`;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );

		}

		return {
			group,
			colliderGeometry: solid.length ? BufferGeometryUtils.mergeGeometries( solid, false ) : null,
			triangles,
			drawCalls: byKey.size,
			unhosted
		};

	}

	/**
	 * Whether both ends of this link have a building to hang from.
	 *
	 * Connections plans a link against the massing a parcel was expected to
	 * carry. A lot that ends up merged away leaves nothing at that end, and a
	 * building that ends up shorter than the massing leaves the end above its
	 * roof; either way the link hangs in the air, so it is not drawn. A caller
	 * that does not say what stands gets every published link.
	 */
	#hosted( link ) {

		if ( ! this.hosts || ! link.a ) return true;

		for ( const [ end, at ] of [ [ link.a, 0 ], [ link.b, link.path.length - 1 ] ] ) {

			const roof = this.hosts.get( end.buildingId );

			if ( roof === undefined || link.path[ at ][ 1 ] > roof + ROOF_SLACK ) return false;

		}

		return true;

	}

	/**
	 * A link's geometry from its centerline and section, by material role. Both
	 * ends take the plane of their own aperture; a wire's anchor is a mounting
	 * footprint rather than a hole, but its plane is still the facade, so the
	 * cable meets the wall flush.
	 */
	#sweep( link ) {

		const { shape, width, height } = link.crossSection;
		const frames = framesAlong( link.path, link.kind === 'rooftop-span' ? {} : {
			first: this.planes.get( link.a.apertureId ),
			last: this.planes.get( link.b.apertureId )
		} );

		if ( shape !== 'rect' ) return sweep( frames, roundTube(
			width / 2,
			link.kind === 'rooftop-span' ? ROOFTOP_WIRE_SIDES : WIRE_SIDES
		) );

		// A bridge is a crossing people walk through, so it is glazed; a duct
		// and a tunnel are bare tubes.
		return sweep( frames, link.kind === 'bridge'
			? glazedBridge( width, height )
			: rectTube( width, height ) );

	}

	#rooftopLinks() {

		return this.rooftopSpans.map( ( span ) => ( {
			kind: 'rooftop-span',
			path: span.path,
			crossSection: { shape: 'circle', width: span.thickness, height: span.thickness },
			walkable: { inside: false, over: false }
		} ) );

	}

	/**
	 * A shell has no inside and no outside, so it is drawn from both: standing
	 * on an AC tube and standing in it look at the same triangles, and a
	 * bridge's glazing is seen from the corridor as well as from the street.
	 * The cable is a closed tube and keeps its back faces culled.
	 */
	#material( key ) {

		return key === KEYS.wire.shell
			? this.factory.build( key )
			: this.factory.variant( key, { side: THREE.DoubleSide } );

	}

}

/** What the physics world needs and nothing else. */
function positionsOnly( geometry ) {

	const copy = new THREE.BufferGeometry();
	copy.setAttribute( 'position', geometry.getAttribute( 'position' ).clone() );

	return copy;

}
