import { MeshVariant } from './MeshVariant.js';
import { BatchedVariant } from './BatchedVariant.js';
import { IndirectVariant } from './IndirectVariant.js';

export const VARIANTS = [
	{ id: 'mesh', label: 'A: one Mesh per building', backends: [ 'webgpu', 'webgl' ], ctor: MeshVariant },
	{ id: 'batched', label: 'B: BatchedMesh', backends: [ 'webgpu', 'webgl' ], ctor: BatchedVariant },
	{ id: 'indirect', label: 'C: instanced + compute cull/LOD + indirect', backends: [ 'webgpu' ], ctor: IndirectVariant }
];

export function createVariant( id ) {

	const entry = VARIANTS.find( ( v ) => v.id === id );
	if ( ! entry ) throw new Error( `Unknown variant: ${ id }` );
	return new entry.ctor();

}
