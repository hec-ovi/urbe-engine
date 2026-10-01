import { Color, LinearSRGBColorSpace, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2 } from 'three';

const CHANNELS = { basecolor: 'map', normal: 'normalMap', roughness: 'roughnessMap', metallic: 'metalnessMap', ao: 'aoMap' };
const digest = async ( bytes ) => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

/** Review-only PNG master loader. Production native asphalt remains delegated. */
export async function loadHighwayReviewMaterials( origin, progress = () => {} ) {

	const base = new URL( origin.endsWith( '/' ) ? origin : origin + '/' );
	const bindingUrl = new URL( 'bindings/highway-materials.json', base );
	const response = await fetch( bindingUrl, { cache: 'no-store' } );
	if ( ! response.ok ) throw new Error( 'Highway binding HTTP ' + response.status );
	const binding = await response.json();
	if ( binding.version !== 1 || binding.scalarMaps !== 'absolute-linear-values'
		|| binding.placementWeathering?.mode !== 'disabled-until-owner-coordinates' ) throw new Error( 'Unsupported highway material contract' );
	const textures = new Map(), materials = new Map(), verified = new Map();
	const loader = new TextureLoader();
	let decoded = 0;
	const load = ( id, worldSize ) => {

		const cacheKey = id + '|' + worldSize.join( ',' );
		if ( textures.has( cacheKey ) ) return textures.get( cacheKey );
		const pending = ( async () => {

			const definition = binding.textures[ id ];
			if ( ! definition || ! /^themes\/[a-z0-9_-]+\/assets\/[a-zA-Z0-9_/-]+\.png$/.test( definition.path )
				|| definition.path.includes( '..' ) ) throw new Error( 'Invalid texture path: ' + id );
			const url = new URL( definition.path, base );
			const response = await fetch( url, { cache: 'no-store' } );
			if ( ! response.ok ) throw new Error( id + ': HTTP ' + response.status );
			const bytes = await response.arrayBuffer();
			if ( await digest( bytes ) !== definition.sha256 ) throw new Error( id + ': served PNG differs from binding hash' );
			const blob = URL.createObjectURL( new Blob( [ bytes ], { type: 'image/png' } ) );
			let texture;
			try { texture = await loader.loadAsync( blob ); } finally { URL.revokeObjectURL( blob ); }
			if ( texture.image.width !== definition.resolution[ 0 ] || texture.image.height !== definition.resolution[ 1 ] ) throw new Error( id + ': decoded dimensions differ' );
			texture.name = id;
			texture.colorSpace = definition.colorSpace === 'srgb' ? SRGBColorSpace : NoColorSpace;
			texture.wrapS = texture.wrapT = RepeatWrapping;
			texture.repeat.set( 1 / worldSize[ 0 ], 1 / worldSize[ 1 ] );
			texture.anisotropy = 2;
			texture.userData.highwayTexture = { id, path: definition.path, sha256: definition.sha256, worldSize: [ ...worldSize ] };
			verified.set( id, { path: definition.path, sha256: definition.sha256, resolution: definition.resolution } );
			progress( ++ decoded );
			return texture;

		} )();
		textures.set( cacheKey, pending );
		return pending;

	};
	await Promise.all( Object.entries( binding.slots ).map( async ( [ slot, definition ] ) => {

		const tune = definition.tuning;
		const maps = {};
		await Promise.all( Object.entries( CHANNELS ).map( async ( [ channel, property ] ) => {

			const id = definition.maps[ channel ];
			if ( id ) maps[ property ] = await load( id, definition.sampling.worldSize );

		} ) );
		const material = new MeshStandardMaterial( {
			...maps, color: new Color().setRGB( ...tune.colorGain, LinearSRGBColorSpace ),
			roughness: tune.roughnessFactor, metalness: tune.metalnessFactor,
			normalScale: new Vector2( ...tune.normalScale ), aoMapIntensity: tune.aoIntensity
		} );
		material.name = 'highway-pbr:' + slot;
		material.userData = { highwayContentSlot: slot, highwayMaterialSource: definition.source,
			highwaySampling: definition.sampling, highwayTuning: tune, reviewOnly: true };
		materials.set( slot, material );

	} ) );
	return {
		binding, bindingUrl: bindingUrl.href, materials,
		report: {
			origin: base.href, bindingUrl: bindingUrl.href, slots: materials.size, decodedTextures: decoded,
			verifiedTextures: Object.fromEntries( verified ), format: 'verified PNG masters',
			placementWeathering: 'disabled: no ownership coordinates assumed',
			roadwayPreview: 'direct native asphalt maps using temporary world-XZ UVs; native anti-repetition/wear shader remains delegated; no variant selector',
			visualAcceptance: false
		},
		dispose() {
			materials.forEach( ( material ) => material.dispose() );
			textures.forEach( ( pending ) => pending.then( ( texture ) => texture.dispose() ) );
		}
	};

}
