# FAQ


## Q: `undefined is not an object (evaluating 'usage.input_tokens')`

**Cause**: `ANTHROPIC_BASE_URL` is misconfigured. The API endpoint is returning HTML or another non-JSON format instead of a valid Anthropic protocol response.

This project uses the **Anthropic Messages API protocol**. `ANTHROPIC_BASE_URL` must point to an endpoint compatible with Anthropic's `/v1/messages` interface. The Anthropic SDK automatically appends `/v1/messages` to the base URL, so:

- MiniMax: `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic` ✅
- OpenRouter: `ANTHROPIC_BASE_URL=https://openrouter.ai/api` ✅
- OpenRouter (wrong): `ANTHROPIC_BASE_URL=https://openrouter.ai/anthropic` ❌ (returns HTML)

If your provider only supports the OpenAI protocol, run `/provider` in the TUI or use Settings -> Providers in the desktop app. CyberCode enables its built-in protocol bridge automatically. See the [Third-Party Models Guide](./third-party-models.md).

## Q: `Cannot find package 'bundle'`

```
error: Cannot find package 'bundle' from '.../cybercode/src/entrypoints/cli.tsx'
```

**Cause**: Your Bun version is too old and doesn't support the required `bun:bundle` built-in module.

**Fix**: Upgrade Bun to the latest version:

```bash
bun upgrade
```

## Q: How to use OpenAI / DeepSeek / Ollama or other non-Anthropic models?

CyberCode supports Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses directly. OpenAI formats use the built-in bridge and require no extra proxy installation.

See the [Third-Party Models Guide](./third-party-models.md) for detailed setup instructions.
