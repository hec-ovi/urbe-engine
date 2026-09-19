/** Why a quest target cannot be used right now, in the words the player reads. */

const MESSAGES = {
	role_dead: 'The person required by this objective is dead.',
	not_present: 'The person required by this objective is not available.',
	off_duty: 'The person required by this objective is not at the target location now.',
	outside_window: 'This objective is open at another hour.',
	missing_item: 'The required item is not in your inventory.',
	condition: 'The quest conditions for this action are not met.',
	target_missing: 'The quest target has no valid world location.'
};

/**
 * @param reason the runtime's closed availability reason
 * @param window the hour the step's own text names, when it has one
 */
export function unavailableMessage( reason, window = null ) {

	const message = MESSAGES[ reason ] ?? 'The quest target is unavailable.';
	if ( ! Number.isFinite( window?.startMin ) || ! Number.isFinite( window?.endMin ) ) return message;
	return `${message} Open ${clock( window.startMin )} to ${clock( window.endMin )}.`;

}

function clock( minuteOfDay ) {

	const hours = Math.floor( minuteOfDay / 60 ) % 24;
	return `${String( hours ).padStart( 2, '0' )}:${String( minuteOfDay % 60 ).padStart( 2, '0' )}`;

}
