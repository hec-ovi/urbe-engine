import { castIds } from '../quests/QuestCast.js';

/** The first appointment opens the story; saved and explicitly chosen clocks bypass this. */
export function storyStartMinute( session, sim, fallback ) {

	const runtime = session.entries.find( entry => ! entry.side )?.runtime;
	const step = runtime?.activeSteps()[ 0 ];
	if ( ! step ) return fallback;
	const people = castIds( step.target, runtime );
	// Search from the same morning, respecting authored days and overnight shifts.
	const midnight = Math.floor( fallback / 1440 ) * 1440;
	for ( let minute = midnight + 8 * 60; minute < midnight + 8 * 1440; minute += 15 ) {

		if ( ! runtime.stepPlacementAvailability( step.stepId, minute ).available ) continue;
		if ( people.some( id => {

			const current = sim.continuityAt( id, minute );
			return current.behavior.activity !== 'working';

		} ) ) continue;
		return minute;

	}
	return fallback;

}
