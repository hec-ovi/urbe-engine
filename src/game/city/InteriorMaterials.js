import * as THREE from 'three/webgpu';

/** Three's material/texture format, with decoded images transferred without re-encoding. */
export function materialPacketOf( materials ) {

	const meta = { textures: {}, images: {} };
	const textures = new Map();
	for ( const material of materials ) {

		for ( const texture of Object.values( material ).filter( value => value?.isTexture ) ) {

			const source = texture.source;
			meta.images[ source.uuid ] = { uuid: source.uuid, data: source.data };
			textures.set( texture.uuid, texture );

		}

	}
	const records = materials.map( material => ( {
		...material.toJSON( meta ),
		linearColors: Object.fromEntries( Object.entries( material ).filter( ( [ , value ] ) => value?.isColor ).map( ( [ name, color ] ) => [ name, color.toArray() ] ) )
	} ) );
	return {
		materials: records,
		textures: Object.values( meta.textures ).map( data => ( { ...data,
			matrix: textures.get( data.uuid ).matrix.toArray(), matrixAutoUpdate: textures.get( data.uuid ).matrixAutoUpdate } ) ),
		images: Object.values( meta.images )
	};

}

/** Unique transferable image storage; several maps may share the same source. */
export function materialBuffers( packet ) {

	return [ ...new Set( ( packet?.images ?? [] ).flatMap( ( { data } ) => {

		if ( ArrayBuffer.isView( data?.data ) ) return [ data.data.buffer ];
		if ( typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap ) return [ data ];
		return [];

	} ) ) ];

}

export function closeMaterialImages( packet ) {

	for ( const data of new Set( ( packet?.images ?? [] ).map( image => image.data ) ) ) data?.close?.();

}

/** One floor owns its source materials, maps, and all their room-light clones. */
export class InteriorMaterials {

	constructor( packet ) {

		this.packet = packet;
		this.textures = {};
		this.materials = new Map();
		try {

			const images = Object.fromEntries( ( packet?.images ?? [] ).map( image => [ image.uuid, new THREE.Source( image.data ) ] ) );
			this.textures = new THREE.ObjectLoader().parseTextures( packet?.textures, images );
			for ( const data of packet?.textures ?? [] ) {

				this.textures[ data.uuid ].matrix.fromArray( data.matrix );
				this.textures[ data.uuid ].matrixAutoUpdate = data.matrixAutoUpdate;

			}
			const loader = new THREE.MaterialLoader().setTextures( this.textures );
			for ( const data of packet?.materials ?? [] ) {

				const material = loader.parse( data );
				this.materials.set( data.uuid, material );
				for ( const [ name, color ] of Object.entries( data.linearColors ) ) material[ name ].fromArray( color );

			}

		} catch ( error ) {

			this.dispose();
			throw error;

		}

	}

	dispose( roomLights ) {

		roomLights?.releaseSources?.( this.materials.values() );
		for ( const material of this.materials.values() ) material.dispose();
		for ( const texture of Object.values( this.textures ) ) texture.dispose();
		closeMaterialImages( this.packet );
		this.materials.clear();
		this.textures = {};
		this.packet = null;

	}

}
