import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RendererFactory } from '../app/RendererFactory.js';
import { CityView } from '../ui/views/CityView.js';
import { plateGeometry } from '../ui/views/Map3DView.js';
import { cityModel, parcelOf, viewerUrl } from './CityModel.js';

const GROUND = { roadway: 0x1c1f24, sidewalk: 0x4a4e55, block: 0x3a3d43, open: 0x2f3a33 };
const FLOOR_TONES = [ 0x8a7f6a, 0x9b9080 ];
const UNBUILT_TONE = 0x55585e;
const HOVER_TONE = 0x3fb7ff;
const SKY = 0x0d0f14;

/**
 * ?mode=city[&out=/out/small][&backend=webgpu|webgl]: the assembled city as
 * stacked floor prisms, every storey its own slab so heights read at a glance,
 * over the atlas ground cover. Hover names a parcel, a click opens it in the
 * building viewer. The first step of the pipeline, seen whole.
 */
export class CityApp {

	static configFromUrl() {

		const params = new URLSearchParams( window.location.search );

		return {
			out: params.get( 'out' ) ?? '/out/city-tiny',
			backend: params.get( 'backend' ) === 'webgl' ? 'webgl' : 'webgpu'
		};

	}

	constructor( config ) {

		this.config = config;
		this.view = new CityView();
		this.view.mount( document.body );
		this.hovered = null;
		this.byParcel = new Map();

	}

	async start() {

		try {

			await this.#run();

		} catch ( error ) {

			console.error( error );
			this.view.setWorld( String( error.message ?? error ) );

		}

	}

	async #run() {

		const { out, backend } = this.config;
		this.renderer = await RendererFactory.create( backend );
		document.body.prepend( this.renderer.domElement );

		const atlas = await json( `${out}/blueprint.json` );
		const manifest = await json( `${out}/manifest.json` ).catch( () => ( { parcels: [] } ) );
		const built = new Map();
		await Promise.all( manifest.parcels.map( async ( id ) => {

			const bp = await json( `${out}/${id}/${id}.blueprint.json` ).catch( () => null );
			if ( bp ) built.set( id, bp.floors );

		} ) );

		this.model = cityModel( atlas, built );
		this.#build();
		this.view.setWorld( `${out} · ${this.model.buildings.length} parcels, ${built.size} built · ${RendererFactory.actualBackend( this.renderer )}` );
		this.#interact();

		window.addEventListener( 'resize', () => this.resize() );
		this.renderer.setAnimationLoop( () => {

			this.controls.update();
			this.renderer.render( this.scene, this.camera );

		} );

	}

	#build() {

		const { buildings, ground } = this.model;
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color( SKY );
		this.scene.add( new THREE.HemisphereLight( 0xcfd6e6, 0x2a2622, 1.6 ), new THREE.DirectionalLight( 0xffffff, 1.2 ).translateY( 200 ).translateX( 80 ) );

		for ( const [ surface, color ] of Object.entries( GROUND ) ) {

			const mesh = new THREE.Mesh( plateGeometry( ground, surface, surface === 'roadway' ? 0 : 0.05 ), new THREE.MeshLambertMaterial( { color } ) );
			mesh.name = `ground:${surface}`;
			this.scene.add( mesh );

		}

		const bounds = new THREE.Box3();

		for ( const building of buildings ) {

			const group = new THREE.Group();
			group.name = `parcel:${building.parcelId}`;
			const shape = new THREE.Shape( building.ring.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );

			building.floors.forEach( ( floor, i ) => {

				const geometry = new THREE.ExtrudeGeometry( shape, { depth: Math.max( 0.05, floor.height - 0.08 ), bevelEnabled: false } )
					.rotateX( - Math.PI / 2 ).translate( 0, floor.elevation, 0 );
				const mesh = new THREE.Mesh( geometry, new THREE.MeshLambertMaterial( { color: building.built ? FLOOR_TONES[ i % 2 ] : UNBUILT_TONE } ) );
				mesh.name = `floor:${floor.index}`;
				group.add( mesh );

			} );

			this.scene.add( group );
			this.byParcel.set( building.parcelId, { building, group } );
			bounds.expandByObject( group );

		}

		const centre = bounds.getCenter( new THREE.Vector3() );
		const size = bounds.getSize( new THREE.Vector3() );
		const span = Math.max( size.x, size.z, 40 );
		this.camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 1, span * 20 );
		this.camera.position.set( centre.x + span * 0.6, span * 0.7, centre.z + span * 0.6 );
		this.controls = new OrbitControls( this.camera, this.renderer.domElement );
		this.controls.target.copy( centre );
		this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
		this.controls.update();
		this.resize();

	}

	#interact() {

		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();
		const canvas = this.renderer.domElement;
		let downAt = null;

		const pick = ( event ) => {

			pointer.set( ( event.clientX / window.innerWidth ) * 2 - 1, - ( event.clientY / window.innerHeight ) * 2 + 1 );
			raycaster.setFromCamera( pointer, this.camera );
			const hit = raycaster.intersectObjects( this.scene.children, true ).find( ( h ) => parcelOf( h.object ) );
			return hit ? parcelOf( hit.object ) : null;

		};

		canvas.addEventListener( 'pointermove', ( event ) => this.#hover( pick( event ) ) );
		canvas.addEventListener( 'pointerdown', ( event ) => { downAt = [ event.clientX, event.clientY ]; } );
		canvas.addEventListener( 'pointerup', ( event ) => {

			// a click, not the end of a drag
			if ( ! downAt || Math.hypot( event.clientX - downAt[ 0 ], event.clientY - downAt[ 1 ] ) > 4 ) return;
			const parcelId = pick( event );
			if ( parcelId ) window.location.href = viewerUrl( parcelId, this.config.out );

		} );

	}

	#hover( parcelId ) {

		if ( parcelId === this.hovered ) return;

		const tint = ( id, on ) => {

			const entry = this.byParcel.get( id );
			if ( ! entry ) return;
			entry.group.children.forEach( ( mesh, i ) => mesh.material.color.setHex( on ? HOVER_TONE : entry.building.built ? FLOOR_TONES[ i % 2 ] : UNBUILT_TONE ) );

		};

		tint( this.hovered, false );
		tint( parcelId, true );
		this.hovered = parcelId;
		this.view.setHover( this.byParcel.get( parcelId )?.building ?? null );

	}

	resize() {

		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( window.innerWidth, window.innerHeight );

	}

}

async function json( url ) {

	const response = await fetch( url );
	if ( ! response.ok || ! ( response.headers.get( 'content-type' ) ?? '' ).includes( 'json' ) ) throw new Error( `missing ${url}` );
	return response.json();

}
