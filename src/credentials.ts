/**
 * Credential resolution for the Neuralwatt route.
 *
 * The harness credential seam is authoritative when it is mounted, including
 * its answer "nothing is configured": a stored value outranks the launching
 * environment, and falling through to another source after a miss would let an
 * unrelated ambient value authenticate a request the deployment meant to
 * authenticate differently. The launch environment is read only when no
 * credentials service is mounted, and configuration never carries the secret
 * itself.
 *
 * @module dsh-neuralwatt-provider/credentials
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError, assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import { PACKAGE } from './options.js'

/** Structural face of the optional credentials service this plugin consumes. */
interface CredentialStore {
  resolve(ref: CredentialRef): Promise<{ value: string } | undefined>
  describe(ref: CredentialRef): Promise<{ configured: boolean }>
}

/** Read the optional credentials service without making it a hard dependency. */
function storeOf(ctx: Context): CredentialStore | undefined {
  return ctx.get('credentials') as CredentialStore | undefined
}

/** The one remediation message a missing key deserves, naming every fix. */
function missingCredential(ref: CredentialRef): LlmError {
  return new LlmError(
    `${PACKAGE}: no credential for the neuralwatt route; ${ref} is not set. Store ${ref} through the credentials`
    + ` service (the web Models page writes it), or export it in the launching environment.`,
    'MISSING_CREDENTIAL',
  )
}

/**
 * Resolve and validate the API key for one request.
 * @param ctx - plugin context, which may or may not carry a credentials service.
 * @param ref - the credential reference named by configuration.
 * @returns the trimmed, header-safe key.
 * @throws LlmError with `MISSING_CREDENTIAL` when nothing is configured, or
 *   `INVALID_CREDENTIAL` when the value cannot be sent.
 */
export async function resolveApiKey(ctx: Context, ref: CredentialRef): Promise<string> {
  const store = storeOf(ctx)
  if (store !== undefined) {
    const hit = await store.resolve(ref)
    if (hit === undefined || hit.value.length === 0) throw missingCredential(ref)
    return assertUsableApiKey(hit.value, PACKAGE, ref)
  }
  const ambient = launchEnvironmentOf(ctx).get(ref)
  if (ambient === undefined || ambient.value.length === 0) throw missingCredential(ref)
  return assertUsableApiKey(ambient.value, PACKAGE, ref)
}

/**
 * Check key presence without reading the stored value.
 * @param ctx - plugin context.
 * @param ref - the credential reference named by configuration.
 * @returns whether a usable credential is configured.
 */
export async function apiKeyConfigured(ctx: Context, ref: CredentialRef): Promise<boolean> {
  const store = storeOf(ctx)
  if (store !== undefined) return (await store.describe(ref)).configured
  return (launchEnvironmentOf(ctx).get(ref)?.value.length ?? 0) > 0
}
