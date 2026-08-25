# Provider model import verification

The Provider detail now includes an `Import models` action. It calls the provider base URL with `/v1/models`, shows a selectable model list on success, and returns a clear English error on failure.

A live failure test against the configured Anthropic Preview connection without an API key produced: `The provider rejected the API key while loading models. Check the key and try again.` The discovery panel then showed `No models returned` and the existing model catalog stayed unchanged.

A live success test used a temporary local OpenAI-compatible endpoint at `http://127.0.0.1:4011/v1/models`, returning Mock Small, Mock Reasoning, and Mock Vision. The UI displayed all three checkboxes with `0 of 3 selected`; selecting two and submitting produced `2 model(s) imported from the provider.` The Provider catalog then showed two ready models with 128,000 context.

The endpoint also treats HTTP 404 as: `This provider does not support the /v1/models endpoint, or the provider URL is incorrect.`


## Default provider cleanup verification

The catalog now renders `0 providers · 0 ready models` on a fresh local runtime after removing the previous preview connections. The code no longer materializes a `Default provider` from legacy singleton settings or ENV; legacy runtime resolution remains available only as a fallback for existing tasks.
