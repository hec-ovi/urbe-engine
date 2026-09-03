const BODY_ASSETS = new Map( [
	[ '/models/universal-base-characters-source/Regular_Male_FullBody.gltf', {
		assetId: 'source-regular-male-full-body', mediaType: 'model/gltf+json', byteSize: 30161,
		checksum: 'sha256:c5c901b24dfc1a4f22e65c16abc0ea8b0a2791498f1c6475d017921320ce9dc3'
	} ],
	[ '/models/universal-base-characters-source/Regular_Female_FullBody.gltf', {
		assetId: 'source-regular-female-full-body', mediaType: 'model/gltf+json', byteSize: 30959,
		checksum: 'sha256:d952b4e9d782533a837071ec23f25599232f033d3b01d257f280dbf6c917220a'
	} ]
] );

export const INVESTIGATION_ANIMATION_ASSET = Object.freeze( {
	uri: '/models/universal-animation-library-pro/UAL1.glb',
	mediaType: 'model/gltf-binary',
	byteSize: 21378992,
	checksum: 'sha256:d1cb4537efa4c06a953ca951e5935062f88c2580ac68e45045592d587bddb43d'
} );

export function assertProductionBody( body ) {

	const expected = BODY_ASSETS.get( body.asset.uri );
	if ( ! expected || ! sameReference( body.asset, expected ) ) throw new Error( `${body.entityId} does not reference an audited Source body` );
	if ( ! sameReference( body.animationAsset, INVESTIGATION_ANIMATION_ASSET ) ) throw new Error( `${body.entityId} does not reference the audited Pro animation library` );
	if ( ! [ 'Death01', 'Death02' ].includes( body.poseId ) ) throw new Error( `${body.entityId} does not name an audited final pose` );
	if ( body.sourceMaterialPolicy !== 'original-source-textures' ) throw new Error( `${body.entityId} does not preserve Source textures` );

}

function sameReference( actual, expected ) {

	return actual && [ 'assetId', 'uri', 'mediaType', 'byteSize', 'checksum' ]
		.filter( ( key ) => expected[ key ] !== undefined )
		.every( ( key ) => actual[ key ] === expected[ key ] );

}
