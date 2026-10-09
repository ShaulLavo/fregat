import * as v from 'valibot'
import { absolutePathSchema } from './absolute-path'

/** `POST /fs/native-picker` opens a folder chooser. `startingPath` is absolute on the server's machine. */
export const nativePickerRequestSchema = v.strictObject({
  startingPath: v.optional(absolutePathSchema),
})

/** The chosen folder is absolute on the server's machine; a cancelled chooser returns none. */
export const nativePickerResultSchema = v.variant('outcome', [
  v.object({
    outcome: v.literal('selected'),
    paths: v.pipe(v.array(absolutePathSchema), v.length(1)),
  }),
  v.object({ outcome: v.literal('cancelled'), paths: v.pipe(v.array(v.string()), v.length(0)) }),
])

/**
 * Codes `POST /fs/native-picker` answers with, besides the shared origin and pairing denials.
 * `NOT_LOCAL`: the request is not from this machine's own install origin over loopback.
 * `UNAVAILABLE`: no helper or no desktop session. `BUSY`: a chooser is already open on this desktop.
 */
export const nativePickerErrorCodes = [
  'system.NATIVE_PICKER_NOT_LOCAL',
  'system.NATIVE_PICKER_UNAVAILABLE',
  'system.NATIVE_PICKER_BUSY',
  'system.NATIVE_PICKER_INVALID_OPTIONS',
  'system.NATIVE_PICKER_TIMEOUT',
  'system.NATIVE_PICKER_FAILED',
] as const

export type NativePickerRequest = v.InferOutput<typeof nativePickerRequestSchema>
export type NativePickerResult = v.InferOutput<typeof nativePickerResultSchema>
export type NativePickerErrorCode = (typeof nativePickerErrorCodes)[number]
