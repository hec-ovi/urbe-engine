import type { NativeStreetManifest } from '../../../../../../streets/src/schema/native-result.ts';
import type { CityBlueprint } from '../../../../../../atlas/schema/blueprint.ts';

export interface WorldStreetReference {
	file: 'streets/manifest.json';
	sha256: string;
	kitSha256: string;
	blueprintSha256: string;
}
export interface NativeSourceOptions {
	baseUrl: string;
	reference: WorldStreetReference;
	blueprint: { bytes: ArrayBuffer; data: CityBlueprint };
	fetch?: typeof globalThis.fetch;
}
export interface NativeStreetSource {
	readonly manifest: Readonly<NativeStreetManifest>;
	readPiece(id: string, signal?: AbortSignal): Promise<ArrayBuffer>;
	/** Ground-only projection; original Atlas data stays unchanged. */
	retainedAtlas(): CityBlueprint;
	dispose(): void;
}
