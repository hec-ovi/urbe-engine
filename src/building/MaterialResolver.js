/**
 * Consumer of the materials box index (../materials/CONTRACT.md): fetches the
 * theme database JSON and resolves `theme/kind/tier` keys to MaterialEntry
 * objects, honoring aliases. Tracks every lookup for the resolution report.
 */
export class MaterialResolver {

	/** @param baseUrl URL prefix the theme databases are served under */
	constructor( baseUrl = '/materials' ) {

		this.baseUrl = baseUrl;
		this.themes = new Map();
		this.resolved = new Set();
		this.unresolved = new Set();

	}

	/** Loads one theme index; safe to call once per theme before resolving. */
	async loadTheme( theme ) {

		if ( this.themes.has( theme ) ) return;

		const response = await fetch( `${this.baseUrl}/${theme}/theme.json` );

		if ( ! response.ok ) throw new Error( `theme index ${theme}: HTTP ${response.status}` );

		const index = await response.json();
		const aliases = new Map();

		for ( const [ key, entry ] of Object.entries( index.entries ) ) {

			for ( const alias of entry.aliases ?? [] ) aliases.set( alias, key );

		}

		this.themes.set( theme, { entries: index.entries, aliases } );

	}

	/** Loads one Materials-owned binding document without accepting a fallback. */
	async loadBindings( name ) {

		if ( ! /^[a-z0-9-]+$/.test( name ) ) throw new Error( `invalid material binding name ${name}` );
		const response = await fetch( `${this.baseUrl}/bindings/${name}.json` );
		if ( ! response.ok ) throw new Error( `material bindings ${name}: HTTP ${response.status}` );
		return response.json();

	}

	/** @returns MaterialEntry or null when the key resolves to nothing. */
	resolve( key ) {

		const theme = key.split( '/' )[ 0 ];
		const db = this.themes.get( theme );
		const entry = db ? ( db.entries[ key ] ?? db.entries[ db.aliases.get( key ) ] ?? null ) : null;

		( entry ? this.resolved : this.unresolved ).add( key );

		return entry;

	}

	/** URL of a map file within a theme (entry map paths are theme-relative). */
	mapUrl( theme, mapPath ) {

		return `${this.baseUrl}/${theme}/${mapPath}`;

	}

	/**
	 * How the run is resolving, without building the lists: the HUD reads this
	 * every frame while interiors stream new keys in.
	 */
	get counts() {

		return { resolved: this.resolved.size, unresolved: this.unresolved.size };

	}

	report() {

		return {
			resolved: [ ...this.resolved ].sort(),
			unresolved: [ ...this.unresolved ].sort()
		};

	}

	/** Exact material key and variant surface consumed by mission-assets v1.0. */
	missionCatalog( theme ) {

		const db = this.themes.get( theme );
		if ( ! db ) throw new Error( `theme index ${theme} is not loaded` );

		return {
			contractVersion: '1.0',
			entries: Object.entries( db.entries )
				.map( ( [ key, entry ] ) => ( {
					key,
					...( entry.aliases?.length ? { aliases: [ ...entry.aliases ] } : {} ),
					variants: entry.variants.map( ( variant ) => variant.id )
				} ) )
				.sort( ( left, right ) => left.key.localeCompare( right.key ) )
		};

	}

}
