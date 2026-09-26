import { clientErrors } from '@/lib/structured-errors'

const FRAME_TIMEOUT_MS = 10_000

export function screenCaptureSupported(mediaDevices: MediaDevices | undefined) {
  return typeof mediaDevices?.getDisplayMedia === 'function'
}

/**
 * One frame of a screen, window or tab as a PNG `File`, or null when the user
 * dismissed the picker. Every track stops before this returns, so the browser's
 * sharing indicator never outlives the capture.
 */
export async function captureScreenshot(mediaDevices: MediaDevices, now = new Date()) {
  const stream = await requestStream(mediaDevices)
  if (!stream) return null

  try {
    const blob = await firstFrame(stream)
    return new File([blob], `screenshot-${now.toISOString().replaceAll(':', '-')}.png`, {
      type: 'image/png',
    })
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}

async function requestStream(mediaDevices: MediaDevices) {
  try {
    const options: DisplayMediaStreamOptions & { controller?: CaptureController } = {
      audio: false,
      video: true,
      controller: keepFocus(),
    }
    return await mediaDevices.getDisplayMedia(options)
  } catch (error) {
    if (isCancel(error)) return null
    throw captureFailed('request', error)
  }
}

/** Chromium switches to a captured tab or window unless told to keep focus here. */
function keepFocus() {
  const Controller = (globalThis as { CaptureController?: new () => CaptureController })
    .CaptureController
  if (!Controller) return undefined
  const controller = new Controller()
  // Chromium before 124 throws when this runs ahead of getDisplayMedia; capture still works.
  try {
    controller.setFocusBehavior?.('focus-capturing-application')
  } catch {
    return undefined
  }
  return controller
}

type CaptureController = {
  setFocusBehavior?: (behavior: 'focus-capturing-application' | 'no-focus-change') => void
}

async function firstFrame(stream: MediaStream) {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await withTimeout(loadedMetadata(video), 'metadata')
  await video.play()
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context || canvas.width === 0) throw captureFailed('frame', null)
  context.drawImage(video, 0, 0)
  video.srcObject = null

  return canvasPng(canvas)
}

function loadedMetadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true })
  })
}

function canvasPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(captureFailed('encode', null))),
      'image/png',
    )
  })
}

function withTimeout<T>(promise: Promise<T>, stage: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(captureFailed(stage, 'timeout')), FRAME_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Dismissing the picker rejects with `NotAllowedError`; that is a choice, not a failure. */
function isCancel(error: unknown) {
  return error instanceof DOMException && error.name === 'NotAllowedError'
}

function captureFailed(stage: string, cause: unknown) {
  return clientErrors.SCREEN_CAPTURE_FAILED({
    internal: { errorName: cause instanceof Error ? cause.name : String(cause), stage },
  })
}
