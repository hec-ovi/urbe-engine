import { Group } from 'three/webgpu';
import { GroundBuilder } from './GroundBuilder.js';
import { NativeTextureSource } from './materials/NativeTextureSource.js';
import { NativeStreetMaterials } from './materials/NativeStreetMaterials.js';
import { NativeStreetStream } from './native-stream/NativeStreetStream.js';
import { GroundOpenings } from './GroundOpenings.js';

/** Coordinates native ordinary streets with the retained authored infrastructure. */
export class GroundScene {
	constructor( atlas, factory, nativeSource = null, textureOptions = {}, buildingSources = {} ) {
		this.group = new Group(); this.group.name = 'ground';
		this.retained = new GroundBuilder( nativeSource?.retainedAtlas() ?? atlas, factory, { openings: new GroundOpenings( buildingSources ) } ).stream();
		this.streams = [ this.retained ];
		if ( nativeSource ) {
			this.textures = new NativeTextureSource( textureOptions );
			this.materials = new NativeStreetMaterials( nativeSource.manifest.materials.binding,
				( id, path, definition ) => this.textures.load( id, path, definition ) );
			this.native = new NativeStreetStream( nativeSource, this.materials );
			this.streams.push( this.native );
		}
		this.group.add( ...this.streams.map( stream => stream.group ) );
		this.bounds = {
			min: [ 0, 1 ].map( i => Math.min( ...this.streams.map( stream => stream.bounds.min[ i ] ) ) ),
			max: [ 0, 1 ].map( i => Math.max( ...this.streams.map( stream => stream.bounds.max[ i ] ) ) )
		};
	}
	async update( position, settings ) {
		for ( const stream of this.streams ) await stream.update( position, settings );
	}
	get stats() {
		return this.streams.map( stream => stream.stats ).reduce( ( total, item ) => ( {
			indexed: total.indexed + item.indexed, resident: total.resident + item.resident,
			wanted: total.wanted + item.wanted, collision: total.collision + item.collision, pending: total.pending || item.pending
		} ), { indexed: 0, resident: 0, wanted: 0, collision: 0, pending: false } );
	}
	dispose() {
		for ( const stream of this.streams ) stream.dispose();
		this.materials?.dispose(); this.textures?.dispose(); this.group.removeFromParent();
	}
}
