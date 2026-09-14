import { createScriptError } from '../structured-errors'

export type CaptureSize = {
  readonly width: number
  readonly height: number
  readonly scale: number
}

export function captureSize(values: {
  readonly width?: string
  readonly height?: string
  readonly scale?: string
}): CaptureSize {
  return {
    width: boundedNumber('width', values.width, 1440, 320, 4096, true),
    height: boundedNumber('height', values.height, 1000, 240, 4096, true),
    scale: boundedNumber('scale', values.scale, 1, 1, 3, false),
  }
}

function boundedNumber(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  integer: boolean,
) {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw createScriptError(
      `--${name} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`,
    )
  return value
}
