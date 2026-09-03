/** Browser navigation adapter used when the host does not inject one. */
export function navigateBrowser( url ) {

	window.location.assign( url );

}

/** Downloads a JSON document without retaining its object URL. */
export function downloadBrowser( filename, payload ) {

	const blob = new Blob( [ JSON.stringify( payload, null, 2 ) ], { type: 'application/json' } );
	const url = URL.createObjectURL( blob );
	const anchor = document.createElement( 'a' );
	anchor.href = url;
	anchor.download = filename;
	anchor.hidden = true;
	document.body.append( anchor );
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL( url );

}
