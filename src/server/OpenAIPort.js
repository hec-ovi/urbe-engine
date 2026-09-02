/**
 * The quests LLMPort over an OpenAI-compatible chat server (llama.cpp, vLLM,
 * Ollama). LLM_BASE_URL names the server, LLM_MODEL the model; without a model
 * the first one the server lists is used. No output caps are ever sent.
 */
export class OpenAIPort {

	constructor( baseUrl, model = null ) {

		this.baseUrl = baseUrl.replace( /\/$/, '' );
		this.model = model;

	}

	async complete( { system, prompt } ) {

		const model = this.model ??= await this.#firstModel();
		const response = await fetch( `${this.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { model, messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: prompt }
			] } )
		} );

		if ( ! response.ok ) throw new Error( `model server ${response.status} at ${this.baseUrl}` );

		const data = await response.json();
		return data.choices?.[ 0 ]?.message?.content ?? '';

	}

	async #firstModel() {

		const response = await fetch( `${this.baseUrl}/models` );
		if ( ! response.ok ) throw new Error( `model server ${response.status} at ${this.baseUrl}` );
		const data = await response.json();
		const id = data.data?.[ 0 ]?.id;
		if ( ! id ) throw new Error( `model server at ${this.baseUrl} lists no model` );
		return id;

	}

}
