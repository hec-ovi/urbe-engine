/**
 * Building archetypes: buildings sharing an archetype share one shell geometry
 * and, in the indirect variant, one instance buffer.
 * footprint/height are metre ranges, segments are box subdivisions (gives the
 * LOD chain something to simplify), weight drives the seeded pick.
 */
export const ARCHETYPES = [
	{ id: 'house', weight: 0.4, footprint: [ 8, 14 ], height: [ 6, 12 ], segments: [ 2, 2, 2 ], color: 0x9b8f7a },
	{ id: 'lowrise', weight: 0.3, footprint: [ 12, 18 ], height: [ 12, 28 ], segments: [ 3, 4, 3 ], color: 0x7d8894 },
	{ id: 'slab', weight: 0.2, footprint: [ 14, 20 ], height: [ 28, 60 ], segments: [ 4, 8, 4 ], color: 0x8a97a8 },
	{ id: 'tower', weight: 0.1, footprint: [ 10, 16 ], height: [ 60, 150 ], segments: [ 4, 12, 4 ], color: 0x6f7f95 }
];
