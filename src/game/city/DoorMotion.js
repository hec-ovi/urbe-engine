import { MathUtils } from 'three/webgpu';

/** Authored motion applied to the exact closed-pose leaf nodes. */
export class DoorMotion {

	constructor( definition ) {

		this.definition = definition ?? { kind: 'swing', maxTravel: 100 };
		this.kind = this.definition.kind;
		this.supported = this.kind === 'swing' || this.kind === 'pocket';
		if ( ! this.supported && this.kind !== 'roller' ) fail( 'unknown door mechanism' );
		if ( ! this.supported ) return;
		if ( ! Number.isFinite( this.definition.maxTravel ) || this.definition.maxTravel < 0 ) fail( 'invalid travel range' );
		if ( this.kind !== 'pocket' ) return;
		const leaves = this.definition.leaves;
		if ( ! Array.isArray( leaves ) || leaves.length < 1 || leaves.length > 2 ) fail( 'missing pocket leaves' );
		const indices = new Set();
		for ( const leaf of leaves ) {
			if ( ! Number.isInteger( leaf.leaf ) || leaf.leaf < 0 || leaf.leaf > 1 || indices.has( leaf.leaf ) ) fail( 'invalid leaf identity' );
			if ( ! Number.isFinite( leaf.travelU ) || leaf.travelU === 0 ) fail( 'invalid pocket travel' );
			indices.add( leaf.leaf );
		}
		if ( Math.abs( Math.max( ...leaves.map( leaf => Math.abs( leaf.travelU ) ) ) - this.definition.maxTravel ) > 1e-6 ) {
			fail( 'pocket travel does not match its published range' );
		}

	}

	prepare( leaf, along ) {

		leaf.closedPosition = leaf.pivot.position.clone();
		leaf.closedRotation = leaf.pivot.quaternion.clone();
		if ( this.kind !== 'pocket' ) return;
		const movement = this.definition.leaves.find( entry => entry.leaf === leaf.index );
		if ( ! movement ) fail( `no motion for leaf ${leaf.index}` );
		leaf.translation = along.clone().multiplyScalar( movement.travelU );

	}

	validateLeaves( leaves ) {

		if ( this.kind !== 'pocket' ) return;
		if ( leaves.length !== this.definition.leaves.length
			|| new Set( leaves.map( leaf => leaf.index ) ).size !== leaves.length ) fail( 'incomplete named pocket leaves' );

	}

	apply( leaves, fraction ) {

		for ( const leaf of leaves ) {
			leaf.pivot.position.copy( leaf.closedPosition );
			leaf.pivot.quaternion.copy( leaf.closedRotation );
			if ( this.kind === 'pocket' ) leaf.pivot.position.addScaledVector( leaf.translation, fraction );
			else if ( this.kind === 'swing' ) leaf.pivot.rotateY( leaf.sign * MathUtils.degToRad( this.definition.maxTravel ) * fraction );
		}

	}

}

function fail( reason ) {

	const error = new Error( `E_DOOR_MOTION: ${reason}` );
	error.code = 'E_DOOR_MOTION';
	throw error;

}
