export function questCompletion( change, views ) {

	const view = views.find( ( candidate ) => candidate.id === change.definition.id );
	return {
		questId: change.definition.id,
		stepIds: change.completed.map( ( completed ) => completed.stepId ),
		...( change.ending ? { endingId: change.ending.endingId } : {} ),
		presentation: {
			title: change.definition.title,
			steps: change.completed.map( ( step ) => step.narrative.description ),
			...( change.ending ? { ending: {
				title: change.ending.title,
				text: change.ending.epilogue,
				outcome: 'done',
				steps: view?.steps ?? []
			} } : {} )
		}
	};

}
