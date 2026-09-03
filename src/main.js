const mode = new URLSearchParams( window.location.search ).get( 'mode' );

async function start() {

	if ( mode === 'game' ) {

		const { GameApp } = await import( './game/GameApp.js' );
		await new GameApp( GameApp.configFromUrl() ).start();

	} else if ( mode === 'city' ) {

		const { CityApp } = await import( './city/CityApp.js' );
		await new CityApp( CityApp.configFromUrl() ).start();

	} else if ( mode === 'building' ) {

		const { BuildingViewerApp } = await import( './building/BuildingViewerApp.js' );
		await new BuildingViewerApp( BuildingViewerApp.configFromUrl() ).start();

	} else if ( mode === 'experiment' ) {

		const [ { App }, { RunConfig } ] = await Promise.all( [
			import( './app/App.js' ), import( './app/RunConfig.js' )
		] );
		await new App( RunConfig.fromUrl() ).start();

	} else {

		const [ { LauncherApp }, { HttpLauncherApi } ] = await Promise.all( [
			import( './launcher/LauncherApp.js' ), import( './launcher/HttpLauncherApi.js' )
		] );
		await new LauncherApp( { mount: document.body, api: new HttpLauncherApi() } ).start();

	}

}

await start().catch( ( error ) => {

	console.error( error );
	document.body.textContent = `Could not start Urbe: ${error.message ?? error}`;

} );
