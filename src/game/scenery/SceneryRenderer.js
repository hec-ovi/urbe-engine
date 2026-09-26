import * as THREE from 'three/webgpu';
import { SceneryError } from './SceneryError.js';

/** A footprint or posed body this much longer one way than the other has a long side. */
const LONG_SIDE = 0.05;

/**
 * Three.js and Rapier adapter for validated staging assemblies. A realized
 * scene is its still bodies (the crowd person posed through CharacterPoser),
 * its mission-asset primitives and its fitted decals, all wearing resolved
 * materials, with one box collider per element that blocks movement.
 * Unrealizing hands the bodies back to the poser's wardrobe and removes every
 * visual and collider; a scene can be realized again at any time.
 */
export class SceneryRenderer {

	/**
	 * @param poser the CharacterPoser the focused rig shares
	 * @param materialFactory resolves `key` and `variantId` to a material, `unresolved:` when unknown
	 * @param physics the Rapier host (`addTrimesh`, `remove`, `world`, `rapier`), or null
	 * @param lighting ActorLighting for the bodies, or null
	 * @param warmup builds a scene's programs before it is shown, or null
	 */
	constructor( { poser, materialFactory, physics = null, playerCollider = null, lighting = null, warmup = null } ) {

		this.poser = poser;
		this.materialFactory = materialFactory;
		this.physics = physics;
		this.playerCollider = playerCollider;
		this.lighting = lighting;
		this.warmup = warmup;
		this.group = new THREE.Group();
		this.group.name = 'scenery';
		this.scenes = new Map();
		this.pending = new Map();
		/** Entities taken out of a scene; they stay out when it is realized again. */
		this.collected = new Map();

	}

	isRealized( sceneId ) {

		return this.scenes.has( sceneId );

	}

	isPending( sceneId ) {

		return this.pending.has( sceneId );

	}

	/** Builds, warms and shows one scene; resolves false when it was unrealized meanwhile. */
	async realize( assembly ) {

		const sceneId = assembly.sceneId;
		if ( this.scenes.has( sceneId ) || this.pending.has( sceneId ) ) return false;
		const token = {};
		this.pending.set( sceneId, token );
		const scene = { sceneId, group: new THREE.Group(), visuals: new Map(), colliders: new Map(), bodies: [], geometries: [] };
		scene.group.name = `scenery:${sceneId}`;

		try {

			const people = new Map( assembly.actors.map( ( actor ) => [ actor.actorId, actor ] ) );
			for ( const entity of assembly.entities ) {

				const object = entity.role === 'body'
					? await this.#body( scene, entity, people.get( entity.entityId ) )
					: this.#missionProp( scene, entity );
				object.name = `scenery-entity:${entity.entityId}`;
				object.position.set( entity.transform.position.x, entity.transform.position.y, entity.transform.position.z );
				object.rotation.y = entity.transform.yawRadians;
				object.updateMatrixWorld( true );
				scene.group.add( object );
				const focus = new THREE.Vector3(
					entity.transform.position.x,
					entity.transform.position.y + Math.max( 0.03, entity.dimensions.height * 0.5 ),
					entity.transform.position.z
				);
				scene.visuals.set( entity.entityId, { object, focus, entity } );

			}
			for ( const decal of assembly.decals ) {

				const geometry = new THREE.PlaneGeometry( decal.width, decal.height );
				scene.geometries.push( geometry );
				const mesh = new THREE.Mesh( geometry, this.#material( decal.material ) );
				mesh.name = `scenery-decal:${decal.entityId}`;
				mesh.quaternion.copy( decalQuaternion( decal.transform ) );
				mesh.position.copy( vector( decal.transform.position ) );
				mesh.receiveShadow = true;
				scene.group.add( mesh );
				scene.visuals.set( decal.entityId, { object: mesh, focus: mesh.position.clone(), entity: null } );

			}
			await this.warmup?.warm( scene.group );
			if ( this.pending.get( sceneId ) !== token ) {

				this.#dispose( scene );
				return false;

			}
			for ( const { entity } of scene.visuals.values() ) if ( entity?.blocksMovement ) this.#collide( scene, entity );
			for ( const entityId of this.collected.get( sceneId ) ?? [] ) this.#hide( scene, entityId );
			this.group.add( scene.group );
			this.scenes.set( sceneId, scene );
			return true;

		} catch ( error ) {

			this.#dispose( scene );
			throw error instanceof SceneryError ? error : new SceneryError( 'E_SCENERY_ASSET', `${sceneId}: ${error.message}` );

		} finally {

			if ( this.pending.get( sceneId ) === token ) this.pending.delete( sceneId );

		}

	}

	/** Removes one scene's visuals and colliders, or stops it realizing. */
	unrealize( sceneId ) {

		this.pending.delete( sceneId );
		const scene = this.scenes.get( sceneId );
		if ( ! scene ) return;
		this.scenes.delete( sceneId );
		this.group.remove( scene.group );
		this.#dispose( scene );

	}

	/**
	 * One scene's elements as an investigation overlay sees them: where each is
	 * and whether it shows, whether a ray to it is clear, and taking one out.
	 */
	visuals( sceneId ) {

		return {
			focus: ( entityId ) => {

				const visual = this.scenes.get( sceneId )?.visuals.get( entityId );
				if ( ! visual || ! visual.object.visible ) return null;
				return { position: visual.focus.clone(), visible: true };

			},
			unobstructed: ( from, to, entityId ) => this.#unobstructed( sceneId, from, to, entityId ),
			collect: ( entityId ) => {

				if ( ! this.collected.has( sceneId ) ) this.collected.set( sceneId, new Set() );
				this.collected.get( sceneId ).add( entityId );
				const scene = this.scenes.get( sceneId );
				if ( scene ) this.#hide( scene, entityId );

			}
		};

	}

	#unobstructed( sceneId, from, to, entityId ) {

		if ( ! this.physics?.world?.castRay || ! this.physics.rapier?.Ray ) return true;
		const delta = to.clone().sub( from );
		const distance = delta.length();
		if ( distance <= 0.08 ) return true;
		const ray = new this.physics.rapier.Ray( from, delta.multiplyScalar( 1 / distance ) );
		const own = new Set( ( this.scenes.get( sceneId )?.colliders.get( entityId ) ?? [] ).map( ( handle ) => handle.collider.handle ) );
		return ! this.physics.world.castRay(
			ray, distance - 0.08, true, undefined, undefined, this.playerCollider, undefined,
			( collider ) => ! own.has( collider.handle )
		);

	}

	#hide( scene, entityId ) {

		const visual = scene.visuals.get( entityId );
		if ( visual ) visual.object.visible = false;
		for ( const handle of scene.colliders.get( entityId ) ?? [] ) this.physics?.remove?.( handle );
		scene.colliders.delete( entityId );

	}

	/**
	 * The crowd person held in the pose, never scaled: turned a quarter when
	 * the posed body runs across its footprint's long side, then centred on the
	 * footprint with its lowest point on the floor.
	 */
	async #body( scene, entity, actor ) {

		if ( ! actor ) throw new SceneryError( 'E_SCENERY_IDENTITY', `${scene.sceneId} body ${entity.entityId} has no actor` );
		const root = await this.poser.still( actor, actor.clip, actor.at );
		scene.bodies.push( root );
		let bounds = new THREE.Box3().expandByObject( root, true );
		if ( bounds.isEmpty() ) throw new SceneryError( 'E_SCENERY_ASSET', `${scene.sceneId} body ${entity.entityId} has no geometry` );
		const size = bounds.getSize( new THREE.Vector3() );
		const { width, depth } = entity.dimensions;
		if ( Math.abs( width - depth ) > LONG_SIDE && Math.abs( size.x - size.z ) > LONG_SIDE && ( size.x > size.z ) !== ( width > depth ) ) {

			root.rotation.y = Math.PI / 2;
			root.updateMatrixWorld( true );
			bounds = new THREE.Box3().expandByObject( root, true );

		}
		const center = bounds.getCenter( new THREE.Vector3() );
		root.position.set( - center.x, - bounds.min.y, - center.z );
		const container = new THREE.Group();
		container.add( root );
		container.userData.poseId = actor.poseId;
		this.lighting?.attachRoot( root, vector( entity.transform.position ) );
		return container;

	}

	#missionProp( scene, entity ) {

		if ( ! entity.missionAsset ) throw new SceneryError( 'E_SCENERY_ASSET', `${scene.sceneId} prop ${entity.entityId} has no mission asset assembly` );
		const group = new THREE.Group();
		const materials = new Map( entity.missionAsset.materials.map( ( material ) => [ material.slot, this.#material( material ) ] ) );
		for ( const primitive of entity.missionAsset.geometry.primitives ) {

			const material = materials.get( primitive.materialSlot );
			if ( ! material ) throw new SceneryError( 'E_SCENERY_MATERIAL', `${entity.entityId} primitive ${primitive.primitiveId} has no material` );
			const geometry = new THREE.BoxGeometry( primitive.size.width, primitive.size.height, primitive.size.depth );
			scene.geometries.push( geometry );
			const mesh = new THREE.Mesh( geometry, material );
			mesh.name = `${entity.entityId}:${primitive.primitiveId}`;
			mesh.position.set( primitive.position.x, primitive.position.y, primitive.position.z );
			mesh.rotation.set( primitive.rotationRadians.x, primitive.rotationRadians.y, primitive.rotationRadians.z );
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );

		}
		return group;

	}

	#material( assignment ) {

		const material = this.materialFactory?.build?.( assignment.key, assignment.variantId );
		if ( ! material || material.name?.startsWith( 'unresolved:' ) ) {

			throw new SceneryError( 'E_SCENERY_MATERIAL', `material ${assignment.key}#${assignment.variantId ?? ''} is unavailable` );

		}
		return material;

	}

	#collide( scene, entity ) {

		if ( ! this.physics?.addTrimesh ) return;
		const geometry = new THREE.BoxGeometry( entity.dimensions.width, entity.dimensions.height, entity.dimensions.depth );
		geometry.translate( 0, entity.dimensions.height / 2, 0 );
		geometry.rotateY( entity.transform.yawRadians );
		geometry.translate( entity.transform.position.x, entity.transform.position.y, entity.transform.position.z );
		try {

			scene.colliders.set( entity.entityId, [ this.physics.addTrimesh( geometry ) ] );

		} finally {

			geometry.dispose();

		}

	}

	#dispose( scene ) {

		for ( const handles of scene.colliders.values() ) for ( const handle of handles ) this.physics?.remove?.( handle );
		scene.colliders.clear();
		for ( const root of scene.bodies ) {

			this.lighting?.releaseRoot( root );
			this.poser.release( root );

		}
		scene.bodies = [];
		for ( const geometry of scene.geometries ) geometry.dispose();
		scene.geometries = [];

	}

}

/**
 * The turn that lays a plane's +X along a surface's u axis and its face along
 * the surface normal. The plane's +Y follows normal x u, so a surface frame
 * of either handedness gives a true rotation.
 */
export function decalQuaternion( { uAxis, normal } ) {

	const u = vector( uAxis );
	const n = vector( normal );
	return new THREE.Quaternion().setFromRotationMatrix( new THREE.Matrix4().makeBasis( u, n.clone().cross( u ), n ) );

}

function vector( value ) {

	return new THREE.Vector3( value.x, value.y, value.z );

}
