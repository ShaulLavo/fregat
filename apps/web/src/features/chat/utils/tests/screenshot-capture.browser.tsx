import { afterEach, expect, it, vi } from 'vitest'

import { captureScreenshot, screenCaptureSupported } from '@/features/chat/utils/screenshot-capture'

afterEach(() => {
  vi.restoreAllMocks()
})

/** A real `MediaStream` with a painted video track, standing in for the OS share picker. */
function paintedScreen() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 48
  const context = canvas.getContext('2d')
  if (!context) throw new TypeError('No 2D canvas in this browser')
  context.fillStyle = '#c33'
  context.fillRect(0, 0, 64, 48)
  return canvas.captureStream()
}

function devices(getDisplayMedia: () => Promise<MediaStream>) {
  return { getDisplayMedia } as unknown as MediaDevices
}

function ended(stream: MediaStream) {
  return stream.getTracks().every((track) => track.readyState === 'ended')
}

it('turns one frame into a PNG file and stops every track', async () => {
  const stream = paintedScreen()

  const file = await captureScreenshot(
    devices(async () => stream),
    new Date('2026-09-25T12:00:00.000Z'),
  )

  expect(file?.name).toBe('screenshot-2026-09-25T12-00-00.000Z.png')
  expect(file?.type).toBe('image/png')
  expect(file?.size).toBeGreaterThan(0)
  expect(ended(stream)).toBe(true)
})

it('stages nothing when the user dismisses the picker', async () => {
  const file = await captureScreenshot(
    devices(async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }),
  )

  expect(file).toBeNull()
})

it('fails with the catalog error and still stops every track when no frame encodes', async () => {
  const stream = paintedScreen()
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null))

  await expect(captureScreenshot(devices(async () => stream))).rejects.toMatchObject({
    code: 'client.SCREEN_CAPTURE_FAILED',
    fix: expect.stringContaining('Attach the image as a file'),
  })
  expect(ended(stream)).toBe(true)
})

it('reports capture as unsupported without getDisplayMedia', () => {
  expect(screenCaptureSupported(undefined)).toBe(false)
  expect(screenCaptureSupported({} as MediaDevices)).toBe(false)
  expect(screenCaptureSupported(navigator.mediaDevices)).toBe(true)
})
