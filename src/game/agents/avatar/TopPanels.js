/**
 * How the crowd paints a top's second colour, as the top's own panels mostly
 * show it: not at all, in an open front, across the shoulders, or across the
 * shoulders and down the upper sleeves. The crowd paints it and a person's
 * look in words (Describe) names it.
 */
export const TOP_PANELS = { plain: 0, open: 1, yoke: 2, sleeved: 3 };
/** The panel style of each top. */
export const PANEL_OF = {
	'office-jacket': 'open', 'vest-tailored': 'open', 'top-tank': 'plain',
	'tech-top': 'yoke', 'police-jacket': 'sleeved', 'top-tee': 'yoke', 'top-turtleneck': 'yoke',
	'jacket-cropped': 'yoke', 'jacket-bomber': 'yoke', 'shirt-utility': 'yoke'
};
