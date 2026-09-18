// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { PbrMaterialFactory } from './PbrMaterialFactory.js';
import { TextureSource } from './TextureSource.js';

const fakeTextures = ( load ) => new TextureSource( {
	images: { load: ( url, onLoad, onProgress, onError ) => load( url, onLoad, onError ) },
	ktx2: { load() {}, detectSupport() {}, dispose() {} }
} );

const entry = ( emissiveStrength ) => ( {
	alignment: 'tile',
	tiling: { worldSize: [ 1, 1 ] },
	physical: { emissiveStrength, roughnessFactor: 1, metallicFactor: 0 },
	variants: [ { id: 'lamp', maps: {
		basecolor: 'a.png', normal: 'n.png', roughness: 'r.png', metallic: 'm.png', ao: 'o.png', emission: 'e.png'
	} } ]
} );

const factoryFor = ( strength, profile ) => new PbrMaterialFactory( {
	resolve: ( key ) => ( key.startsWith( 'known' ) ? entry( strength ) : null ),
	mapUrl: ( theme, path ) => `/materials/${theme}/${path}`
}, profile );

function surfaceFactory( profile ) {

	return new PbrMaterialFactory( {
		resolve: () => ( { ...entry( 1 ), physical: { roughnessFactor: 0.64, metallicFactor: 0.35 } } ),
		mapUrl: ( theme, path ) => `/materials/${theme}/${path}`
	}, profile );

}

/**
 * The look is graded against how bright a lamp lens reads on screen. That level
 * has to survive a materials release re-authoring the map's own strength, which
 * is exactly what happened when the light-fixture family went from 3 to 1.2 and
 * every fixture in the city would otherwise have gone dim.
 */
describe( 'PbrMaterialFactory', () => {

	it( 'preserves absolute surface maps, their linear channels, the quality profile and the shader each surface needs', () => {

		const material = surfaceFactory().build( 'known/metal/mid' );

		expect( material.roughness ).toBe( 1 );
		expect( material.metalness ).toBe( 1 );
		for ( const texture of [ material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap ] ) {

			expect( texture.colorSpace ).toBe( THREE.NoColorSpace );
			expect( texture.channel ).toBe( 0 );
			expect( texture.flipY ).toBe( false );

		}
		expect( material.map.colorSpace ).toBe( THREE.SRGBColorSpace );
		expect( material.emissiveMap.colorSpace ).toBe( THREE.SRGBColorSpace );

		const scalar = surfaceFactory( { materialMaps: [] } ).build( 'known/metal/mid' );
		expect( scalar.roughness ).toBe( 0.64 );
		expect( scalar.metalness ).toBe( 0.35 );

		const limited = factoryFor( 3, {
			materialMaps: [ 'basecolor', 'normal', 'emission' ], textureAnisotropy: 2
		} ).build( 'known/wall/mid' );
		expect( limited.map.anisotropy ).toBe( 2 );
		expect( limited.normalMap ).toBeTruthy();
		expect( limited.emissiveMap ).toBeTruthy();
		expect( limited.roughnessMap ).toBeNull();
		expect( limited.metalnessMap ).toBeNull();
		expect( limited.aoMap ).toBeNull();

		const transmissive = new PbrMaterialFactory( {
			resolve: ( key ) => ( {
				...entry( 1 ),
				physical: { ...entry( 1 ).physical, transmission: key.includes( 'glass' ) ? 0.8 : 0 }
			} ),
			mapUrl: ( theme, path ) => `/materials/${theme}/${path}`
		}, { materialMaps: [] } );
		expect( transmissive.build( 'known/wall/mid' ).type ).toBe( 'MeshStandardMaterial' );
		expect( transmissive.build( 'known/glass/mid' ).type ).toBe( 'MeshPhysicalMaterial' );
		expect( transmissive.build( 'known/glass/mid' ).transmission ).toBeCloseTo( 0.8 );

	} );

	it( 'settles readiness on a failed map load and falls back to catalog scalars, including cached tuned copies', async () => {

		const factory = surfaceFactory( { materialMaps: [ 'roughness', 'metallic' ] } );
		factory.textures = fakeTextures( ( url, onLoad, onError ) => {

			const texture = new THREE.Texture();
			queueMicrotask( () => onError( new Error( 'decode failed' ) ) );
			return texture;

		} );
		const base = factory.build( 'known/metal/mid' );
		const copy = factory.variant( 'known/metal/mid', { side: THREE.DoubleSide } );
		await Promise.all( [ base.roughnessMap, base.metalnessMap ].map( ( map ) => map[ Symbol.for( 'urbe.texture-ready' ) ] ) );

		for ( const material of [ base, copy ] ) {

			expect( material.roughnessMap ).toBeNull();
			expect( material.metalnessMap ).toBeNull();
			expect( material.roughness ).toBe( 0.64 );
			expect( material.metalness ).toBe( 0.35 );

		}
		expect( factory.variant( 'known/metal/mid', { side: THREE.DoubleSide } ) ).toBe( copy );

	} );

	it( 'takes emission as authored or scaled, fits decals on receiver depth, and names what it cannot serve', () => {

		expect( factoryFor( 3 ).variant( 'known/light-fixture/mid', { emissiveLevel: 180 } ).emissiveIntensity ).toBe( 180 );
		expect( factoryFor( 1.2 ).variant( 'known/light-fixture/mid', { emissiveLevel: 180 } ).emissiveIntensity ).toBe( 180 );
		expect( factoryFor( 2.5 ).variant( 'known/signage/mid', { emissiveScale: 26 } ).emissiveIntensity ).toBe( 65 );

		const unresolved = factoryFor( 3 ).build( 'unknown/brand/none' );
		expect( unresolved.name ).toBe( 'unresolved:unknown/brand/none' );
		expect( unresolved.color.getHex() ).toBe( 0xff00ff );

		const decal = new PbrMaterialFactory( {
			resolve: () => ( {
				alignment: 'exact', aspect: [ 2, 1 ],
				decal: { worldSize: [ 2, 1 ], edgeInset: 0.02, surfaceOffset: 0.002 },
				physical: { alphaMode: 'BLEND', roughnessFactor: 0.8, metallicFactor: 0 },
				variants: [ { id: 'runoff', maps: { basecolor: 'grime-rgba.png', opacity: 'opacity.png' } } ]
			} ),
			mapUrl: ( theme, path ) => `/materials/${theme}/${path}`
		}, { materialMaps: [ 'basecolor' ] } ).build( 'cyberpunk/window-grime-sill/poor', 'runoff' );

		expect( decal.transparent ).toBe( true );
		expect( decal.depthWrite ).toBe( false );
		expect( decal.depthTest ).toBe( true );
		expect( decal.map.wrapS ).toBe( THREE.ClampToEdgeWrapping );
		expect( decal.map.repeat.toArray() ).toEqual( [ 1, 1 ] );
		expect( decal.alphaMap ).toBeNull();
		expect( factoryFor( 1 ).build( 'known/wall/mid' ).depthWrite ).toBe( true );

	} );

} );
