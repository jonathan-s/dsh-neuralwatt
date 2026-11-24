# dsh-neuralwatt-provider

Neuralwatt models for DeepSeek Harness: Kimi, GLM, Qwen, DeepSeek, Gemma, MiMo and the Neuralwatt house models, with reasoning efforts, vision, tool calls, and the energy, carbon, and billed-cost telemetry Neuralwatt streams beside every response.

The route behaves like a shipped provider, not like a port: it resolves its credential through the harness credential seam, reads its settings per request, appears in the configurable-provider directory with endpoint discovery, owns a provider retry policy, maps provider failures onto the harness failure taxonomy, and stores its per-response telemetry in the session log so a later reload, resume, or fork reproduces it. A Web pill shows the session's energy and cost, and a provider-card extension shows the account quota.

This is a port of [`monotykamary/pi-neuralwatt-provider`](https://github.com/monotykamary/pi-neuralwatt-provider) from the Pi extension API. Provider behavior, catalogs, and telemetry framing come from it; the integration surface is DSH's own.

## Contents

- [dsh-neuralwatt-provider](#dsh-neuralwatt-provider)
  - [Contents](#contents)
  - [What the bundle contributes](#what-the-bundle-contributes)
  - [Install](#install)
  - [Reload after a change](#reload-after-a-change)
  - [Authenticate](#authenticate)
  - [Select a model](#select-a-model)
  - [Configure](#configure)
  - [Energy, cost and quota](#energy-cost-and-quota)
  - [How it works](#how-it-works)
  - [Develop](#develop)
  - [Model catalog sync](#model-catalog-sync)
  - [Known limits](#known-limits)
  - [Attribution](#attribution)

## What the bundle contributes

| Surface | What it is |
| --- | --- |
| `neuralwatt` LLM route | One `LlmAdapter` over the OpenAI-compatible Chat Completions endpoint |
| Model catalog | 26 chat models with context, output cap, modalities, reasoning efforts, prices, and `Flex` badges |
| Model discovery | Answers from the shipped catalog for this route; probes `GET {baseURL}/models` for a draft endpoint |
| Configurable-provider entry | Route, endpoint, credential variable, and the settings namespace its fields live in |
| Provider retry policy | `retryPolicy` in config, executed by `dsh-llm-retry`; the route re-registers when it changes |
| Failure taxonomy | `AUTH`, `QUOTA`, `RATE_LIMIT`, `CONTEXT_WINDOW_EXCEEDED`, `INVALID_REQUEST`, `SERVER`, `HTTP_<status>`; `Retry-After` and request id are retained |
| Durable telemetry | Energy, carbon (CO₂e) with grid facts, billed cost, and flex queue wait in the assistant message's replay state |
| Session projection | `neuralwattUsage`: per-session requests, tokens, cached tokens, energy, carbon, grid, cost, last queue wait |
| Composer pill | Energy, billed cost, and carbon for this session, in the shipped tertiary tone, with a click-open detail panel |
| Provider card | API-key entry and account quota in Settings → Models, served by `/api/neuralwatt.quota` |
| `neuralwatt_status` tool | Session usage, carbon footprint, and account quota, offered only to steps routed to this provider |

## Install

Install the bundle into a DSH profile. For the Desktop app the profile is `desktop`; for the CLI it is whatever `--profile` names.

```bash
dsh plugin --profile desktop add link:/absolute/path/to/neuralwatt-dsh
```

The command links the checkout, appends `dsh-neuralwatt-provider` to the profile's `dsh.profile.bundles`, and its `cordis.patch.yml` inserts this row:

```yaml
- insert:
    - id: llm-neuralwatt
      name: 'dsh-neuralwatt-provider'
      config:
        baseURL: https://api.neuralwatt.com/v1
        apiKeyEnv: NEURALWATT_API_KEY
        displayName: Neuralwatt
```

Verify the layer composes, then let the profile recompose as described below:

```bash
dsh --profile desktop --dump-config | grep -A8 llm-neuralwatt
```

Remove it with `dsh plugin --profile desktop remove dsh-neuralwatt-provider`.

## Reload after a change

There is native reload; a full restart is only needed for the browser half's first load.

- **Host code (`lib/index.js`).** HMR replaces a linked package whose files changed on disk at the next profile recomposition; a profile or patch edit, a Plugin Manager operation, or any other recomposition is enough. No restart is required.
- **Automatic on build.** To have HMR notice `npm run build` by itself, watch the checkout from the profile patch:

  ```yaml
  - id: hmr
    disabled: false
    config:
      root: ['/absolute/path/to/neuralwatt-dsh']
  ```

  The default `ignored` list already excludes `node_modules` and dotfiles.
- **Configuration.** Every field is a `Volatile` reference, so an edit through the Settings/Config surface reaches the next request with no reload at all; only `displayName` and `retryPolicy` re-register the route.
- **Browser code (`client.js`).** The page's module table is assembled from the Host Loader entries; a new client contribution appears after a page refresh (`Cmd+R`). Reloading the page also picks up a changed `client.js`, so build the Host half first, then refresh once.

A failed replacement is reported as an activation failure and the previous code stops; fixing the file and triggering another recomposition starts it again.

## Authenticate

The key never belongs in configuration. Resolution order is the credentials service, then — only when no credentials service is mounted — the launch environment (process environment, project `.env`, `$DSH_HOME/.env`). A miss fails with `MISSING_CREDENTIAL` naming the reference.

The simplest path is **Settings → Models → Neuralwatt**: its card stores the key through the credential seam under the configured `apiKeyEnv` reference and shows whether it is configured. The command line is equivalent:

```bash
# Simplest for the Desktop app: the launcher reads $DSH_HOME/.env
printf 'NEURALWATT_API_KEY=%s\n' 'nw-…' >> "$HOME/.dsh/.env"

# Or a shell export for CLI launches
export NEURALWATT_API_KEY='nw-…'
```

Get a key from [neuralwatt.com](https://neuralwatt.com).

## Select a model

The route advertises all 26 chat models. Pick one from the model picker, or set it as the profile default:

```yaml
- id: agent-default-model
  config:
    provider: neuralwatt
    model: deepseek-v4.1-flash
```

Models with declared reasoning levels show an **Effort** menu. Levels map to the wire exactly as upstream declared them, so a model that upstream lists as `off, low, high, max` shows those four.

## Configure

Every field is a live reference. Override them in the profile's own `cordis.patch.yml` (a Cordis config override replaces the whole entry config, so repeat every field you keep):

```yaml
- id: llm-neuralwatt
  config:
    baseURL: https://api.neuralwatt.com/v1
    apiKeyEnv: NEURALWATT_API_KEY
    displayName: Neuralwatt
    hostedTools: true
    logEnergy: false
    idleTimeoutMs: 300000
    requestTimeoutMs: 900000
    retryPolicy:
      mode: normal
      maxRetries: 3
```

| Field | Default | Meaning |
| --- | --- | --- |
| `baseURL` | `https://api.neuralwatt.com/v1`, then `$NEURALWATT_BASE_URL` | API root; `/chat/completions`, `/models`, and `/quota` hang off it |
| `apiKeyEnv` | `NEURALWATT_API_KEY` | Credential reference resolved per request; never a secret |
| `displayName` | `Neuralwatt` | Label in selectors and diagnostics |
| `hostedTools` | `true` | `false` adds `X-NW-Tools-Opt-Out: true` to every request |
| `logEnergy` | `false` | Log `energy=…J cost=$… queue=…s` per request at debug level |
| `idleTimeoutMs` | `300000` | Maximum provider idle time while one stream read is outstanding |
| `requestTimeoutMs` | `900000` | Overall deadline, including flex queue time |
| `retryPolicy` | normal mode, 5 retries | Provider-owned policy executed by `dsh-llm-retry` |

Omission of `retryPolicy` retries `EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT`, and `TRANSPORT` up to five times with bounded exponential backoff; a valid `Retry-After` from Neuralwatt replaces the local delay.

## Energy, cost and quota

Neuralwatt reports energy, carbon, and billed cost as SSE comment frames (`: energy {...}`, `: cost {...}`), not as payload fields. The adapter reads those frames without disturbing the token stream, attaches them to the terminal `finish` chunk's replay state, and the session log persists them with the assistant message. The `: energy` frame also carries the carbon footprint (`carbon_g_co2eq`), the grid the reporting node drew from (`grid_id`), that grid's intensity (`grid_carbon_intensity_gco2perkwhr`), and how those facts were obtained (`carbon_source`); grid facts are latest-wins, and an intensity from a fallback source is reported with a `~` marker. Flex-tier requests are held in a server-side queue that emits empty-delta heartbeats; the first real delta gives the queue wait.

From that durable data:

- the `neuralwattUsage` session projection publishes requests, tokens, cached tokens, energy, carbon, the last grid facts, cost, and the last queue wait per session;
- the composer pill shows the session's energy, billed cost, and carbon in the same tertiary tone as the shipped statistics pills, and opens a detail panel with requests, input, cached and output tokens, exact billed cost, carbon footprint, grid region and intensity, the last flex queue wait, and the last model; it renders nothing for a session that has not used the route;
- the Settings → Models provider card shows the account quota and stores the API key, read from and written through `/api/neuralwatt.quota` and the credential seam;
- the model can call `neuralwatt_status` for the same session figures plus plan, credits, and monthly and lifetime spend.

The status tool is registered only for a step routed to this provider, so other sessions never see it. Quota snapshots are cached for one minute; a failure degrades to "unavailable" instead of failing a model request.

## How it works

```text
profile bundle  →  cordis.patch.yml inserts llm-neuralwatt
plugin apply    →  Catalog + NeuralwattAdapter + directory + discovery
                →  session projection + quota route + status tool
LLM service     →  projects files, text-model images, and tool updates before dispatch
adapter         →  serialize DSH messages → OpenAI Chat Completions JSON
                →  POST {baseURL}/chat/completions with attribution headers
                →  parse SSE: text, reasoning_content, tool_calls, usage, telemetry comments
                →  emit block-start / delta / block-end, usage, finish (+replay state)
```

| File | Role |
| --- | --- |
| `src/index.ts` | Plugin wiring: route, directory, discovery, projection, quota route, status tool, reload |
| `src/options.ts` | Config schema, live resolution, validation, registration facts |
| `src/credentials.ts` | Credential seam resolution and presence check |
| `src/adapter.ts` | `LlmAdapter`: request, images, decode, idle watchdog, replay state |
| `src/wire.ts` | Message/tool serialization, SSE framing, chunk protocol, usage/finish mapping, failure taxonomy |
| `src/replay.ts` | Versioned replay envelope with durable telemetry |
| `src/projection.ts` | `neuralwattUsage` fold and wire view |
| `src/catalog.ts` | Catalog lookups, selector metadata, catalog-backed discovery |
| `src/catalog.generated.ts` | Generated model list — do not edit |
| `src/discovery.ts` | `GET /models` interrogation for draft endpoints |
| `src/quota.ts` | Quota snapshot, cache, and report |
| `src/images.ts` | Request-image projection |
| `src/energy.ts` | Energy/carbon/grid and cost comment capture, flex queue tracking, formatting |
| `src/routes.ts` | Route id and exact-path names |
| `client.js` | Web half: composer pill and provider-card quota |
| `locale/*.json` | Plugin Manager title, description, and detail document |
| `scripts/sync-catalog.mjs` | Upstream catalog → DSH catalog projector |
| `scripts/build.mjs` | esbuild bundle, `@deepseek-ai/*` left external |

The adapter deliberately does not depend on `@earendil-works/pi-ai`. It needs the raw SSE side channel — the energy and cost comments — which a library-backed adapter cannot observe. A route with its own wire adapter is the composable alternative.

## Develop

```bash
npm install
npm run build      # esbuild → lib/index.js
npm run check      # tsc --noEmit + node --test
```

Tests run offline against the built bundle: catalog and selector metadata, message serialization (including the one-shot `system` prompt and cross-model thinking replay), SSE framing, chunk assembly, usage mapping, failure classification with retry facts, energy capture, image projection, the session projection fold, replay-envelope round trips, model-listing parsing, and full adapter round trips against a local fake endpoint (text, reasoning, tool call, usage, energy, HTTP failure, empty response, content refusal, quota route, discovery, and a volatile update).

Build output is not tracked; `npm test` and `npm pack` build it first. To load a working copy into a profile, build the checkout once, link it, and thereafter rebuild and let HMR recompose (refresh the page for `client.js`):

```bash
npm install && npm run build
dsh plugin --profile desktop add link:$PWD
# after a change:
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

- **Models page editing.** The route appears in the configurable-provider directory with its own card extension, which carries the API-key field and the account quota. The shipped Models editor has hand-written forms only for the first-party families, so the remaining Neuralwatt fields are edited in the profile patch (or the Settings/Config surface) rather than in that form.
- **Classifiers.** Upstream exposes Clef Flash and mammoth-1 through pi's classifier registry. DSH has no equivalent seam here, so they are filtered out rather than shown as chat models that would fail.
- **Model discovery is on demand.** The catalog is checked in; the Models page's "fetch available models" action asks `GET /models` (or the shipped catalog for this route), but nothing refreshes the list in the background.
- **Image token pricing.** Neuralwatt publishes no visual-token formula, so the adapter declares the request-image projection it sends and lets the harness's neutral estimate price image input. It does not declare a provider price.
- **Carbon history.** Carbon is captured from each response's `: energy` frame and stored with that message. Responses recorded before this build carry no carbon, so a session spanning the upgrade reports carbon only for later turns and shows "not reported" until one arrives; a measured zero is still reported as zero.
- **Timeouts are two bounds.** `requestTimeoutMs` is an overall deadline, and `idleTimeoutMs` fails a stream that stops making progress; a very long flex queue wait counts against the overall deadline.
- **Web rendering.** The pill and the provider card are contributions to shipped slots, so they follow the host's layout and theme; the page must be refreshed once after the first install to load `client.js`, and their rendered appearance was not verified without browser control.

## Attribution

- Provider behavior, catalogs, telemetry framing and model metadata are ported from [`monotykamary/pi-neuralwatt-provider`](https://github.com/monotykamary/pi-neuralwatt-provider) (MIT).
- The adapter contract follows the DSH documentation and the shipped `dsh-llm`, `dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-token-meter`, and `dsh-client-ui-chat` packages (MIT).
- Neuralwatt is a third-party service; this project is not affiliated with it.
