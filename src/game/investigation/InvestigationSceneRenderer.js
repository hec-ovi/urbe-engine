import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { assertRigCompatibility } from '../agents/CharacterCatalog.js';
import { InvestigationError } from './InvestigationError.js';
import { assertProductionBody } from './ProductionMedia.js';

/** Three.js/Rapier adapter for already validated, renderer-neutral assemblies. */
export class InvestigationSceneRenderer {

	static async create( options ) {

		const renderer = new InvestigationSceneRenderer( options );
		for ( const assembly of options.assemblies ) await renderer.#addScene( assembly );
		return renderer;

	}

	constructor( { materialFactory, physics, playerCollider = null, animation = null, loadGltf = defaultLoad } ) {

		this.materialFactory = materialFactory;
		this.physics = physics;
		this.playerCollider = playerCollider;
		this.animation = animation;
		this.loadGltf = loadGltf;
		this.group = new THREE.Group();
		this.group.name = 'investigation-scenes';
		this.visuals = new Map();
		this.colliders = new Map();

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

		const visual = this.visuals.get( entityId );
		if ( visual ) visual.object.visible = false;
		for ( const handle of this.colliders.get( entityId ) ?? [] ) this.physics?.remove?.( handle );
		this.colliders.delete( entityId );

	}

	async #addScene( assembly ) {

		const scene = new THREE.Group();
		scene.name = `investigation:${assembly.sceneId}`;
		this.group.add( scene );
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
			this.visuals.set( entity.entityId, { object, focus } );
			if ( entity.blocksMovement ) this.#collide( entity );

		}
		for ( const decal of assembly.decals ) {

			const material = this.#material( decal.material );
			const geometry = new THREE.PlaneGeometry( decal.width, decal.height );
			const mesh = new THREE.Mesh( geometry, material );
			mesh.name = `investigation-decal:${decal.entityId}`;
			const u = vector( decal.transform.uAxis );
			const v = vector( decal.transform.vAxis );
			const normal = vector( decal.transform.normal );
			mesh.quaternion.setFromRotationMatrix( new THREE.Matrix4().makeBasis( u, v, normal ) );
			mesh.position.copy( vector( decal.transform.position ) );
			scene.add( mesh );
			this.visuals.set( decal.entityId, { object: mesh, focus: mesh.position.clone() } );

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
			if ( ! this.animation ) throw new Error( 'the audited Pro animation library is unavailable' );
			const model = await this.loadGltf( entity.asset.uri );
			assertRigCompatibility( model.scene, this.animation.scene );
			const root = clone( model.scene );
			for ( const clipRoot of [ root ] ) assertTexturedMeshes( clipRoot, entity.entityId );
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
