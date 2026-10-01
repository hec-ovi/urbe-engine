import * as THREE from 'three/webgpu';

/** The lens and the angle a building is seen from: front right, from above, the whole of it in frame. */
const LENS = { fov: 30, turn: 0.72, rise: 0.42, margin: 1.12 };
/** The plinth the model stands on, as dark as the backdrop's edge. */
const PLINTH = 0x16262b;
const GLASS = 0x24363d;

/**
 * A place's own building, small: the plan its parcel is a copy of (the kit
 * runtime's standing plan, KitPieces), its facade surfaces wearing their own
 * colour maps under one plain material, on a dark plinth, framed whole from
 * the front right and above (Snapshots). A plan is pictured once and kept,
 * whichever of its copies asks.
 *
 * `building( parcelId )` resolves with the picture's URL, or null for a parcel
 * that is not a kit building, or whose plan the city has not stood this run.
 */
export class BuildingShots {

	/**
	 * @param snapshots the Snapshots that draws it
	 * @param pieces KitPieces, whose `plans` hold every plan the city has stood
	 * @param buildings the building sources by parcel id (`source`, `placementsUrl`)
	 * @param readJson reads a placement record
	 */
	constructor( { snapshots, pieces, buildings, readJson = ( url ) => fetch( url ).then( ( response ) => response.json() ) } ) {

		this.snapshots = snapshots;
		this.pieces = pieces;
		this.buildings = buildings;
		this.readJson = readJson;
		this.byParcel = new Map();
		this.byPlan = new Map();
		this.materials = new WeakMap();
		this.scene = new THREE.Scene();
		const key = new THREE.DirectionalLight( 0xfff1dc, 2.4 );
		key.position.set( 3, 5, 4 );
		const fill = new THREE.DirectionalLight( 0x8fc8d4, 0.9 );
		fill.position.set( - 4, 2, - 1 );
		this.scene.add( new THREE.HemisphereLight( 0xd5e6e6, 0x1b2427, 1.2 ), key, fill );
		this.plinth = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshStandardNodeMaterial( { color: PLINTH, roughness: 1 } ) );
		this.camera = new THREE.PerspectiveCamera( LENS.fov, 1, 0.5, 4000 );

	}

	building( parcelId ) {

		if ( ! this.byParcel.has( parcelId ) ) this.byParcel.set( parcelId, this.#planOf( parcelId ).then( ( planId ) => {

			if ( ! planId ) return null;
			if ( ! this.byPlan.has( planId ) ) this.byPlan.set( planId, this.snapshots.take( () => this.#stage( planId ) ) );
			return this.byPlan.get( planId );

		}, () => null ) );
		return this.byParcel.get( parcelId );

	}

	async #planOf( parcelId ) {

		const source = this.buildings?.get( parcelId );
		if ( source?.source !== 'kit' || ! source.placementsUrl || ! this.pieces ) return null;
		const record = await this.readJson( source.placementsUrl );
		return record?.plan && this.pieces.has( record.plan ) ? record.plan : null;

	}

	#stage( planId ) {

		const plan = this.pieces.plans.get( planId );
		if ( ! plan?.surfaces?.length ) return null;
		const model = new THREE.Group();
		const bounds = new THREE.Box3();
		const borrowed = [];
		for ( const surface of [ ...plan.surfaces, ...( plan.leaves ?? [] ).flatMap( ( leaf ) => leaf.surfaces ) ] ) {

			const geometry = borrow( surface.geometry );
			borrowed.push( geometry );
			bounds.union( geometry.boundingBox );
			model.add( new THREE.Mesh( geometry, this.#maquette( surface.material ) ) );

		}
		if ( bounds.isEmpty() ) return null;
		const size = bounds.getSize( new THREE.Vector3() );
		const centre = bounds.getCenter( new THREE.Vector3() );
		this.plinth.scale.set( size.x * 1.25, Math.max( 0.4, size.y * 0.015 ), size.z * 1.25 );
		this.plinth.position.set( centre.x, bounds.min.y - this.plinth.scale.y / 2, centre.z );
		model.add( this.plinth );
		this.scene.add( model );
		frameWhole( this.camera, bounds );
		return {
			scene: this.scene,
			camera: this.camera,
			done: () => {

				model.remove( this.plinth );
				model.removeFromParent();
				// The picture's upload goes with it; the plan's own data and batches stay.
				for ( const geometry of borrowed ) geometry.dispose();

			}
		};

	}

	/** One plain material per facade material: its colour and colour map, no other channel, so every model builds the same few programs. */
	#maquette( source ) {

		let material = this.materials.get( source );
		if ( material ) return material;
		const glass = ( source?.transmission ?? 0 ) > 0 || source?.transparent;
		material = glass
			? new THREE.MeshStandardNodeMaterial( { color: GLASS, roughness: 0.25, metalness: 0.2 } )
			: new THREE.MeshStandardNodeMaterial( { color: source?.color ?? 0xb8c4c4, map: source?.map ?? null, roughness: 0.85, metalness: 0 } );
		material.side = source?.side ?? THREE.FrontSide;
		this.materials.set( source, material );
		return material;

	}

}

/**
 * A surface's geometry for one picture: the plan's own attributes under a
 * geometry of the picture's, so what the picture uploads is let go with it
 * while the plan, which only its batches draw, keeps every array.
 */
function borrow( source ) {

	const geometry = new THREE.BufferGeometry();
	for ( const [ name, attribute ] of Object.entries( source.attributes ) ) geometry.setAttribute( name, attribute );
	geometry.setIndex( source.index );
	for ( const group of source.groups ) geometry.addGroup( group.start, group.count, group.materialIndex );
	geometry.boundingBox = source.boundingBox?.clone() ?? null;
	if ( ! geometry.boundingBox ) geometry.computeBoundingBox();
	return geometry;

}

/** Aims the camera from the front right and above so the whole box fits. */
export function frameWhole( camera, bounds ) {

	const sphere = bounds.getBoundingSphere( new THREE.Sphere() );
	const distance = sphere.radius * LENS.margin / Math.sin( THREE.MathUtils.degToRad( LENS.fov ) / 2 );
	const direction = new THREE.Vector3( Math.sin( LENS.turn ), LENS.rise, Math.cos( LENS.turn ) ).normalize();
	camera.position.copy( sphere.center ).addScaledVector( direction, distance );
	camera.near = Math.max( 0.1, distance - sphere.radius * 2 );
	camera.far = distance + sphere.radius * 2;
	camera.lookAt( sphere.center );
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld();
	return distance;

}
