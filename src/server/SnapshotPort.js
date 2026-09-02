/**
 * The slice of the simulation the dialog layers read, fed from the browser's
 * own instance and behavior snapshot: the player talks to the person they see,
 * not to a second simulation's idea of them.
 */
export class SnapshotPort {

	npc = null;
	behavior = null;

	set( npc, behavior ) {

		this.npc = npc;
		this.behavior = behavior;

	}

	getNPC( npcId ) {

		if ( this.npc?.npcId !== npcId ) throw new Error( `E_UNKNOWN_ID: no snapshot for ${npcId}` );
		return this.npc;

	}

	behaviorAt() {

		return this.behavior;

	}

}
