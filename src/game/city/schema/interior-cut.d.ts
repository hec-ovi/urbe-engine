/** Structured-clone worker payload; geometry arrays view one transferable buffer. */
export interface InteriorSurface {
	key: string;
	sourceId?: string;
	position: Float32Array;
	normal: Float32Array;
	uv: Float32Array;
	attributes?: Record<string, { array: Float32Array; itemSize: number }>;
	area: number;
	floorArea: number;
}

export interface InteriorOutline {
	floor: number;
	elevation: number;
	height: number;
	rooms: { id: string; kind: string; polygon: [number, number][]; holes?: [number, number][][] }[];
}

/** Three material/texture JSON plus exact linear colors and decoded image sources. */
export interface InteriorMaterialPacket {
	materials: { uuid: string; type: string; linearColors: Record<string, [number, number, number]>; [property: string]: unknown }[];
	textures: { uuid: string; image: string; matrix: number[]; matrixAutoUpdate: boolean; [property: string]: unknown }[];
	images: { uuid: string; data: ImageBitmap | { data: ArrayBufferView; width: number; height: number } | null }[];
}

export interface InteriorCut {
	data: Float32Array;
	rooms: (InteriorOutline['rooms'][number] & {
		floor: number; elevation: number; height: number;
		center: [number, number, number]; surfaces: InteriorSurface[];
	})[];
	shared: { floor: number; surfaces: InteriorSurface[] }[];
	materials?: InteriorMaterialPacket;
}

export interface InteriorWorkerRequest { id: number; url: string; outlines: InteriorOutline[] }
export type InteriorWorkerResult = { id: number; cut: InteriorCut; bytes: number; cost: Record<string, number> } | { id: number; error: string };
