import { Parts } from './Geometry.js';

/** Physical corner castings, ribs and locking rods over the imported case. */
export class CargoDetails {
	static build( [ w, h, d ], material ) {
		const p = new Parts();
		for ( const x of [ - 1, 1 ] ) {
			for ( const y of [ 0.075, h - 0.075 ] ) p.box( 'paint', [ 0.11, 0.15, d ], [ x * w / 2, y, 0 ] );
			for ( const z of [ - 1, 1 ] ) {
				p.box( 'paint', [ 0.14, h, 0.14 ], [ x * w / 2, h / 2, z * d / 2 ] );
				for ( const y of [ 0.08, h - 0.08 ] ) p.box( 'metal', [ 0.17, 0.16, 0.17 ], [ x * w / 2, y, z * d / 2 ] );
			}
			for ( let z = - d / 2 + 0.32; z < d / 2 - 0.2; z += 0.28 ) p.box( 'paint', [ 0.045, h - 0.32, 0.075 ], [ x * ( w / 2 + 0.015 ), h / 2, z ] );
		}
		for ( const z of [ - 1, 1 ] ) {
			for ( const y of [ 0.075, h - 0.075 ] ) p.box( 'paint', [ w, 0.15, 0.10 ], [ 0, y, z * d / 2 ] );
			p.box( 'metal', [ 0.022, h - 0.3, 0.018 ], [ 0, h / 2, z * ( d / 2 + 0.018 ) ] );
		}
		for ( const x of [ - 0.7, - 0.35, 0.35, 0.7 ] ) {
			p.box( 'metal', [ 0.025, h - 0.28, 0.025 ], [ x, h / 2, d / 2 + 0.046 ] );
			p.box( 'metal', [ 0.18, 0.03, 0.045 ], [ x + 0.06, h * 0.38, d / 2 + 0.05 ] );
		}
		return p.finish( material );
	}
}
