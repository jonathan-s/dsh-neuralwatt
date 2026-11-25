# Neuralwatt provider for Deepseek Harness

Neuralwatt provides hosting for number of open models, such as Kimi, GLM, Qwen, DeepSeek, Gemma, MiMo. The main reason to chose Neuralwatt is its energy efficiency and carbon accounting. This plugin will surface these details in the UI.

The place to set it up is in Settings > Models where you insert the API key.

- [Neuralwatt provider for Deepseek Harness](#neuralwatt-provider-for-deepseek-harness)
  - [Install](#install)
  - [Authenticate](#authenticate)
  - [Energy, cost and quota](#energy-cost-and-quota)
  - [Develop](#develop)
  - [Known limits](#known-limits)
  - [Thanks](#thanks)

## Install

Install the plugin through plugins > Add plugin. Using the url of this repo.

## Authenticate

Get a key from [Neuralwatt](https://portal.neuralwatt.com/auth/register?ref=NW-JONATHAN-HBAF), using that link to sign-up gives you some credits later on. The simplest path is setting it up in **Settings → Models → Neuralwatt**.

You can also use the following bash command.

```bash
# Simplest for the Desktop app: the launcher reads $DSH_HOME/.env
printf 'NEURALWATT_API_KEY=<nw-key...>' >> "$HOME/.dsh/.env"

# Or a shell export for CLI launches
export NEURALWATT_API_KEY='nw-…'
```

## Energy, cost and quota

Neuralwatt reports energy, carbon footprint, and billed cost. The plugin reads those values and makes them visible at the very bottom of a session. The total amount of energy used is also visible during model selection.

## Develop

```bash
npm install
npm run build      # esbuild → lib/index.js
npm run check      # tsc --noEmit + node --test
```

Tests run offline against the built bundle: catalog and selector metadata, message serialization, SSE framing, chunk assembly, usage mapping, failure classification with retry facts, energy capture, image projection, the session projection fold, replay-envelope round trips, model-listing parsing, and full adapter round trips against a local fake endpoint (text, reasoning, tool call, usage, energy, HTTP failure, empty response, content refusal, quota route, discovery, and a volatile update).

```bash
npm install && npm run build
dsh plugin --profile desktop add link:$PWD
# after a change:
npm run build
```

## Known limits

- **Models page editing.** The route appears in the configurable-provider directory with its own card extension, which carries the API-key field and the account quota. The shipped Models editor has hand-written forms only for the first-party families, so the remaining Neuralwatt fields are edited in the profile patch (or the Settings/Config surface) rather than in that form.
- **Classifiers.** Upstream exposes Clef Flash and mammoth-1 through pi's classifier registry. DSH has no equivalent seam here, so they are filtered out rather than shown as chat models that would fail.
- **Model discovery is on demand.** The catalog is checked in; the Models page's "fetch available models" action asks `GET /models` (or the shipped catalog for this route), but nothing refreshes the list in the background.
- **Image token pricing.** Neuralwatt publishes no visual-token formula, so the adapter declares the request-image projection it sends and lets the harness's neutral estimate price image input. It does not declare a provider price.
- **Carbon history.** Carbon is captured from each response's `: energy` frame and stored with that message. Responses recorded before this build carry no carbon, so a session spanning the upgrade reports carbon only for later turns and shows "not reported" until one arrives; a measured zero is still reported as zero.
- **Timeouts are two bounds.** `requestTimeoutMs` is an overall deadline, and `idleTimeoutMs` fails a stream that stops making progress; a very long flex queue wait counts against the overall deadline.

## Thanks

This plugin is built upon the shoulders of [`monotykamary/pi-neuralwatt-provider`](https://github.com/monotykamary/pi-neuralwatt-provider) (MIT) and ported by Deepseek Flash 4
