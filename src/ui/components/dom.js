/** Builds a DOM element: el('div', { className: 'x' }, child, 'text'). */
export function el( tag, props = {}, ...children ) {

	const node = document.createElement( tag );
	Object.assign( node, props );

	for ( const child of children ) {

		node.append( child );

	}

	return node;

}
