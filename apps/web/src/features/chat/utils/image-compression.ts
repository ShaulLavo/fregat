/**
 * Downscale + re-encode for pasted or dropped images that are too big for the
 * wire. The point is to shrink instead of refuse: a retina screenshot is
 * routinely over the per-image cap, and rejecting it teaches the user that
 * pasting images does not work.
 *
 * Browser APIs only — `createImageBitmap` plus whichever canvas the runtime
 * has. No React, no module-level mutable state.
 */

import { type ChatAttachmentMimeType } from '@workspace/contracts'
import { MAX_COMPRESSIBLE_SOURCE_BYTES } from '@/features/chat/utils/input-attachment-limits'

/**
 * Longest edge kept when an image has to be re-encoded. Sized so a typical
 * retina screenshot (3024px wide) stays legible rather than being halved.
 */
export const MAX_IMAGE_DIMENSION = 2048

/**
 * Quality ladder walked in order until the encoded image fits the budget. The
 * floor stays high enough to avoid visible blocking on UI screenshots; if even
 * that overflows we drop resolution instead of quality.
 */
const QUALITY_LADDER = [0.92, 0.85, 0.78, 0.68] as const

/** Extra downscale passes applied when even the lowest quality overflows. */
const FALLBACK_SCALE_STEPS = [0.75, 0.55] as const

/**
 * Why compression gave up. The two are not interchangeable: `too-large` is a
 * budget verdict — bytes came back and every one of them overflowed, so
 * shrinking the source really is the fix. `unreadable` is machinery failing —
 * nothing was ever encoded — and telling the user to shrink the image would
 * send them off to fix something that was never the problem.
 */
export type ImageCompressionFailureReason = 'too-large' | 'unreadable'

export type CompressImageResult =
  | {
      ok: true
      file: File
      /** Media type of `file` — always inside the chat image allowlist. */
      mimeType: string
      /** False when the original bytes passed through untouched. */
      recompressed: boolean
    }
  | { ok: false; reason: ImageCompressionFailureReason }

/**
 * Shrinks `file` until its encoded size fits `maxBytes`, returning a new WebP
 * or JPEG `File`. Files already within the limit pass through byte-for-byte,
 * preserving their exact pixels and format (and PNG transparency).
 */
export async function compressImageToByteLimit(
  file: File,
  maxBytes: number,
): Promise<CompressImageResult> {
  if (file.size <= maxBytes) {
    return { ok: true, file, mimeType: file.type, recompressed: false }
  }
  // Decoding is the risk, so no amount of output budget makes a source this
  // large safe to touch.
  if (file.size > MAX_COMPRESSIBLE_SOURCE_BYTES) return { ok: false, reason: 'too-large' }
  // No image pipeline at all is the one capability failure that is still the
  // user's to act on: the file is over the cap and nothing here can shrink it,
  // so a smaller image genuinely does get through.
  if (!canEncodeImages()) return { ok: false, reason: 'too-large' }

  const bitmap = await decodeImage(file)
  if (!bitmap) return { ok: false, reason: 'unreadable' }

  try {
    const outcome = await encodeUnderByteLimit(bitmap, maxBytes)
    if (outcome.status === 'over-budget') return { ok: false, reason: 'too-large' }
    if (outcome.status === 'failed') return { ok: false, reason: 'unreadable' }

    const { blob, mimeType } = outcome.image

    return {
      ok: true,
      file: new File([blob], compressedFileName(file.name, mimeType), { type: mimeType }),
      mimeType,
      recompressed: true,
    }
  } finally {
    bitmap.close()
  }
}

/** Fits `width`x`height` inside `maxDimension` on its longest edge. */
export function scaledImageDimensions(width: number, height: number, maxDimension: number) {
  const longestEdge = Math.max(width, height)
  if (longestEdge <= 0) return { height: 1, width: 1 }

  const scale = Math.min(1, maxDimension / longestEdge)

  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  }
}

type EncodedImage = { blob: Blob; mimeType: ChatAttachmentMimeType }

/**
 * `over-budget` means the codec ran and its smallest output still overflowed;
 * `failed` means it produced nothing at all. Collapsing the two is what makes
 * a broken encoder look like an oversized image.
 */
type EncodeOutcome =
  | { status: 'encoded'; image: EncodedImage }
  | { status: 'over-budget' }
  | { status: 'failed' }

async function encodeUnderByteLimit(bitmap: ImageBitmap, maxBytes: number): Promise<EncodeOutcome> {
  // Each fallback pass shrinks relative to the bitmap's own clamped size rather
  // than a fixed 2048 ceiling: scaling the ceiling would be a no-op for images
  // already smaller than it, so the fallback passes would never reduce anything.
  const baseDimension = Math.min(MAX_IMAGE_DIMENSION, Math.max(bitmap.width, bitmap.height))
  let producedBytes = false

  for (const dimensionScale of [1, ...FALLBACK_SCALE_STEPS]) {
    const dimension = Math.max(1, Math.round(baseDimension * dimensionScale))
    const outcome = await encodeAtDimension(bitmap, dimension, maxBytes)
    if (outcome.status === 'encoded') return outcome

    producedBytes ||= outcome.status === 'over-budget'
  }

  return { status: producedBytes ? 'over-budget' : 'failed' }
}

async function encodeAtDimension(
  bitmap: ImageBitmap,
  maxDimension: number,
  maxBytes: number,
): Promise<EncodeOutcome> {
  const { height, width } = scaledImageDimensions(bitmap.width, bitmap.height, maxDimension)
  let producedBytes = false

  // Every surface in turn, not the first one that constructs. A browser can
  // ship `OffscreenCanvas` with a working 2D context and still refuse to encode
  // from it — Safari did for years — and that only surfaces at `convertToBlob`,
  // long after the surface was chosen. Falling through here is what makes the
  // element canvas reachable in the cases it exists for.
  for (const create of SURFACE_FACTORIES) {
    const surface = safeSurface(create, width, height)
    if (!surface) continue

    const attempt = await encodeOnSurface(surface, bitmap, maxBytes)
    if (attempt.status === 'encoded') return attempt
    if (attempt.status === 'over-budget') producedBytes = true
  }

  return { status: producedBytes ? 'over-budget' : 'failed' }
}

async function encodeOnSurface(
  surface: EncodeSurface,
  bitmap: ImageBitmap,
  maxBytes: number,
): Promise<EncodeOutcome> {
  // Probe the codec before drawing: JPEG has no alpha, so it needs a white
  // matte painted underneath, and we only know whether we need one after we
  // learn whether WebP is available.
  const mimeType = await preferredEncoding(surface)
  if (!drawBitmap(surface, bitmap, mimeType)) return { status: 'failed' }

  let producedBytes = false
  for (const quality of QUALITY_LADDER) {
    const blob = await encodeSurface(surface, mimeType, quality)
    if (!blob) continue

    producedBytes = true
    if (blob.size > maxBytes) continue

    return { status: 'encoded', image: { blob, mimeType } }
  }

  return { status: producedBytes ? 'over-budget' : 'failed' }
}

/**
 * WebP is preferred: at matched visual quality it lands roughly 25-35% smaller
 * than JPEG, so the same budget buys more resolution — and it keeps alpha, so
 * screenshots with transparency survive intact. Browsers that cannot encode it
 * hand back a differently-typed blob, which is our signal to fall back.
 */
async function preferredEncoding(surface: EncodeSurface): Promise<ChatAttachmentMimeType> {
  const probe = await encodeSurface(surface, 'image/webp', QUALITY_LADDER[0])

  return probe ? 'image/webp' : 'image/jpeg'
}

function drawBitmap(surface: EncodeSurface, bitmap: ImageBitmap, mimeType: ChatAttachmentMimeType) {
  const { height, width } = surface.canvas

  try {
    if (mimeType === 'image/jpeg') {
      surface.context.fillStyle = '#ffffff'
      surface.context.fillRect(0, 0, width, height)
    }
    surface.context.drawImage(bitmap, 0, 0, width, height)

    return true
  } catch {
    // Drawing is where the backing store is really allocated, so this is the
    // throw a memory-pressured tab produces. Let the smaller passes try.
    return false
  }
}

async function encodeSurface(
  surface: EncodeSurface,
  type: ChatAttachmentMimeType,
  quality: number,
): Promise<Blob | null> {
  try {
    const blob = await encodeBlob(surface, type, quality)
    if (!blob) return null
    // A container the browser cannot write comes back as a differently-typed
    // blob (PNG, per spec) instead of an error.
    if (blob.type && blob.type !== type) return null

    return blob
  } catch {
    // The codec itself can throw, often precisely because the target is too
    // big. Swallow it so the smaller fallback passes still get their turn — and
    // so nothing escapes into a caller that finalizes state after this returns.
    return null
  }
}

function encodeBlob(surface: EncodeSurface, type: ChatAttachmentMimeType, quality: number) {
  if (surface.kind === 'offscreen') return surface.canvas.convertToBlob({ quality, type })

  return elementBlob(surface.canvas, type, quality)
}

/** `toBlob` predates promises and reports "no encoding" as a null callback. */
function elementBlob(canvas: HTMLCanvasElement, type: ChatAttachmentMimeType, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })
}

/**
 * The 2D surface we draw onto, tagged by which canvas backs it. `OffscreenCanvas`
 * keeps the work off the element tree, but Safari shipped its encoder late and
 * embedded WebViews still ship without it — a plain `<canvas>` encodes the same
 * pixels, so an image that used to be refused now goes through. The tag is what
 * picks the encode call: `convertToBlob` versus callback-style `toBlob`.
 */
type EncodeSurface =
  | { kind: 'offscreen'; canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D }
  | { kind: 'element'; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }

type SurfaceFactory = (width: number, height: number) => EncodeSurface | null

const SURFACE_FACTORIES: readonly SurfaceFactory[] = [offscreenSurface, elementSurface]

/**
 * One surface's construction, isolated. Allocating a large canvas throws on a
 * memory-pressured tab, and a shared `try` around the whole chain would let an
 * offscreen throw swallow the element attempt that exists to survive it.
 */
function safeSurface(create: SurfaceFactory, width: number, height: number) {
  try {
    return create(width, height)
  } catch {
    return null
  }
}

function offscreenSurface(width: number, height: number): EncodeSurface | null {
  if (typeof OffscreenCanvas !== 'function') return null

  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) return null

  return { kind: 'offscreen', canvas, context }
}

function elementSurface(width: number, height: number): EncodeSurface | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null

  return { kind: 'element', canvas, context }
}

async function decodeImage(file: File) {
  try {
    return await createImageBitmap(file)
  } catch {
    return null
  }
}

function canEncodeImages() {
  if (typeof createImageBitmap !== 'function') return false

  return typeof OffscreenCanvas === 'function' || typeof document !== 'undefined'
}

/**
 * Re-encoding changes the container, so a name like `shot.png` would lie about
 * its contents. Swap the extension to match what we actually produced.
 */
function compressedFileName(name: string, mimeType: ChatAttachmentMimeType) {
  const extension = mimeType === 'image/webp' ? '.webp' : '.jpg'
  const dotIndex = name.lastIndexOf('.')
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name

  return `${base || 'image'}${extension}`
}
