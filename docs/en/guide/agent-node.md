# Agent Node

CyberCode can expose configured models and agent routes to other agents through a scoped node supporting both OpenAI Chat Completions and Anthropic Messages. Provider credentials remain inside CyberCode; the receiving agent only gets a separate node key.

## Prepare the node

1. Open **Models & Routing → Node**.
2. Create a separate node API key for each user or agent. The complete key is shown only once.
3. Click the key's row in the table, select the models and routes it may access, then choose its default target for `auto`.
4. Save, then use the **Connection configuration builder** to choose a protocol and target. CyberCode generates a card with the Base URL, full endpoint, Model, and node key, with per-field and copy-all actions.

You can also configure a standalone TUI directly:

```text
/node start
/node allow all
/node status
```

`/node start` starts CyberCode's built-in local runtime on demand and creates a `cc_...` key when none exists. The complete key is shown once. Run `/node` for an interactive default-target picker, or use `/node default <target-id>` in scripts. Use `/node limit <count>` for a monthly request limit, `/node rotate` to replace the key, `/node stop` to pause the node, and `/node revoke` to remove the key. `/agent-node` and `/gateway` are aliases.

::: tip Desktop-managed sessions
When the TUI was launched by the CyberCode desktop app, the desktop local server owns the node. Manage it in desktop settings so two processes do not modify the same key and port.
:::

## Complete fill-in example

The following example connects a “CI coding agent.” `node.example.com` is a documentation-only placeholder domain and `cc_REPLACE_WITH_YOUR_NODE_KEY` is an invalid redacted key. Replace them with the address and complete key shown by your own node.

Add an **OpenAI Compatible** provider in the receiving agent and fill only four fields:

| Receiving field | Example value |
| --- | --- |
| Protocol | `OpenAI Chat Completions` |
| Base URL | `https://node.example.com/v1` |
| API key | `cc_REPLACE_WITH_YOUR_NODE_KEY` |
| Model | `auto` |

For normal use, keep Model set to `auto`. No other advanced field is required.
If the receiving agent also asks for a provider **Name**, use any recognizable local label, such as `CyberCode Work Node`. It does not control routing; provider aliases in Model distinguish the same model served by different upstream providers.

Use the same values for a connection test:

```bash
curl https://node.example.com/v1/chat/completions \
  -H "Authorization: Bearer cc_REPLACE_WITH_YOUR_NODE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Reply only with: node connected"}
    ]
  }'
```

### Node-side policy in CyberCode

Under **Node → Access keys → Target policy**, configure this key using the names shown in the UI:

| Policy | Example |
| --- | --- |
| Key name | `CI coding agent` |
| Allowed access | `Coding route`, `Kimi K2.6` |
| Default target | `Coding route` |
| Monthly request limit | `5000` |

CyberCode enforces these settings while the receiving agent continues to use Model=`auto`. Consult the later advanced Model section and copy an exact ID only when you intentionally need to pin one model or route.

## Manage keys for multiple users

Give each user, device, or external agent its own key instead of sharing one value. This keeps scope, monthly quota, and usage separate, and lets you disable one compromised key without interrupting everyone else.

1. Click **Add key** and enter a recognizable name such as “Alice”, “CI runner”, or “Telegram bot”.
2. Copy the complete `cc_...` key immediately. CyberCode stores only its hash, so the complete value cannot be recovered after the app is refreshed or closed.
3. Click that key's row. The **Target policy**, monthly limit, and **Connection configuration builder** below now apply only to the selected key.
4. Select its allowed models and routes, set its `auto` target and monthly request limit, then save.
5. Choose a protocol and target in the builder, then enter the generated URL, Model, and complete key in the matching agent.

Actions in the key table:

| Action | Result |
| --- | --- |
| Rename | Changes only the management label; the key value and connection keep working |
| Copy | Available only while the complete value remains in memory after creation or rotation |
| Rotate | Replaces only this key; the old value stops immediately while scope, quota, and current usage remain |
| Revoke | Blocks only this user; all other keys and the node continue working |

If the key is already masked, choose **Rotate key** and update that agent with the new value. Removing the final key disables the node automatically.

Equivalent TUI commands:

```text
/node key list
/node key create CI
/node key rename CI BuildBot
/node limit 5000 --key=BuildBot
/node allow route/coding --key=BuildBot
/node default route/coding --key=BuildBot
/node rotate BuildBot
/node revoke BuildBot
```

When multiple keys exist, quota, scope, default-target, rotation, and revocation commands require `--key=<ID, prefix, or exact name>` (or a key argument where shown), preventing accidental changes to another user.

## Step 1: choose the receiving protocol

In the agent that will connect to CyberCode, find **Add provider**, **Custom model**, or **Custom Provider**, then choose according to the available option:

| Option shown by the receiving agent | Protocol to select |
| --- | --- |
| OpenAI Compatible, Custom OpenAI, Chat Completions | OpenAI |
| Anthropic, Anthropic Compatible, Anthropic Messages | Anthropic |
| Both protocols | Prefer the protocol recommended natively by that agent |

The protocol controls only the request format. Both protocols can use every model and agent route authorized by the CyberCode node.

## Step 2: understand Key and Model

### API Key

Enter the complete `cc_...` node key shown when CyberCode creates the node. Do not enter an upstream Kimi, OpenAI, Zhipu, or other provider key.

The complete node key is shown once. If the page now shows a masked value such as `cc_xxxxx••••••`, rotate the key to create a new one and enter it in the receiving agent immediately.

### Model

Enter `auto`. CyberCode resolves the default model or agent route configured for this key, so normal users do not need another model identifier.

## Connect with the OpenAI protocol

Add an **OpenAI Compatible**, **Custom OpenAI**, or **Chat Completions** provider and fill in:

| Field | Value |
| --- | --- |
| API type | OpenAI Chat Completions |
| Base URL | The URL shown by CyberCode, such as `http://127.0.0.1:3456/v1` |
| API key | The complete `cc_...` node key shown when CyberCode creates it |
| Model | `auto` |

If the receiving agent asks for an **Endpoint** instead of a Base URL, use `http://127.0.0.1:3456/v1/chat/completions`.

## Connect with the Anthropic protocol

Add an **Anthropic**, **Anthropic Compatible**, or **Anthropic Messages** provider and fill in:

| Field | Value |
| --- | --- |
| API type | Anthropic Messages |
| Base URL | The Anthropic protocol URL shown by CyberCode, such as `http://127.0.0.1:3456` |
| API key | The complete `cc_...` node key shown when CyberCode creates it |
| Model | `auto` |

Anthropic clients usually append `/v1/messages` to the base URL, so this URL does not include `/v1`. If the receiving agent requires the complete endpoint, use `http://127.0.0.1:3456/v1/messages`.

## Advanced: pin a model or route

Only when you intentionally need to bypass the default target, replace `auto` with an exact target ID:
For direct models, the value before `/` is the readable provider node alias. Edit it under **Provider → Advanced settings → Node alias**. The connection builder never exposes the internal provider UUID.

| Goal | Model value | Result |
| --- | --- | --- |
| Pin an agent route | `route/<route-id>`, for example `route/coding` | Lets that route choose its provider and model |
| Pin a direct model | `<provider-alias>/<model-id>`, for example `kimi/kimi-k2.6` | Always uses that exact provider model |

Expand **Advanced: pin a model or route** in the node guide and copy the complete ID, or query `GET /v1/models` with the node key. Do not guess it from a display label.

## Verify the connection

First list the exact values accepted by the Model field:

```bash
curl http://127.0.0.1:3456/v1/models \
  -H "Authorization: Bearer cc_your_node_key"
```

Test the OpenAI protocol:

```bash
curl http://127.0.0.1:3456/v1/chat/completions \
  -H "Authorization: Bearer cc_your_node_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

Test the Anthropic protocol:

```bash
curl http://127.0.0.1:3456/v1/messages \
  -H "x-api-key: cc_your_node_key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'
```

The node supports `GET /v1/models`, `POST /v1/chat/completions`, and `POST /v1/messages`, including streaming responses for both OpenAI and Anthropic protocols.

## Connect from another device

The default `127.0.0.1` URL is only reachable on the same computer. For a phone, server, or LAN device, use a TLS reverse proxy or secure tunnel to the local node and enter its HTTPS address as the public URL.

The public URL field only changes the advertised node URL. It does not open a firewall, bind a public port, or create a tunnel. Do not expose the local server port directly.

## Scope and revocation

- Each key can access only its own selected models and routes.
- Each key has an independent monthly request limit and usage count.
- Rotation invalidates only that key's old value and preserves its scope, quota, and current usage.
- Revoking one key does not affect the others; the node is disabled only after the final key is removed.
