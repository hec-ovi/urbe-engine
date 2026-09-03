const SEGMENT = ( clipName, loop, role, blendMs = 160 ) => Object.freeze( {
	clipName,
	loop,
	role,
	blendMs
} );

const PLANS = Object.freeze( {
	idle: Object.freeze( {
		action: 'idle',
		posture: 'standing',
		completion: 'explicit',
		start: [ SEGMENT( 'Idle_Loop', true, 'action' ) ],
		exit: []
	} ),
	sit: Object.freeze( {
		action: 'sit',
		posture: 'seated',
		completion: 'explicit',
		start: [ SEGMENT( 'Sitting_Enter', false, 'entry' ), SEGMENT( 'Sitting_Idle_Loop', true, 'action' ) ],
		exit: [ SEGMENT( 'Sitting_Exit', false, 'exit' ) ]
	} ),
	'pickup-ground': Object.freeze( {
		action: 'pickup',
		posture: 'standing',
		completion: 'clip-end',
		start: [ SEGMENT( 'PickUp_Kneeling', false, 'action' ) ],
		exit: []
	} ),
	'pickup-table': Object.freeze( {
		action: 'pickup',
		posture: 'standing',
		completion: 'clip-end',
		start: [ SEGMENT( 'PickUp_Table', false, 'action' ) ],
		exit: []
	} ),
	read: Object.freeze( {
		action: 'read',
		posture: 'standing',
		completion: 'clip-end',
		start: [ SEGMENT( 'Idle_Paper', false, 'action' ) ],
		exit: []
	} ),
	observe: Object.freeze( {
		action: 'observe',
		posture: 'standing',
		completion: 'explicit',
		start: [ SEGMENT( 'Idle_LookAround_Loop', true, 'action' ) ],
		exit: []
	} ),
	'steal-ground': Object.freeze( {
		action: 'steal',
		posture: 'standing',
		completion: 'clip-end',
		start: [ SEGMENT( 'PickUp_Kneeling', false, 'action' ) ],
		exit: []
	} ),
	'steal-table': Object.freeze( {
		action: 'steal',
		posture: 'standing',
		completion: 'clip-end',
		start: [ SEGMENT( 'PickUp_Table', false, 'action' ) ],
		exit: []
	} ),
	'work-counter': Object.freeze( {
		action: 'work',
		posture: 'standing',
		completion: 'explicit',
		start: [ SEGMENT( 'Counter_Enter', false, 'entry' ), SEGMENT( 'Counter_Idle_Loop', true, 'action' ) ],
		exit: [ SEGMENT( 'Counter_Exit', false, 'exit' ) ]
	} ),
	'work-repair': Object.freeze( {
		action: 'work',
		posture: 'kneeling',
		completion: 'clip-end',
		start: [ SEGMENT( 'Fixing_Kneeling', false, 'action' ) ],
		exit: []
	} ),
	'work-interact': Object.freeze( {
		action: 'work',
		posture: 'standing',
		completion: 'clip-end',
		start: [ SEGMENT( 'Interact', false, 'action' ) ],
		exit: []
	} ),
	deliver: Object.freeze( {
		action: 'deliver',
		posture: 'standing',
		completion: 'clip-end',
		start: [ SEGMENT( 'Counter_Give', false, 'action' ) ],
		exit: []
	} ),
	'follow-walk': Object.freeze( {
		action: 'follow-walk',
		posture: 'standing',
		completion: 'explicit',
		start: [ SEGMENT( 'Walk_Loop', true, 'action' ) ],
		exit: []
	} ),
	'follow-sprint': Object.freeze( {
		action: 'follow-sprint',
		posture: 'standing',
		completion: 'explicit',
		start: [ SEGMENT( 'Sprint_Enter', false, 'entry' ), SEGMENT( 'Sprint_Loop', true, 'action' ) ],
		exit: [ SEGMENT( 'Sprint_Exit', false, 'exit' ) ]
	} ),
	'crouch-idle': Object.freeze( {
		action: 'crouch',
		posture: 'crouched',
		completion: 'explicit',
		start: [ SEGMENT( 'Crouch_Enter', false, 'entry' ), SEGMENT( 'Crouch_Idle_Loop', true, 'action' ) ],
		exit: [ SEGMENT( 'Crouch_Exit', false, 'exit' ) ]
	} ),
	'crouch-forward': Object.freeze( {
		action: 'crouch',
		posture: 'crouched',
		completion: 'explicit',
		start: [ SEGMENT( 'Crouch_Enter', false, 'entry' ), SEGMENT( 'Crouch_Fwd_Loop', true, 'action' ) ],
		exit: [ SEGMENT( 'Crouch_Exit', false, 'exit' ) ]
	} )
} );

const DIALOGUE = Object.freeze( {
	standing: Object.freeze( {
		talk: SEGMENT( 'Idle_Talking_Loop', true, 'action' ),
		listen: SEGMENT( 'Idle_Loop', true, 'action' )
	} ),
	seated: Object.freeze( {
		talk: SEGMENT( 'Sitting_Talking_Loop', true, 'action' ),
		listen: SEGMENT( 'Sitting_Nodding_Loop', true, 'action' )
	} )
} );

export const REQUIRED_CLIPS = Object.freeze( [
	'Counter_Enter',
	'Counter_Exit',
	'Counter_Give',
	'Counter_Idle_Loop',
	'Crouch_Enter',
	'Crouch_Exit',
	'Crouch_Fwd_Loop',
	'Crouch_Idle_Loop',
	'Fixing_Kneeling',
	'Idle_LookAround_Loop',
	'Idle_Loop',
	'Idle_Paper',
	'Idle_Talking_Loop',
	'Interact',
	'PickUp_Kneeling',
	'PickUp_Table',
	'Sitting_Enter',
	'Sitting_Exit',
	'Sitting_Idle_Loop',
	'Sitting_Nodding_Loop',
	'Sitting_Talking_Loop',
	'Sprint_Enter',
	'Sprint_Exit',
	'Sprint_Loop',
	'Walk_Loop'
] );

export function actionPlan( variant ) {

	return copyPlan( PLANS[ variant ] ?? null );

}

export function dialoguePlan( role, posture ) {

	const segment = DIALOGUE[ posture ]?.[ role ];
	if ( ! segment ) return null;
	return {
		action: role,
		posture,
		completion: 'explicit',
		start: [ { ...segment } ],
		exit: []
	};

}

export function neutralSegment( posture ) {

	if ( posture === 'seated' ) return SEGMENT( 'Sitting_Idle_Loop', true, 'neutral' );
	if ( posture === 'crouched' ) return SEGMENT( 'Crouch_Idle_Loop', true, 'neutral' );
	return { ...DIALOGUE.standing.listen, role: 'neutral' };

}

export function requirementsReport() {

	return {
		version: '1',
		assetId: 'quaternius-universal-animation-library-pro',
		edition: 'Pro',
		requiredClips: [ ...REQUIRED_CLIPS ]
	};

}

function copyPlan( plan ) {

	if ( ! plan ) return null;
	return {
		...plan,
		start: plan.start.map( ( segment ) => ( { ...segment } ) ),
		exit: plan.exit.map( ( segment ) => ( { ...segment } ) )
	};

}
