import * as THREE from 'three/webgpu';
import { If } from 'three/tsl';
import { FillChannel, FILL_CHANNEL } from '../city/kit/FillChannel.js';
import { RoomFillNode, roomFillValue } from './RoomFillNode.js';

const DARK = new THREE.Vector4( 0, 0, 0, 0 );

/**
 * Moving people receive the same fixtures and measured bounce as the room
 * they occupy. The normal scene lighting remains in place for street actors.
 * A texture carries the room per instance without spending another vertex
 * buffer on the crowd, whose dressed body already uses WebGPU's eight slots.
 */
export class ActorLighting {

	constructor( roomLights, rooms ) {

		this.rooms = rooms;
		this.materials = new WeakMap();
		this.node = new ActorRoomNode( roomLights );

	}

	fillAt( position ) {

		return this.rooms().find( ( room ) => room.holds( position ) )?.fill ?? DARK;

	}

	/** Clones once, retaining the original actor maps and garment/pose nodes. */
	materialFor( source ) {

		let material = this.materials.get( source );
		if ( material ) return material;
		material = ( source.isMeshPhysicalMaterial
			? new THREE.MeshPhysicalNodeMaterial()
			: new THREE.MeshStandardNodeMaterial() ).copy( source );
		material.alphaTest = source.alphaTest;
		material.name = `${source.name || 'actor'}|rooms`;
		// Keep the renderer's Dynamic/Clustered lighting node. Its ordinary
		// setupMaterialLightings hook is not consumed by the WebGL batching
		// backend, so add these sources at the shared lighting-model boundary.
		material.actorRoomNode = this.node;
		const lightingModel = material.setupLightingModel;
		material.setupLightingModel = function ( builder ) {

			const model = lightingModel.call( this, builder );
			const indirect = model.indirect;
			model.indirect = ( inner ) => {

				this.actorRoomNode.build( inner );
				indirect.call( model, inner );

			};
			return model;

		};
		this.materials.set( source, material );
		this.materials.set( material, material );
		return material;

	}

	attach( mesh, capacity = 1, channel = new FillChannel( capacity ) ) {

		channel.attach( mesh );
		mesh.material = Array.isArray( mesh.material )
			? mesh.material.map( ( material ) => this.materialFor( material ) )
			: this.materialFor( mesh.material );
		return channel;

	}

	write( mesh, slot, fill ) {

		FillChannel.of( mesh )?.set( slot, fill );

	}

	/** Body, eyes and rigid hair share one person's texel, even across wardrobe reuse. */
	attachRoot( root, position ) {

		const channel = new FillChannel( 1 );
		root.userData.actorFill = channel;
		root.traverse( ( node ) => { if ( node.isMesh ) this.attach( node, 1, channel ); } );
		this.writeRoot( root, position );

	}

	writeRoot( root, position ) {

		root.userData.actorFill?.set( 0, this.fillAt( position ) );

	}

	releaseRoot( root ) {

		root.userData.actorFill?.dispose();
		delete root.userData.actorFill;
		root.traverse( ( node ) => { delete node[ FILL_CHANNEL ]; } );

	}

}

/** Stable room fixture nodes, applied only to actors inside a published room. */
class ActorRoomNode extends THREE.LightingNode {

	static get type() { return 'ActorRoomNode'; }

	constructor( roomLights ) {

		super();
		this.fixtures = [
			...roomLights.spots.map( ( light ) => new THREE.SpotLightNode( light ) ),
			...roomLights.strips.map( ( light ) => new THREE.RectAreaLightNode( light ) )
		];
		this.fill = new RoomFillNode();

	}

	setup( builder ) {

		const fill = roomFillValue( builder.object, builder );
		if ( ! fill ) return;
		builder.context.reflectedLight.directDiffuse.toStack();
		builder.context.reflectedLight.directSpecular.toStack();
		builder.context.irradiance.toStack();
		If( fill.x.add( fill.y ).add( fill.z ).greaterThan( 0 ), () => {

			for ( const fixture of this.fixtures ) fixture.build( builder );
			this.fill.build( builder );

		} );

	}

}
