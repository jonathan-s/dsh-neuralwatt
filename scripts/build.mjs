#!/usr/bin/env node
/**
 * Build the installable bundle: one ESM file under lib/ with every
 * `@deepseek-ai/*` package left external so the host's instance is the one
 * loaded (peers at the profile's lookup position).
 */
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'

const outdir = new URL('../lib/', import.meta.url)

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  outfile: new URL('../lib/index.js', import.meta.url).pathname,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none',
  external: ['@deepseek-ai/*'],
  logLevel: 'info',
})

console.log('built lib/index.js')
