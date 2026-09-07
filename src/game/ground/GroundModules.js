import * as THREE from 'three/webgpu';
import { GroundPalette } from './GroundPalette.js';
import { ModulePrisms, moduleCollision } from './ModulePrisms.js';
import { fail } from './GroundRegions.js';
import { pair } from './PavingFrame.js';
import { signedArea } from './Polygons.js';

const ROLES = new Set( [ 'panel', 'joint', 'curb', 'gutter', 'gutter-lip', 'roadway', 'marking', 'guardrail' ] );
const AXES = [ [ 1, 0 ], [ 0, 1 ], [ - 1, 0 ], [ 0, - 1 ] ];

/** Physical Atlas templates own module ground; planning covers never become meshes. */
export class GroundModules {

	constructor( atlas ) {

		const source = atlas.streets?.construction?.modules;
		this.active = source !== undefined;
		this.batches = [];
		const covers = atlas.volumetric.ground.filter( cover => cover.moduleBlockId !== undefined );
		if ( ! this.active ) {

			if ( covers.length ) fail( 'Module planning covers have no physical definitions' );
			return;

		}
		if ( source?.version !== '1.0.0' || ! Array.isArray( source.definitions ) || ! Array.isArray( source.placements ) ) fail( 'Invalid street modules' );
		const definitions = new Map();
		for ( const definition of source.definitions ) {

			if ( ! definition?.id || definitions.has( definition.id ) || ! Array.isArray( definition.parts ) || ! definition.parts.length ) fail( 'Invalid module definition' );
			for ( const part of definition.parts ) {

				if ( ! ROLES.has( part?.role ) || ! Array.isArray( part.polygon ) || part.polygon.length < 3 || ! part.polygon.every( pair )
					|| ! Number.isFinite( part.bottom ) || ! Number.isFinite( part.top ) || part.bottom > part.top || Math.abs( signedArea( part.polygon ) ) === 0 ) fail( `Invalid module prism: ${definition.id}` );

			}
			definitions.set( definition.id, definition );

		}
		const groups = new Map(), owners = new Set();
		for ( const placement of source.placements ) {

			const definition = definitions.get( placement.moduleId );
			if ( ! definition || ! placement.blockId || ! pair( placement.origin ) || ! Number.isInteger( placement.turn ) || ! AXES[ placement.turn ]
				|| ! Number.isSafeInteger( placement.count ) || placement.count < 1 || ! Number.isFinite( placement.step ) || placement.step <= 0 ) fail( 'Invalid module placement' );
			owners.add( placement.blockId );
			const id = `${placement.moduleId}:${placement.finish}`;
			if ( ! groups.has( id ) ) {

				const bindings = new Map();
				for ( const { role } of definition.parts ) if ( role !== 'guardrail' ) bindings.set( role, GroundPalette.module( placement.finish, role ) );
				groups.set( id, { definition, familyId: placement.finish, bindings, transforms: [] } );

			}
			const transforms = groups.get( id ).transforms;
			const [ c, s ] = AXES[ placement.turn ];
			for ( let i = 0; i < placement.count; i ++ ) {

				const x = placement.origin[ 0 ] + c * i * placement.step;
				const z = placement.origin[ 1 ] + s * i * placement.step;
				if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) fail( 'Module repetition is not finite' );
				transforms.push( new THREE.Matrix4().set( c, 0, - s, x, 0, 1, 0, 0, s, 0, c, z, 0, 0, 0, 1 ) );

			}

		}
		if ( covers.some( cover => ! owners.has( cover.moduleBlockId ) ) ) fail( 'Unknown module planning owner' );
		const geometries = new Map();
		for ( const { definition, familyId, bindings, transforms } of groups.values() ) {

			for ( const [ role, binding ] of bindings ) {

				const id = `${definition.id}:${role}`;
				if ( ! geometries.has( id ) ) {

					const prisms = new ModulePrisms();
					for ( const part of definition.parts ) if ( part.role === role ) prisms.add( part );
					geometries.set( id, prisms.geometry() );

				}
				this.batches.push( { moduleId: definition.id, familyId, role, binding, transforms, geometry: geometries.get( id ) } );

			}

		}

	}

	build( factory ) {

		const meshes = this.batches.map( ( { moduleId, familyId, role, binding, transforms, geometry } ) => {

			const mesh = new THREE.InstancedMesh( geometry, factory.build( binding.key, binding.variantId ), transforms.length );
			mesh.name = `ground:module:${moduleId}:${familyId}:${role}`;
			mesh.userData.groundModule = { moduleId, familyId, role };
			mesh.receiveShadow = true;
			transforms.forEach( ( transform, index ) => mesh.setMatrixAt( index, transform ) );
			mesh.instanceMatrix.needsUpdate = true;
			mesh.computeBoundingBox();
			mesh.computeBoundingSphere();
			return mesh;

		} );
		return { meshes, colliderGeometry: moduleCollision( this.batches.filter( batch => batch.role !== 'marking' ) ) };

	}

}
