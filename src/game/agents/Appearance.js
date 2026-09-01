import * as THREE from 'three/webgpu';

// Multipliers over the pack's own skin map, not colours of their own: the map
// already carries a mid tan, so a tone lifts it or deepens it.
const SKIN = [
	0xffffff, 0xf6e0cc, 0xefd0b4, 0xe2c1a2,
	0xc79f7c, 0xa87c58, 0x86603f, 0x63452c
];

// Street clothes at night: mid-toned, because darker than this is a black smear
// under a lamp and lighter reads as a hi-vis vest. None of them is anywhere
// near a skin tone, which is what keeps a shirt from reading as a bare chest.
const SHIRT = [
	0x4f5d75, 0x8c4a53, 0x3f6b57, 0x5d4a7a, 0x9a6b3a, 0x546374,
	0x7a4470, 0x36657a, 0x6b6f52, 0x4a4f57, 0x8a8f99, 0x2f3b4a
];

const TROUSERS = [
	0x2f3440, 0x3a3630, 0x24303a, 0x403038,
	0x2a2a2a, 0x38404a, 0x4a4038, 0x1f2630
];

const HAIR = [
	0x1b1310, 0x2e1f16, 0x4a3220, 0x6b4a2c,
	0x8f7048, 0xb59a6a, 0x6e6a66, 0xa8a29a
];

// Where a sleeve ends along the arm and a leg ends down the leg. Repeats are
// how a street at night comes out mostly in sleeves and trousers with a few
// bare arms in it, rather than a quarter of the city in shorts.
const SLEEVE = [ 0.34, 0.55, 0.55, 0.86, 0.86, 0.86 ];
const HEM = [ 0.62, 0.88, 0.88, 0.88, 0.88, 0.88 ];

/**
 * One person's look, decided once from their id and never again, so the same
 * NPC is the same person every time the street is walked. Each choice reads a
 * different slice of the same hash, so hair, skin and clothes do not move in
 * lockstep across the crowd.
 *
 * @param seed the 32-bit hash of the person's crowd id
 */
export function look( seed ) {

	return {
		skin: pick( SKIN, seed ),
		shirt: pick( SHIRT, seed >>> 3 ),
		trousers: pick( TROUSERS, seed >>> 7 ),
		hair: pick( HAIR, seed >>> 11 ),
		sleeve: SLEEVE[ ( seed >>> 15 ) % SLEEVE.length ],
		hem: HEM[ ( seed >>> 19 ) % HEM.length ]
	};

}

function pick( palette, seed ) {

	return new THREE.Color( palette[ seed % palette.length ] );

}
