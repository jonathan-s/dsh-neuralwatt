/**
 * Request-image projection for Neuralwatt's OpenAI-compatible endpoint.
 *
 * The endpoint accepts `image_url` data URLs but publishes no visual-token
 * formula, so this adapter declares no image pricing: the harness's neutral
 * estimate stays in charge of token accounting. It does declare the projection
 * it actually sends — a bounded long edge and encoded-byte target per image —
 * so a large screenshot is resized once, deterministically, instead of inflating
 * every request (and every retry) with megabyte base64 payloads.
 *
 * @module dsh-neuralwatt-provider/images
 */
import type { ImageAttachmentRef, ImageRequestTarget } from '@deepseek-ai/dsh-attachment'

/** Total-pixel budget for one request image; 2048 by 2048 at a square aspect. */
export const REQUEST_IMAGE_MAX_PIXELS = 2_048 * 2_048

/** Encoded-byte target for one request image before base64 expansion. */
export const REQUEST_IMAGE_MAX_BYTES = 1_048_576

/**
 * Resolve the dimensions and byte target sent for one retained image.
 * @param image - normalized image reference owned by the attachment service.
 * @returns the same aspect ratio, downscaled only when it exceeds the budget.
 */
export function resolveRequestImageTarget(image: ImageAttachmentRef): ImageRequestTarget {
  const width = Number.isFinite(image.width) && image.width > 0 ? image.width : 1
  const height = Number.isFinite(image.height) && image.height > 0 ? image.height : 1
  const bytes = Number.isFinite(image.bytes) && image.bytes > 0 ? image.bytes : REQUEST_IMAGE_MAX_BYTES
  const pixels = width * height
  const maxBytes = Math.min(bytes, REQUEST_IMAGE_MAX_BYTES)
  if (pixels <= REQUEST_IMAGE_MAX_PIXELS) return { width, height, maxBytes }
  const scale = Math.sqrt(REQUEST_IMAGE_MAX_PIXELS / pixels)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    maxBytes,
  }
}
