# Models, Sync, and Agent Routing

CyberCode organizes model access into clear provider groups while sharing the same local configuration between the desktop app and terminal TUI. Custom providers appear in their own group first, followed by official API-key providers, major aggregators, OAuth, web sessions, image/video/audio providers, and local models. Custom compatible endpoints are no longer mixed with LM Studio or Ollama.

## Choose a connection type

| Type | Best for | Notes |
| --- | --- | --- |
| Custom provider | An existing compatible endpoint or self-hosted gateway | Configure the base URL, protocol, custom model IDs, and an optional API key. |
| Official API key | Stable production access and explicit billing | Keys stay on the local machine. Distinct products such as Kimi Code and Kimi remain separate entries. |
| Aggregator | Accessing many models with one account | OpenAI- and Anthropic-compatible endpoints are supported. |
| OAuth | Providers with a browser authorization flow | CyberCode stores the authorization locally and refreshes tokens when the provider supports it. |
| Web session | Reusing an existing website login | Uses cookies, JWTs, or web tokens and carries more stability, rate-limit, and account-policy risk than an official API. |
| Image/video/audio | Managing media catalogs and credentials | China-focused providers are shown first. Connection tests do not submit paid generation jobs, and media models do not become chat defaults. |
| Local model | Local inference through LM Studio, Ollama, or similar software | Connects directly to the local service; CyberCode does not replace the inference application. |

Open **Settings → Models & Routing → Model Providers** in the desktop app. Provider names follow the selected CyberCode UI language.

## OAuth login

Open an OAuth card and complete its authorization flow. A card is highlighted as connected only after authorization succeeds. For providers that support token rotation, CyberCode maintains a valid token locally instead of asking you to paste short-lived credentials repeatedly.

The provider still controls authorization scopes and account terms. Disconnecting removes the corresponding authorization stored by CyberCode.

## Web-session providers

Each web-session card tells you which cookie or web token is required. CyberCode normalizes cookie input, adds browser-compatible request headers, and keeps session continuity when an upstream response supplies a rotated token. It does not read browser data, solve CAPTCHAs, bypass account restrictions, or bypass region restrictions.

### Fastest setup

1. Open the provider card, choose **Open website**, sign in to your own account, and confirm that the website can send a message.
2. Press `F12` to open browser developer tools. The dialog identifies the exact field and whether it is under **Application / Storage → Cookies**, **Local Storage**, or **Network**.
3. Copy the field value. For cookies, copy `name=value` pairs separated by semicolons, or copy the full value from **Network → Request Headers → Cookie**.
4. Return to CyberCode, choose **Import from clipboard**, then **Save session** and **Test**. Set it as the default only after the test succeeds.

The dialog always shows the exact field and paste format for the selected provider. Common examples:

| Provider | Browser location | Copy |
| --- | --- | --- |
| Kimi Web | Application / Storage → Cookies | `kimi-auth`, or the full Cookie value |
| Claude Web | Application / Storage → Cookies | `sessionKey`, or the full Cookie value |
| ChatGPT Web | Application / Storage → Cookies | `__Secure-next-auth.session-token`, or the full Cookie value |
| Gemini Web | Application / Storage → Cookies | `__Secure-1PSID` and `__Secure-1PSIDTS` |
| DeepSeek Web | Application / Storage → Local Storage | The value of `userToken` |
| Microsoft Copilot Web | A chat request in Network | `access_token` |
| Microsoft 365 Copilot | The WebSocket request URL in Network | `access_token` and `chathubPath` |

Browsers protect HttpOnly cookies, so a desktop app cannot read them silently without broader browser access. CyberCode uses an explicit copy followed by one-click clipboard import instead: it does not scan browser profiles or retain background clipboard permission.

::: warning Check the provider terms
Website interfaces can change without notice and may trigger rate limits or account controls. Use only accounts and credentials you are authorized to use. Prefer an official API for production reliability.
:::

## Import and synchronize models

For API-key, custom, and local providers that expose a compatible `/models` endpoint, choose **Sync latest models** on the provider card. CyberCode merges the remote catalog while preserving model IDs entered manually.

With **Live sync** enabled, CyberCode schedules a refresh after startup and then approximately every 24 hours. OAuth, web-session, and built-in media catalogs are maintained by their own connection paths and are not overwritten by generic `/models` synchronization.

The TUI exposes the same controls:

```text
/provider status
/provider sync [provider ID or name]
/provider auto-sync on|off [provider ID or name]
```

## Build an agent route

Open **Models & Agent Routing → Agent Routing**, create a route, add one or more available model targets, and select a strategy. CyberCode uses target availability, health history, and failure cooldowns to choose each attempt. If one target fails, it can move to the next target within the route's maximum-attempt limit.

Only configured and currently usable targets participate. Targets with a missing key, disconnected OAuth session, disabled state, or an explicit non-routable flag are excluded.

The TUI can manage and activate routes directly:

```text
/routing
/routing status
/routing create coding-fast Daily coding
/routing strategy coding-fast auto
/routing use coding-fast
/routing reset-health
```

`/route` is an alias for `/routing`. `create` starts with all configured stable providers; use the desktop editor for precise target order and policy.

## Share models with another agent

The **Node** turns configured models and agent routes into independently authenticated OpenAI Chat Completions and Anthropic Messages endpoints. Receiving agents never receive the original provider keys. See [Agent Node](./agent-node.md) for setup, TUI commands, and verification.

## Desktop and TUI ownership

The desktop app and standalone TUI share provider, synchronization, routing, and node settings. A standalone TUI starts the built-in local runtime on demand, with no extra proxy installation.

When the TUI is a desktop-managed child process, the desktop host owns the local server, scheduler, and node lifecycle to avoid two processes writing the same configuration. Manage the node from desktop settings in that mode.
