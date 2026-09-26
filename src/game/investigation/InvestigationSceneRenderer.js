import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { assertRigCompatibility } from '../agents/CharacterCatalog.js';
import { InvestigationError } from './InvestigationError.js';
import { assertProductionBody } from './ProductionMedia.js';
import { decalQuaternion } from '../scenery/SceneryRenderer.js';

/**
 * Three.js/Rapier adapter for already validated, renderer-neutral assemblies.
 * A scene is drawn from `realize` until `release`; an entity collected stays
 * out whenever its scene is drawn again. Source bodies are read once per
 * model, `prepare` reads them ahead, and a scene is warmed before it shows,
 * so standing it mid-game fetches, uploads and links nothing new.
 */
export class InvestigationSceneRenderer {

	/** @param warmup builds a scene's programs and maps before it is shown, or null */
	constructor( { materialFactory, physics, playerCollider = null, animation = null, loadGltf = defaultLoad, warmup = null } ) {

		this.materialFactory = materialFactory;
		this.physics = physics;
		this.playerCollider = playerCollider;
		this.animation = animation;
		this.loadGltf = loadGltf;
		this.warmup = warmup;
		this.models = new Map();
		this.group = new THREE.Group();
		this.group.name = 'investigation-scenes';
		this.visuals = new Map();
		this.colliders = new Map();
		this.scenes = new Map();
		this.collected = new Set();

	}

	/**
	 * Reads every Source body these assemblies stand, once, ahead of staging
	 * them. A body that fails is read again when its scene stages, which
	 * reports the failure for that scene alone.
	 */
	async prepare( assemblies ) {

		const uris = new Set( assemblies.flatMap( ( assembly ) => assembly.entities )
			.filter( ( entity ) => entity.role === 'body' && entity.sourceMaterialPolicy !== 'dressed-appearance' )
			.map( ( entity ) => entity.asset.uri ) );
		await Promise.allSettled( [ ...uris ].map( ( uri ) => this.#model( uri ) ) );

	}

	/** Builds, warms and shows one scene's bodies, props, decals and colliders; false when released meanwhile. */
	async realize( assembly ) {

		if ( this.scenes.has( assembly.sceneId ) ) return false;
		const scene = {
			group: new THREE.Group(),
			entityIds: [ ...assembly.entities, ...assembly.decals ].map( ( item ) => item.entityId )
		};
		scene.group.name = `investigation:${assembly.sceneId}`;
		this.scenes.set( assembly.sceneId, scene );
		try {

			await this.#addScene( assembly, scene.group );
			await this.warmup?.warm( scene.group );

		} catch ( error ) {

			if ( this.scenes.get( assembly.sceneId ) === scene ) this.release( assembly.sceneId );
			else this.#drop( scene );
			throw error;

		}
		if ( this.scenes.get( assembly.sceneId ) !== scene ) {

			this.#drop( scene );
			return false;

		}
		for ( const entity of assembly.entities ) if ( entity.blocksMovement && ! this.collected.has( entity.entityId ) ) this.#collide( entity );
		for ( const entityId of scene.entityIds ) if ( this.collected.has( entityId ) ) this.#hide( entityId );
		this.group.add( scene.group );
		return true;

	}

	/** Removes one scene's visuals and colliders. */
	release( sceneId ) {

		const scene = this.scenes.get( sceneId );
		if ( ! scene ) return;
		this.scenes.delete( sceneId );
		this.#drop( scene );

	}

	#drop( scene ) {

		this.group.remove( scene.group );
		for ( const entityId of scene.entityIds ) {

			for ( const handle of this.colliders.get( entityId ) ?? [] ) this.physics?.remove?.( handle );
			this.colliders.delete( entityId );
			const visual = this.visuals.get( entityId );
			if ( visual?.owned ) visual.object.traverse( ( node ) => node.geometry?.dispose() );
			this.visuals.delete( entityId );

		}

	}

	focus( entityId ) {

		const visual = this.visuals.get( entityId );
		if ( ! visual || ! visual.object.visible ) return null;
		return { position: visual.focus.clone(), visible: visual.object.visible };

	}

	unobstructed( from, to, entityId ) {

		if ( ! this.physics?.world?.castRay || ! this.physics.rapier?.Ray ) return true;
		const delta = to.clone().sub( from );
		const distance = delta.length();
		if ( distance <= 0.08 ) return true;
		const ray = new this.physics.rapier.Ray( from, delta.multiplyScalar( 1 / distance ) );
		const targetHandles = new Set(
			( this.colliders.get( entityId ) ?? [] ).map( ( handle ) => handle.collider.handle )
		);
		return ! this.physics.world.castRay(
			ray, distance - 0.08, true, undefined, undefined, this.playerCollider, undefined,
			( collider ) => ! targetHandles.has( collider.handle )
		);

	}

	collect( entityId ) {

		this.collected.add( entityId );
		this.#hide( entityId );

	}

	#hide( entityId ) {

		const visual = this.visuals.get( entityId );
		if ( visual ) visual.object.visible = false;
		for ( const handle of this.colliders.get( entityId ) ?? [] ) this.physics?.remove?.( handle );
		this.colliders.delete( entityId );

	}

	async #addScene( assembly, scene ) {

		for ( const entity of assembly.entities ) {

			const object = entity.role === 'body' ? await this.#body( entity ) : this.#missionProp( entity );
			object.name = `investigation-entity:${entity.entityId}`;
			object.position.set( entity.transform.position.x, entity.transform.position.y, entity.transform.position.z );
			object.rotation.y = entity.transform.yawRadians;
			scene.add( object );
			const focus = new THREE.Vector3(
				entity.transform.position.x,
				entity.transform.position.y + Math.max( 0.03, entity.dimensions.height * 0.5 ),
				entity.transform.position.z
			);
			this.visuals.set( entity.entityId, { object, focus, owned: entity.role !== 'body' } );

		}
		for ( const decal of assembly.decals ) {

			const material = this.#material( decal.material );
			const geometry = new THREE.PlaneGeometry( decal.width, decal.height );
			const mesh = new THREE.Mesh( geometry, material );
			mesh.name = `investigation-decal:${decal.entityId}`;
			mesh.quaternion.copy( decalQuaternion( decal.transform ) );
			mesh.position.copy( vector( decal.transform.position ) );
			scene.add( mesh );
			this.visuals.set( decal.entityId, { object: mesh, focus: mesh.position.clone(), owned: true } );

		}

	}

	#missionProp( entity ) {

		if ( ! entity.missionAsset ) throw assetError( `${entity.entityId} has no mission asset assembly` );
		const group = new THREE.Group();
		const materials = new Map( entity.missionAsset.materials.map( ( material ) => [ material.slot, this.#material( material ) ] ) );
		for ( const primitive of entity.missionAsset.geometry.primitives ) {

			const material = materials.get( primitive.materialSlot );
			if ( ! material ) throw materialError( `${entity.entityId} primitive ${primitive.primitiveId} has no material` );
			const mesh = new THREE.Mesh(
				new THREE.BoxGeometry( primitive.size.width, primitive.size.height, primitive.size.depth ), material
			);
			mesh.name = `${entity.entityId}:${primitive.primitiveId}`;
			mesh.position.set( primitive.position.x, primitive.position.y, primitive.position.z );
			mesh.rotation.set( primitive.rotationRadians.x, primitive.rotationRadians.y, primitive.rotationRadians.z );
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );

		}
		return group;

	}

	async #body( entity ) {

		try {

			assertProductionBody( entity );
			if ( entity.sourceMaterialPolicy === 'dressed-appearance' ) throw new Error( 'a dressed body stands through its scenery scene' );
			const model = await this.#model( entity.asset.uri );
			const root = clone( model.scene );
			assertTexturedMeshes( root, entity.entityId );
			const clip = THREE.AnimationClip.findByName( this.animation.animations, entity.poseId );
			if ( ! clip ) throw new Error( `Pro animation library is missing ${entity.poseId}` );
			const mixer = new THREE.AnimationMixer( root );
			const action = mixer.clipAction( clip );
			action.setLoop( THREE.LoopOnce, 1 );
			action.clampWhenFinished = true;
			action.play();
			mixer.setTime( Math.max( 0, clip.duration - 1 / 120 ) );
			root.updateMatrixWorld( true );
			fitBody( root, entity.dimensions );
			const container = new THREE.Group();
			container.add( root );
			container.userData.finalPose = entity.poseId;
			container.userData.mixer = mixer;
			return container;

		} catch ( error ) {

			throw assetError( `${entity.entityId}: ${error.message}` );

		}

	}

	/** One Source body, read and checked against the rig once for the run. */
	#model( uri ) {

		if ( ! this.models.has( uri ) ) {

			const loading = ( async () => {

				if ( ! this.animation ) throw new Error( 'the audited Pro animation library is unavailable' );
				const model = await this.loadGltf( uri );
				assertRigCompatibility( model.scene, this.animation.scene );
				return model;

			} )();
			// A body that fails to read is read again the next time a scene asks for it.
			loading.catch( () => { if ( this.models.get( uri ) === loading ) this.models.delete( uri ); } );
			this.models.set( uri, loading );

		}
		return this.models.get( uri );

	}

	#material( assignment ) {

		const material = this.materialFactory?.build?.( assignment.key, assignment.variantId );
		if ( ! material || material.name?.startsWith( 'unresolved:' ) ) throw materialError( `material ${assignment.key}#${assignment.variantId ?? ''} is unavailable` );
		return material;

	}

	#collide( entity ) {

		if ( ! this.physics?.addTrimesh ) return;
		const geometry = new THREE.BoxGeometry( entity.dimensions.width, entity.dimensions.height, entity.dimensions.depth );
		geometry.translate( 0, entity.dimensions.height / 2, 0 );
		geometry.rotateY( entity.transform.yawRadians );
		geometry.translate( entity.transform.position.x, entity.transform.position.y, entity.transform.position.z );
		try {

			this.colliders.set( entity.entityId, [ this.physics.addTrimesh( geometry ) ] );

		} finally {

			geometry.dispose();

		}

	}

}

function fitBody( root, dimensions ) {

	let bounds = new THREE.Box3().expandByObject( root, true );
	const size = bounds.getSize( new THREE.Vector3() );
	if ( size.x <= 0 || size.y <= 0 || size.z <= 0 ) throw new Error( 'Source body has empty geometry' );
	const scale = Math.min( dimensions.width / size.x, dimensions.height / size.y, dimensions.depth / size.z );
	root.scale.setScalar( scale );
	root.updateMatrixWorld( true );
	bounds = new THREE.Box3().expandByObject( root, true );
	const center = bounds.getCenter( new THREE.Vector3() );
	root.position.set( - center.x, - bounds.min.y, - center.z );

}

function assertTexturedMeshes( root, entityId ) {

	let meshes = 0;
	root.traverse( ( node ) => {

		if ( ! node.isMesh || node.visible === false ) return;
		meshes ++;
		const materials = Array.isArray( node.material ) ? node.material : [ node.material ];
		if ( materials.some( ( material ) => ! material?.map ) ) throw new Error( `${entityId} has a visible Source surface without its original texture` );
		node.castShadow = true;
		node.receiveShadow = true;

	} );
	if ( meshes === 0 ) throw new Error( `${entityId} has no visible Source mesh` );

}

function vector( value ) {

	return new THREE.Vector3( value.x, value.y, value.z );

}

function defaultLoad( uri ) {

	return new GLTFLoader().loadAsync( uri );

}

function assetError( message ) {

	return new InvestigationError( 'E_INVESTIGATION_ASSET', message );

}

function materialError( message ) {

	return new InvestigationError( 'E_INVESTIGATION_MATERIAL', message );

}
