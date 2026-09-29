/*
 * The authored characters the game dresses people in. A file is either a
 * recipe exported from the NPC Studio as it stands (its name comes from the
 * file name here), or `{ name, recipe | outfit, crowd?, people? }`:
 * - `recipe`, a whole person, or `outfit`, clothes only, in the studio's format;
 * - `crowd`, the share of the street that wears its outfit (0 to 0.5);
 * - `people`, the simulation npcIds that are this person, in its recipe.
 * Add a file by importing it below under the id it goes by.
 */
import districtLiaison from './district-liaison.json' with { type: 'json' };
import metropolitanPatrol from './metropolitan-patrol.json' with { type: 'json' };
import nightRunner from './night-runner.json' with { type: 'json' };

export default {
	'district-liaison': districtLiaison,
	'metropolitan-patrol': metropolitanPatrol,
	'night-runner': nightRunner
};
