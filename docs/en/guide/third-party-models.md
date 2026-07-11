# Using Third-Party Models

CyberCode includes its own model protocol bridge. OpenAI, Google Gemini, Kimi API, and other OpenAI-compatible providers do not require LiteLLM, a Python environment, or a separately managed proxy.

## Configure the terminal UI

On first launch, follow the guided setup:

1. Choose a model provider.
2. Choose the default model.
3. Enter the provider API key.
4. Finish setup and enter the TUI.

To configure or switch providers later, run:

```text
/provider
```

The command can activate a saved provider or create a new configuration. API keys remain in CyberCode's local configuration directory.

## Configure the desktop app

1. Open Settings -> Providers.
2. Choose a preset or Custom.
3. Enter the API key and choose a model.
4. Test and activate the provider.

The desktop app and TUI share provider settings, so a provider normally only needs to be configured once.

## Connection modes

CyberCode chooses the connection mode from the provider configuration:

| API format | Connection | External proxy required |
| --- | --- | --- |
| Anthropic Messages | Direct to the provider | No |
| OpenAI Chat Completions | CyberCode built-in protocol bridge | No |
| OpenAI Responses | CyberCode built-in protocol bridge | No |

The bridge only listens on local `127.0.0.1`. The TUI selects an available port automatically and stops the bridge when the process exits.

## Built-in presets

The setup wizard includes Claude Official, OpenAI, Google Gemini, DeepSeek, GLM, Kimi Code, Kimi API, MiniMax, Xiaomi MiMo, LM Studio, and Ollama. Presets provide the official Base URL, API format, model choices, and context limits.

You can also choose "Enter another model ID" when a provider releases a model before CyberCode updates its preset.

## Custom providers

The Custom flow asks for:

1. A display name.
2. The API Base URL.
3. Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses.
4. The model ID.
5. The API key.

Use the API root documented by the provider. Do not append CyberCode's `/proxy` path; routing and `/v1/messages` translation are handled automatically.

## Local models

LM Studio and Ollama still require their own local inference application and downloaded models, but no additional protocol proxy:

- LM Studio default: `http://localhost:1234`
- Ollama default: `http://localhost:11434`

Start the local model service before selecting its preset in `/provider`.

## Environment variables

CI, containers, and scripts can still connect directly to Anthropic-compatible endpoints:

```bash
export ANTHROPIC_BASE_URL="https://provider.example.com/anthropic"
export ANTHROPIC_AUTH_TOKEN="your-api-key"
export ANTHROPIC_MODEL="your-model-id"
cybercode -p "Review this project"
```

For OpenAI-compatible APIs, prefer `/provider` or desktop provider settings so CyberCode can enable its built-in bridge automatically.

## Troubleshooting

### CyberCode still uses the previous model

Run `/provider` in the current TUI and activate the intended provider again. CyberCode refreshes authentication and the active model for the session.

### 401 or 403

Verify that the API key belongs to the selected provider and can access the selected model.

### 404

For a custom provider, the selected API format is usually wrong. Confirm whether the service exposes Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses.

### Existing LiteLLM configuration

It can remain configured as a custom Anthropic Messages endpoint, but CyberCode no longer requires it. You can remove that layer and select the upstream provider directly in `/provider`.
