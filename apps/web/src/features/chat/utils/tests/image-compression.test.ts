import { afterEach } from 'vitest'

import { expect, test } from '../../../../../test/fixtures'
import { MAX_COMPRESSIBLE_SOURCE_BYTES } from '@/features/chat/utils/input-attachment-limits'
import {
  compressImageToByteLimit,
  MAX_IMAGE_DIMENSION,
  scaledImageDimensions,
} from '@/features/chat/utils/image-compression'
import { createClientInvariantError } from '@/lib/structured-errors'

// The node project has no canvas and no codecs, so the encode ladder is only
// reachable behind stand-ins for the browser globals the module reads. Those
// stand in for the *platform*; `compressImageToByteLimit` itself runs for real.
function imageFile(sizeBytes: number, type = 'image/png') {
  const file = new File([new Uint8Array(1)], 'shot.png', { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })

  return file
}

test('clamps the longest edge of a landscape image and keeps the aspect ratio', () => {
  expect(scaledImageDimensions(4000, 3000, MAX_IMAGE_DIMENSION)).toEqual({
    height: 1536,
    width: 2048,
  })
})

test('clamps the longest edge of a portrait image', () => {
  expect(scaledImageDimensions(3000, 4000, MAX_IMAGE_DIMENSION)).toEqual({
    height: 2048,
    width: 1536,
  })
})

test('never upscales an image already inside the ceiling', () => {
  expect(scaledImageDimensions(800, 600, MAX_IMAGE_DIMENSION)).toEqual({ height: 600, width: 800 })
})

test('a fallback pass below the ceiling really does shrink the image', () => {
  // The fallback steps scale the bitmap's own clamped size; scaling a fixed
  // 2048 ceiling instead would leave an 800px source untouched forever.
  expect(scaledImageDimensions(800, 600, Math.round(800 * 0.55))).toEqual({
    height: 330,
    width: 440,
  })
})

test('keeps at least one pixel on each edge for extreme aspect ratios', () => {
  expect(scaledImageDimensions(4096, 1, MAX_IMAGE_DIMENSION)).toEqual({ height: 1, width: 2048 })
})

test('degenerate dimensions do not produce a zero-sized canvas', () => {
  expect(scaledImageDimensions(0, 0, MAX_IMAGE_DIMENSION)).toEqual({ height: 1, width: 1 })
})

test('an image already under the cap passes through as the exact same File', async () => {
  const original = imageFile(1024)

  const result = await compressImageToByteLimit(original, 10 * 1024 * 1024)

  expect(result).toEqual({
    ok: true,
    file: original,
    mimeType: 'image/png',
    recompressed: false,
  })
  // Pass-through must be the same object, not a re-encoded copy.
  expect(result.ok && result.file).toBe(original)
})

test('refuses a source above the decode-safety ceiling without touching it', async () => {
  const result = await compressImageToByteLimit(
    imageFile(MAX_COMPRESSIBLE_SOURCE_BYTES + 1),
    10 * 1024 * 1024,
  )

  expect(result).toEqual({ ok: false, reason: 'too-large' })
})

test('reports too-large when the environment has no image pipeline at all', async () => {
  // No createImageBitmap, no canvas of either kind. Nothing here can shrink the
  // file, so "too large" is the one message the user can still act on.
  const result = await compressImageToByteLimit(imageFile(20 * 1024 * 1024), 10 * 1024 * 1024)

  expect(result).toEqual({ ok: false, reason: 'too-large' })
})

test('re-encodes through a canvas element when OffscreenCanvas is missing', async () => {
  const calls = stubImageEnvironment({ canvases: ['element'] })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024 * 1024)

  expect(result.ok && result.mimeType).toBe('image/webp')
  expect(result.ok && result.recompressed).toBe(true)
  expect(result.ok && result.file.name).toBe('shot.webp')
  expect(calls.canvasElements).toBe(1)
  // The first pass draws at the 2048 ceiling, not at the 4000px source width.
  expect(calls.attempts[0]).toEqual({
    height: 1536,
    quality: 0.92,
    type: 'image/webp',
    width: 2048,
  })
})

test('prefers OffscreenCanvas over a canvas element when both exist', async () => {
  const calls = stubImageEnvironment({ canvases: ['element', 'offscreen'] })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024 * 1024)

  expect(result.ok).toBe(true)
  expect(calls.canvasElements).toBe(0)
})

test('falls back to JPEG and paints a matte when the WebP codec is unavailable', async () => {
  const calls = stubImageEnvironment({
    canvases: ['element'],
    // A browser that cannot write WebP hands back a PNG instead of failing.
    encode: ({ type }) => blobOfSize(512, type === 'image/webp' ? 'image/png' : type),
  })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024 * 1024)

  expect(result.ok && result.mimeType).toBe('image/jpeg')
  expect(result.ok && result.file.name).toBe('shot.jpg')
  // JPEG has no alpha, so without the matte every transparent pixel goes black.
  expect(calls.matteFills).toBe(1)
})

test('an encoder that throws is reported as unreadable, never as too-large', async () => {
  const calls = stubImageEnvironment({
    canvases: ['offscreen'],
    encode: () => {
      throw createClientInvariantError('Stub codec refused to encode.')
    },
  })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024 * 1024)

  // Calling this "too large" would send the user off to shrink an image whose
  // size was never established — the codec never produced a byte to measure.
  expect(result).toEqual({ ok: false, reason: 'unreadable' })
  // Every fallback pass still got its turn: 3 dimensions x (probe + 4 qualities).
  expect(calls.attempts).toHaveLength(15)
})

test('an OffscreenCanvas that refuses to allocate still reaches the element canvas', async () => {
  const calls = stubImageEnvironment({
    canvases: ['element', 'offscreen'],
    offscreenConstructorThrows: true,
  })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024 * 1024)

  // The whole point of the element fallback is the browsers where the offscreen
  // path is unusable; a shared try around both would swallow it into 'unreadable'.
  expect(result.ok).toBe(true)
  expect(calls.canvasElements).toBe(1)
})

test('an OffscreenCanvas that draws but cannot encode still reaches the element canvas', async () => {
  const calls = stubImageEnvironment({
    canvases: ['element', 'offscreen'],
    offscreenEncodeThrows: true,
  })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024 * 1024)

  // Safari shipped exactly this for years: a real 2D context with no encoder
  // behind it, which only shows up at convertToBlob — after the surface was picked.
  expect(result.ok).toBe(true)
  expect(calls.canvasElements).toBe(1)
})

test('a context that cannot draw is unreadable rather than an escaped throw', async () => {
  stubImageEnvironment({ canvases: ['offscreen'], drawThrows: true })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024 * 1024)

  // Drawing is where the backing store is really allocated, so this is the
  // throw a memory-pressured tab produces. It must not escape the compressor.
  expect(result).toEqual({ ok: false, reason: 'unreadable' })
})

test('a canvas that yields no 2D context is reported as unreadable', async () => {
  stubImageEnvironment({ canvases: ['offscreen'], withContext: false })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024 * 1024)

  expect(result).toEqual({ ok: false, reason: 'unreadable' })
})

test('a file the decoder refuses is reported as unreadable', async () => {
  stubImageEnvironment({ canvases: ['offscreen'], decode: 'reject' })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024 * 1024)

  expect(result).toEqual({ ok: false, reason: 'unreadable' })
})

test('an image whose smallest encoding still overflows is reported as too-large', async () => {
  const calls = stubImageEnvironment({
    canvases: ['offscreen'],
    encode: ({ type }) => blobOfSize(4096, type),
  })

  const result = await compressImageToByteLimit(imageFile(4 * 1024 * 1024), 1024)

  // Here the bytes exist and were measured, so the size verdict is earned.
  expect(result).toEqual({ ok: false, reason: 'too-large' })
  const widths = calls.attempts.map((attempt) => attempt.width)
  expect(Math.min(...widths)).toBeLessThan(Math.max(...widths))
})

afterEach(() => {
  for (const name of ['OffscreenCanvas', 'createImageBitmap', 'document']) {
    Reflect.deleteProperty(globalThis, name)
  }
})

type EncodeAttempt = { height: number; quality: number; type: string; width: number }

type EnvironmentCalls = {
  /** Every encode the module asked for, in order, across all fallback passes. */
  attempts: EncodeAttempt[]
  /** How often the module reached for `document.createElement('canvas')`. */
  canvasElements: number
  /** How often a white JPEG matte was painted. */
  matteFills: number
}

type StubOptions = {
  canvases: readonly ('element' | 'offscreen')[]
  decode?: 'reject'
  /** Makes the 2D context refuse to draw, the way a memory-pressured tab does. */
  drawThrows?: boolean
  encode?: (attempt: EncodeAttempt) => Blob | null
  /** Makes `new OffscreenCanvas()` itself throw, before any context exists. */
  offscreenConstructorThrows?: boolean
  /** Makes an offscreen surface that draws fine and cannot encode. */
  offscreenEncodeThrows?: boolean
  withContext?: boolean
}

type StubContext = {
  drawImage: () => void
  fillRect: () => void
  fillStyle: string
}

type StubCanvasElement = {
  getContext: () => StubContext | null
  height: number
  toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => void
  width: number
}

type StubState = {
  context: StubContext | null
  encode: (attempt: EncodeAttempt) => Blob | null
}

function stubImageEnvironment(options: StubOptions): EnvironmentCalls {
  const calls: EnvironmentCalls = { attempts: [], canvasElements: 0, matteFills: 0 }
  const encode = options.encode ?? (({ type }: EncodeAttempt) => blobOfSize(512, type))
  const state: StubState = {
    context: options.withContext === false ? null : stubContext(calls, options.drawThrows),
    encode: (attempt) => {
      calls.attempts.push(attempt)

      return encode(attempt)
    },
  }

  defineGlobal('createImageBitmap', stubDecoder(options))
  if (options.canvases.includes('offscreen')) {
    defineGlobal('OffscreenCanvas', stubOffscreenCanvasClass(state, options))
  }
  if (options.canvases.includes('element')) {
    defineGlobal('document', stubDocument(calls, state))
  }

  return calls
}

function stubDecoder({ decode }: StubOptions) {
  return () => {
    if (decode === 'reject') {
      return Promise.reject(createClientInvariantError('Stub decoder refused the file.'))
    }

    return Promise.resolve({ close: () => {}, height: 3000, width: 4000 })
  }
}

function stubContext(calls: EnvironmentCalls, drawThrows = false): StubContext {
  return {
    drawImage: () => {
      if (!drawThrows) return

      throw new RangeError('out of memory')
    },
    fillRect: () => {
      calls.matteFills += 1
    },
    fillStyle: '',
  }
}

function stubOffscreenCanvasClass(state: StubState, options: StubOptions) {
  return class {
    height: number
    width: number

    constructor(width: number, height: number) {
      if (options.offscreenConstructorThrows) throw new RangeError('out of memory')

      this.height = height
      this.width = width
    }

    getContext() {
      return state.context
    }

    convertToBlob({ quality, type }: { quality: number; type: string }) {
      // What Safari did for years: a real 2D context, no encoder behind it.
      if (options.offscreenEncodeThrows) throw new TypeError('convertToBlob is not a function')

      const { height, width } = this

      return Promise.resolve(state.encode({ height, quality, type, width }))
    }
  }
}

function stubDocument(calls: EnvironmentCalls, state: StubState) {
  return {
    createElement: () => {
      calls.canvasElements += 1

      return stubCanvasElement(state)
    },
  }
}

function stubCanvasElement(state: StubState): StubCanvasElement {
  const canvas: StubCanvasElement = {
    getContext: () => state.context,
    height: 0,
    toBlob: (callback, type, quality) => {
      callback(state.encode({ height: canvas.height, quality, type, width: canvas.width }))
    },
    width: 0,
  }

  return canvas
}

function blobOfSize(bytes: number, type: string) {
  return new Blob([new Uint8Array(bytes)], { type })
}

function defineGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
}

test('converts HEIC even below the upload budget', async () => {
  stubImageEnvironment({ canvases: ['offscreen'] })
  const result = await compressImageToByteLimit(imageFile(512, 'image/heic'), 1024 * 1024)
  expect(result.ok && result.recompressed).toBe(true)
  expect(result.ok && result.mimeType).toBe('image/webp')
})
