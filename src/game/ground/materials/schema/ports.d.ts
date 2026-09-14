import type { BufferGeometry, Material, Texture } from 'three/webgpu';

export interface NativeTextureDefinition {
	path: string;
	resolution: [number, number];
	sha256: string;
	colorSpace: 'srgb' | 'linear';
	wrap: ['repeat' | 'clamp', 'repeat' | 'clamp'];
}
export interface NativeTextureResource {
	texture: Texture;
	/** Rejects on missing maps, decode failure or failed budgeting. */
	ready: Promise<void>;
}
/** Receives a validated theme-relative path and its complete published definition. */
export type NativeTexturePort = (id: string, themePath: string, definition: NativeTextureDefinition) => NativeTextureResource;
export interface NativeMaterialOptions { roadRoughness?: number }
export declare const MATERIAL_RESOURCES: unique symbol;
export type NativeStreetMaterial = Material & { readonly [MATERIAL_RESOURCES]: readonly NativeTextureResource[] };
export interface NativeStreetMaterialPort {
	build(surfaceId: string, options?: NativeMaterialOptions): NativeStreetMaterial;
	resources(material: Material): readonly NativeTextureResource[];
	assertGeometry(material: Material, geometry: BufferGeometry): void;
	dispose(): void;
}
