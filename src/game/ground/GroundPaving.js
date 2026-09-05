import * as THREE from 'three/webgpu';
import { GroundPalette } from './GroundPalette.js';
import { fail } from './GroundRegions.js';
import { PavingFrame } from './PavingFrame.js';
import { PavingCells } from './PavingCells.js';
import { PavingMesh } from './PavingMesh.js';
import { signedArea } from './Polygons.js';

const FINISHES = {
	body: 'pavingBody', joint: 'joint', border: 'border', curb: 'curb',
	'crossing-field': 'pavingBody', approach: 'pavingBody', 'corner-infill': 'pavingBody'
};

/** Resolves authored paving ownership into material batches and owner collision. */
export class GroundPaving {

	constructor( records ) {

		this.owners = [];
		for ( const { region, layout, frame: data, covers } of records ) {

			const frame = new PavingFrame( data );
			const modules = new Map();
			if ( ! Array.isArray( layout.modules ) ) fail( 'Missing paving module records' );
			for ( const module of layout.modules ) {

				if ( ! module?.id || modules.has( module.id ) ) fail( 'Invalid or duplicate paving module id' );
				modules.set( module.id, module );

			}
			const body = region.band === 'curb' ? 'curb' : region.band === 'border' ? 'border' : 'pavingBody';
			for ( const cover of covers ) {

				if ( ! Number.isFinite( cover.top ) || ! Number.isFinite( cover.bottom ) || cover.bottom > cover.top ) fail( 'Invalid paving elevations' );
				const part = cover.construction.part;
				const finish = part?.kind === 'grid' ? body : part?.kind === 'solid' ? FINISHES[ part.role ] : undefined;
				if ( ! finish ) fail( 'Invalid paving part or solid role' );
				const binding = GroundPalette.construction( layout.familyId, finish );
				const cells = part.kind === 'grid' ? new PavingCells( frame, modules.get( part.moduleId ), part.cells ) : null;
				const joint = cells ? GroundPalette.construction( layout.familyId, 'joint' ) : null;
				this.owners.push( { cover, frame, familyId: layout.familyId, finish, binding, cells, joint } );

			}

		}

	}

	build( factory, road ) {

		const batches = new Map();
		const collision = new PavingMesh();
		const batch = ( familyId, finish, binding ) => {

			const id = `${familyId}:${finish}`;
			if ( ! batches.has( id ) ) batches.set( id, { familyId, finish, binding, vertices: new PavingMesh() } );
			return batches.get( id ).vertices;

		};
		for ( const { cover, frame, familyId, finish, binding, cells, joint } of this.owners ) {

			const body = batch( familyId, finish, binding );
			collision.polygon( cover.polygon, cover.top, frame );
			const sides = ( polygon, exposed, vertices ) => {

				if ( cover.surface !== 'curb' ) return;
				for ( let i = 0; i < polygon.length; i ++ ) {

					const a = polygon[ i ];
					const b = polygon[ ( i + 1 ) % polygon.length ];
					if ( ! exposed[ i ] || ! road.bordersEdge( a, b, true ) ) continue;
					vertices.face( a, b, cover.top, cover.bottom, frame );
					collision.face( a, b, cover.top, cover.bottom, frame );

				}

			};
			if ( cells ) {

				cells.forEach( pieces => {

					const joints = pieces.filter( piece => piece.role === 'joint' );
					body.quads( pieces.filter( piece => piece.role === 'body' ).map( piece => piece.polygon ), cover.top, frame );
					const jointVertices = joints.length ? batch( familyId, 'joint', joint ) : null;
					jointVertices?.quads( joints.map( piece => piece.polygon ), cover.top, frame );
					for ( const { role, polygon, exposed } of pieces ) sides( polygon, exposed, role === 'body' ? body : jointVertices );

				} );

			} else {

				body.polygon( cover.polygon, cover.top, frame );
				const polygon = signedArea( cover.polygon ) > 0 ? cover.polygon : [ ...cover.polygon ].reverse();
				sides( polygon, polygon.map( () => true ), body );

			}

		}
		const meshes = [];
		for ( const { familyId, finish, binding, vertices } of batches.values() ) {

			const geometry = vertices.geometry();
			if ( ! geometry ) continue;
			const mesh = new THREE.Mesh( geometry, factory.build( binding.key, binding.variantId ) );
			mesh.name = `ground:construction:${familyId}:${finish}`;
			mesh.userData.groundConstruction = { familyId, finish };
			mesh.receiveShadow = true;
			meshes.push( mesh );

		}
		return { meshes, colliderGeometry: collision.geometry( true ) };

	}

}
