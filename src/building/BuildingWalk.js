import * as THREE from 'three/webgpu';
import { Physics } from '../game/physics/Physics.js';
import { WorldColliders } from '../game/physics/WorldColliders.js';
import { PlayerBody } from '../game/physics/PlayerBody.js';
import { DoorColliders } from '../game/physics/DoorColliders.js';
import { Input } from '../game/player/Input.js';
import { PlayerController } from '../game/player/PlayerController.js';
import { Interactor } from '../game/player/Interactor.js';
import { InteriorModules } from '../game/city/InteriorModules.js';
import { InteriorProps } from '../game/city/InteriorProps.js';
import { InteriorStream } from '../game/city/InteriorStream.js';
import { RoomView } from '../game/city/RoomView.js';
import { Elevators } from '../game/city/Elevators.js';
import { RoomLights } from '../game/light/RoomLights.js';

/** One building hosted by the same player, collision, doors, lifts and rooms as the game. */
export class BuildingWalk {
    static async create( options ) {
        const walk = new BuildingWalk( options );
        await walk.prepare();
        return walk;
    }

    constructor( { app, city, interior, blueprint, factory, parcel } ) {
        Object.assign( this, { app, city, interior, blueprint, factory, parcel } );
        this.enabled = false;
        this.entering = false;
    }

    get roof() {
        const crown = this.interior?.building.floors.find( floor => this.interior.layouts[ floor.layout ]?.npc?.nav?.roofAccess );
        const access = crown && this.interior.layouts[ crown.layout ]?.npc?.nav?.roofAccess;
        return access ? { ...access, elevation: crown.elevation + access.elevation, sourceFloor: crown.index } : null;
    }

    get destinations() {
        const floors = this.interior?.building.floors ?? [];
        const roof = this.roof;
        return roof ? [ ...floors, { index: roof.floor, label: 'Roof' } ] : floors;
    }

    async prepare() {
        this.physics = await Physics.create();
        this.colliders = new WorldColliders( this.physics );
        this.physics.addHalfSpace( -0.01 );
        await this.colliders.addStaticsAsync( [ ...this.city.shellColliders.values() ].filter( Boolean ), { release: true } );
        this.input = new Input( this.app.renderer.domElement );
        this.input.onLockChange = locked => this.app.view.setCameraCaptured( locked );
        const entrance = this.city.entrances[ 0 ];
        const bounds = new THREE.Box3().setFromObject( this.city.group );
        this.outside = entrance?.outside.clone() ?? new THREE.Vector3( bounds.min.x - 2, 0.02, bounds.getCenter( new THREE.Vector3() ).z );
        this.outside.y += 0.04;
        this.body = new PlayerBody( this.physics, this.outside );
        this.controller = new PlayerController( { body: this.body, camera: this.app.camera, input: this.input } );
        this.controller.lookAt( entrance?.center ?? bounds.getCenter( new THREE.Vector3() ) );
        this.elevators = new Elevators( this.factory );
        const doorColliders = new DoorColliders( this.physics, this.city.doors );
        this.interactor = new Interactor( { crowd: { within: () => [] }, doors: this.city.doors,
            controller: this.controller, elevators: this.elevators, doorColliders } );
        if ( this.interior ) {
            this.rooms = new RoomLights( this.factory, this.app.look.tier );
            this.modules = new InteriorModules( { catalog: this.interior.modules.document,
                baseUrl: this.interior.modules.baseUrl, factory: this.factory, roomLights: this.rooms } );
            this.props = new InteriorProps( { catalog: this.interior.props.document,
                baseUrl: this.interior.props.baseUrl, roomLights: this.rooms } );
            await this.modules.ready;
            this.stream = new InteriorStream( { modules: this.modules, props: this.props, roomLights: this.rooms, elevators: this.elevators, haze: null } );
            this.stream.onColliderBand = ( id, { boxes, positions } ) => {
                if ( boxes.length ) this.colliders.addBoxes( id, boxes );
                return positions.length ? this.colliders.addBand( `${id}/props`, positions ) : true;
            };
            this.stream.onDropBand = id => { this.colliders.dropBand( id ); this.colliders.dropBand( `${id}/props` ); };
            this.stream.register( new Map( [ [ this.parcel, { interior: this.interior, hasInterior: true } ] ] ), this.city.centers );
            this.roomView = new RoomView( [], 40 );
            this.app.scene.add( this.stream.group );
            await this.readyAt( this.outside, this.interior.building.floors[ 0 ].index );
        }
        this.click = () => { if ( this.enabled ) this.input.requestLock().then( accepted => { if ( ! accepted ) this.app.view.setCameraCaptured( false, true ); } ); };
        this.app.renderer.domElement.addEventListener( 'click', this.click );
    }

    async readyAt( point, floor ) {
        if ( ! this.stream ) return;
        const started = performance.now();
        while ( performance.now() - started < 60000 ) {
            this.stream.update( point );
            const band = this.stream.live.get( this.parcel )?.bands.find( item => item.floor === floor );
            if ( band?.state === 'failed' ) throw new Error( `Interior floor ${floor} could not load` );
            if ( band?.live ) return;
            await new Promise( resolve => setTimeout( resolve, 16 ) );
        }
        throw new Error( `Interior floor ${floor} did not become walkable` );
    }

    async enter( floor = null ) {
        if ( this.entering ) return;
        this.entering = true;
        try {
            let point = this.outside.clone();
            let target = this.city.entrances[ 0 ]?.center;
            const roof = this.roof;
            if ( roof && floor === roof.floor ) {
                point.set( roof.entry[ 0 ], roof.elevation + .05, roof.entry[ 1 ] );
                await this.readyAt( point, roof.sourceFloor );
                target = new THREE.Vector3( roof.door.position[ 0 ], point.y, roof.door.position[ 1 ] );
            } else if ( floor !== null && this.interior ) {
                const record = this.interior.building.floors.find( entry => entry.index === floor );
                if ( ! record ) throw new Error( `Unknown floor ${floor}` );
                const center = this.city.centers.get( this.parcel );
                await this.readyAt( new THREE.Vector3( center.x, record.elevation + 0.05, center.z ), floor );
                const rooms = this.stream.rooms.filter( room => room.floor === floor );
                const room = rooms.find( room => [ 'corridor', 'elevator_lobby', 'concourse' ].includes( room.kind ) ) ?? rooms[ 0 ];
                point.set( room.center.x, record.elevation + 0.05, room.center.z );
                const b = room.bounds;
                target = b.z1 - b.z0 > b.x1 - b.x0
                    ? new THREE.Vector3( point.x, point.y, b.z1 )
                    : new THREE.Vector3( b.x1, point.y, point.z );
            }
            this.app.controls.dispose();
            this.body.teleport( point );
            if ( target ) this.controller.lookAt( target );
            this.controller.pitch = 0;
            this.input.clear();
            this.enabled = true;
            this.app.slicer.apply( 'full' );
            this.controller.update( 0 );
            this.app.view.setWalkActive( true );
        } finally { this.entering = false; }
    }

    update( delta ) {
        if ( this.entering ) return;
        const point = this.enabled ? this.body.feet : this.app.camera.position;
        if ( this.stream ) {
            this.stream.update( point );
            if ( this.roomView.rooms !== this.stream.rooms ) this.roomView.setRooms( this.stream.rooms );
            const visible = this.roomView.update( point, delta );
            this.rooms.update( visible, point, delta );
            this.app.look.exposure.enter( visible.some( room => room.holds( point ) ) ? 'interior' : 'exterior' );
            this.app.look.exposure.update( delta );
        }
        if ( ! this.enabled ) return;
        if ( this.input.consume( 'Escape' ) ) this.input.exitLock();
        this.physics.step( delta );
        this.controller.frozen = ! this.input.locked;
        this.controller.update( delta );
        this.elevators.update( delta, this.body );
        const prompt = this.interactor.update( delta );
        this.app.view.setInteraction( prompt );
        if ( this.input.locked && this.input.consume( 'KeyE' ) ) this.interactor.activate( { timeMin: 0 } );
        this.input.endFrame();
    }
}
