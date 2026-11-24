# dsh-neuralwatt-provider

Neuralwatt models for DeepSeek Harness: Kimi, GLM, Qwen, DeepSeek, Gemma, MiMo and the Neuralwatt house models, with reasoning efforts, vision, tool calls and the energy/cost telemetry Neuralwatt streams beside every response.

This is a port of [`monotykamary/pi-neuralwatt-provider`](https://github.com/monotykamary/pi-neuralwatt-provider) from the Pi extension API to a DSH bundle. It installs as a profile bundle, registers one `neuralwatt` LLM route, and adds a `neuralwatt_status` tool. The upstream Pi UI widgets (below-editor energy footer, quota badge) have no DSH surface; their data is exposed through the tool and the adapter's per-process counters instead.

## Contents

- [What the port covers](#what-the-port-covers)
- [Install](#install)
- [Authenticate](#authenticate)
- [Select a model](#select-a-model)
- [Configure](#configure)
- [Energy, cost and quota](#energy-cost-and-quota)
- [How it works](#how-it-works)
- [Develop](#develop)
- [Model catalog sync](#model-catalog-sync)
- [Known limits](#known-limits)
- [Attribution](#attribution)

## What the port covers

| Upstream feature                            | DSH port                                     | Notes                                                              |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `neuralwatt` provider route                 | `ctx.llm.registerAdapter(['neuralwatt'], …)` | One route, one adapter                                             |
| OpenAI-compatible `/v1/chat/completions`    | Direct SSE adapter                           | No pi-ai dependency at runtime                                     |
| 26-model catalog (chat only)                | Generated DSH catalog                        | `scripts/sync-catalog.mjs`                                         |
| Reasoning efforts                           | `reasoningEfforts` per model                 | Wire spellings preserved (`off → none`, `max → max`, …)            |
| Vision                                      | Image blocks to `image_url` data URLs        | Via the mounted attachment service                                 |
| Tool calls                                  | `tool_calls` deltas                          | Streamed as DSH `tool-call` blocks                                 |
| Preserved thinking                          | `reasoning_content` replay                   | Only where upstream `compat` asks for it                           |
| Qwen chat-template thinking                 | `chat_template_kwargs.enable_thinking`       | Derived from upstream `thinkingFormat`                             |
| Energy + billed cost                        | SSE comment frames captured                  | Per-request debug log and process totals                           |
| Flex queue wait                             | Empty-delta heartbeat timing                 | `lastQueueSeconds` in the status tool                              |
| Hosted tools                                | `hostedTools` config                         | `false` sends `X-NW-Tools-Opt-Out: true`                           |
| Classifier registry (Clef Flash, mammoth-1) | Not ported                                   | DSH has no classifier seam in this release                         |
| Model list live sync                        | Not ported                                   | Catalog is checked in; use the Models page discovery or regenerate |
| Pi status widgets                           | `neuralwatt_status` tool                     | No client UI package ships here                                    |

## Install

Install the bundle into a DSH profile. For the Desktop app the profile is `desktop`; for the CLI it is whatever `--profile` names.

```bash
dsh plugin --profile desktop add link:/absolute/path/to/neuralwatt-dsh
```

The command links the checkout, appends `dsh-neuralwatt-provider` to the profile's `dsh.profile.bundles`, and its `cordis.patch.yml` inserts this row:

```yaml
- insert:
    - id: llm-neuralwatt
      name: "dsh-neuralwatt-provider"
      config:
        baseURL: https://api.neuralwatt.com/v1
        apiKeyEnv: NEURALWATT_API_KEY
        displayName: Neuralwatt
```

Verify the layer composes, then restart the app so the route registers:

```bash
dsh --profile desktop --dump-config | grep -A6 llm-neuralwatt
```

Remove it with `dsh plugin --profile desktop remove dsh-neuralwatt-provider`.

## Authenticate

The key never belongs in configuration. Resolution order is credentials service, launch environment, process environment, then an optional `apiKey` literal.

```bash
# Simplest for the Desktop app: the launcher reads $DSH_HOME/.env
printf 'NEURALWATT_API_KEY=%s\n' 'nw-…' >> "$HOME/.dsh/.env"

# Or a shell export for CLI launches
export NEURALWATT_API_KEY='nw-…'
```

A missing key fails the request with a message naming the variable; it does not silently fall back to another provider's ambient key. Get a key from [neuralwatt.com](https://neuralwatt.com).

## Select a model

The route advertises all 26 chat models. Pick one from the model picker, or set it as the profile default:

```yaml
- id: agent-default-model
  config:
    provider: neuralwatt
    model: kimi-k3.1-pro
```

Models with declared reasoning levels show an **Effort** menu. Levels map to the wire exactly as upstream declared them, so a model that upstream lists as `off, low, high, max` shows those four.

## Configure

Every field is optional; users override them in the profile's own `cordis.patch.yml` (a Cordis config override replaces the whole entry config, so repeat every field you keep).

```yaml
- id: llm-neuralwatt
  config:
    baseURL: https://api.neuralwatt.com/v1
    apiKeyEnv: NEURALWATT_API_KEY
    displayName: Neuralwatt
    hostedTools: true
    logEnergy: true
    timeoutMs: 900000
```

| Field         | Default                         | Meaning                                                     |
| ------------- | ------------------------------- | ----------------------------------------------------------- |
| `baseURL`     | `https://api.neuralwatt.com/v1` | API root; `/chat/completions` and `/quota` hang off it      |
| `apiKeyEnv`   | `NEURALWATT_API_KEY`            | Credential reference and environment fallback name          |
| `apiKey`      | absent                          | Literal key fallback; prefer the environment                |
| `displayName` | `Neuralwatt`                    | Label in selectors and diagnostics                          |
| `hostedTools` | `true`                          | `false` adds `X-NW-Tools-Opt-Out: true` to every request    |
| `logEnergy`   | `false`                         | Log `energy=…J cost=$… queue=…s` per request at debug level |
| `timeoutMs`   | `900000`                        | Overall request deadline                                    |

## Energy, cost and quota

Neuralwatt reports energy and billed cost as SSE comment frames (`: energy {...}`, `: cost {...}`), not as payload fields. The adapter reads those frames without disturbing the token stream, accumulates them per response, and folds them into process totals. Flex-tier requests are held in a server-side queue that emits empty-delta heartbeats; the first real delta gives the queue wait.

The model can call `neuralwatt_status` to report:

- requests, failures, input/output tokens, energy and billed cost for this process;
- the last flex queue wait;
- account quota from `GET /quota`: plan, credits remaining, monthly and lifetime spend and energy.

Set `logEnergy: true` to also see one debug line per request. Unlike the Pi extension there is no below-editor widget: shipping that needs a DSH client UI package, which is out of scope for this bundle.

## How it works

```text
profile bundle  →  cordis.patch.yml inserts llm-neuralwatt
plugin apply    →  Catalog (26 models) + NeuralwattAdapter + neuralwatt_status tool
LLM service     →  projects files, text-model images, and tool updates before dispatch
adapter         →  serialize DSH messages → OpenAI Chat Completions JSON
                →  POST {baseURL}/chat/completions with attribution headers
                →  parse SSE: text, reasoning_content, tool_calls, usage, telemetry comments
                →  emit block-start / delta / block-end, usage, finish
```

| File                       | Role                                                                              |
| -------------------------- | --------------------------------------------------------------------------------- |
| `src/index.ts`             | Config schema, credential resolution, route mount, status tool                    |
| `src/adapter.ts`           | `LlmAdapter` subclass: request, images, decode, telemetry totals                  |
| `src/wire.ts`              | Message/tool serialization, SSE framing, chunk protocol, usage and finish mapping |
| `src/catalog.ts`           | Catalog lookups for `listModels` / `resolveModel`                                 |
| `src/catalog.generated.ts` | Generated model list — do not edit                                                |
| `src/energy.ts`            | Energy/cost comments, flex queue tracking, formatting                             |
| `scripts/sync-catalog.mjs` | Upstream catalog → DSH catalog projector                                          |
| `scripts/build.mjs`        | esbuild bundle, `@deepseek-ai/*` left external                                    |

The adapter deliberately does not depend on `@earendil-works/pi-ai`. DSH's shipped `llm-pi-ai` adapter is a multi-provider plugin whose configuration directory claims every installed pi-ai provider, so mounting it a second time for a single custom route collides on provider ids. A route with its own wire adapter is the composable alternative.

## Develop

```bash
npm install
npm run build      # esbuild → lib/index.js
npm run check      # tsc --noEmit + node --test
```

Tests run offline against the built bundle: catalog lookups, message serialization, SSE framing, chunk assembly, usage mapping, energy capture, and a full adapter round trip against a local fake endpoint (text, reasoning, tool call, usage, energy, HTTP failure).

To load a working copy into a profile while iterating, link the checkout and restart the profile:

```bash
dsh plugin --profile desktop add link:$PWD
npm run build
```

## Model catalog sync

The catalog is a checked-in projection of three upstream files (`models.json`, `custom-models.json`, `patch.json`). Regenerate from a local checkout or straight from GitHub:

```bash
node scripts/sync-catalog.mjs                 # reads ~/.cache/checkouts/github.com/monotykamary/pi-neuralwatt-provider
node scripts/sync-catalog.mjs --fetch         # reads raw.githubusercontent.com
```

The projector drops classifiers, strips the `neuralwatt/` prefix from MCR ids, applies the upstream patch layer, maps `thinkingLevelMap` to DSH reasoning efforts, and keeps only compat switches this adapter implements. Review the diff and commit the regenerated file.

## Known limits

- **Classifiers.** Upstream exposes Clef Flash and mammoth-1 through pi's classifier registry. DSH has no equivalent seam here, so they are filtered out rather than shown as chat models that would fail.
- **Live model sync.** Upstream refreshes the list hourly from `GET /models`. This bundle ships a static catalog; the Models page's discovery still interrogates the endpoint on demand. Rerun the sync script for a new release.
- **Pi widgets and commands.** `/neuralwatt-settings`, the energy footer and the quota badge are Pi extension surfaces. Here, configuration is the profile patch and telemetry is the status tool.
- **Reasoning replay.** Preserved thinking is replayed as `reasoning_content` only when the upstream compat flag says the endpoint reads it; other models start each turn without prior reasoning.
- **Timeouts.** `timeoutMs` is an overall deadline, not an idle watchdog. A very long flex queue wait counts against it.

## Attribution

- Provider behavior, catalogs, telemetry framing and model metadata are ported from [`monotykamary/pi-neuralwatt-provider`](https://github.com/monotykamary/pi-neuralwatt-provider) (MIT).
- The adapter contract follows the DSH documentation (`docs/user/develop/practice/llm-adapter.md`) and the shipped `dsh-llm`, `dsh-llm-deepseek` and `dsh-llm-pi-ai` packages (MIT).
- Neuralwatt is a third-party service; this project is not affiliated with it.
