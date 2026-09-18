import type { BufferGeometry, Material, Node, Texture } from 'three/webgpu';

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
/** What one copy asks for itself, as nodes the caller's own per instance table answers with. */
export interface NativeInstanceValues {
	tint: Node;
	wear: Node;
	scan?: { offset: Node; scale: Node };
	text?: { count: Node; glyph: (index: Node) => Node };
}
export interface NativeMaterialOptions {
	roadRoughness?: number;
	instances?: NativeInstanceValues;
	/** The four surfaces whose maps the scan quad picks between; needs `instances.scan`. */
	scanCells?: string[];
}
export interface NativeTextureSourceOptions {
	baseUrl?: string;
	fetch?: typeof globalThis.fetch;
	decode?: (bytes: ArrayBuffer) => Promise<TexImageSource>;
	prepareTexture?: (texture: Texture) => void | Promise<void>;
	anisotropy?: number;
}
export declare const MATERIAL_RESOURCES: unique symbol;
export type NativeStreetMaterial = Material & { readonly [MATERIAL_RESOURCES]: readonly NativeTextureResource[] };
export interface NativeStreetMaterialPort {
	build(surfaceId: string, options?: NativeMaterialOptions): NativeStreetMaterial;
	resources(material: Material): readonly NativeTextureResource[];
	assertGeometry(material: Material, geometry: BufferGeometry): void;
	dispose(): void;
}
