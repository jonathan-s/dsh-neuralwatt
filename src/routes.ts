/**
 * Route identity and the exact-path names the bundle registers.
 *
 * @module dsh-neuralwatt-provider/routes
 */

/** Provider route this plugin owns. */
export const ROUTE = 'neuralwatt'

/** Loader row id inserted by this bundle's patch; also the fallback settings namespace. */
export const SETTINGS_NAMESPACE_FALLBACK = 'llm-neuralwatt'

/** Browser-fetch route serving the account quota snapshot to the provider card. */
export const QUOTA_PATH = '/api/neuralwatt.quota'
