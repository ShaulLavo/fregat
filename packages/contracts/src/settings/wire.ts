import * as v from 'valibot'
import { SETTING_IDS, settingsValuesSchema } from './keys'
import { SETTINGS_LAYER_ORDER } from './resolve'

export const settingIdSchema = v.picklist(SETTING_IDS)

const settingsLayerIdSchema = v.picklist(SETTINGS_LAYER_ORDER)

/** A layer a client may write to. Policy is read-only by definition. */
export const settingsWriteTargetSchema = v.picklist(['user', 'workspace'] as const)

/** Ordered only within one server process lifetime. */
export const settingsServerVersionSchema = v.strictObject({
  epoch: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  sequence: v.pipe(v.number(), v.integer(), v.minValue(0)),
})

const settingsDiagnosticSchema = v.object({
  kind: v.picklist([
    'unknown-key',
    'scope-not-allowed',
    'invalid-value',
    'migrated',
    'removed-key',
  ] as const),
  id: v.string(),
  layer: settingsLayerIdSchema,
  detail: v.optional(v.string()),
})

/** Where a syntax error is, so the JSON view can put a squiggle on it. */
const settingsParseErrorSchema = v.object({
  message: v.string(),
  offset: v.number(),
  length: v.number(),
})

/** A source span in the exact settings document bytes carried beside it. */
const settingsTextRangeSchema = v.object({
  offset: v.number(),
  length: v.number(),
})

/**
 * The layer's file, as bytes.
 *
 * Carried on the snapshot rather than fetched separately so that the JSON view
 * and the page agree by construction: one broadcast, one revision, one answer to
 * "is this document broken". A second round trip could land either side of a
 * write and show a document that never existed.
 *
 * `parseErrors` being non-empty is also what says `raw` above is the *last good*
 * parse rather than what these bytes mean — the two disagree exactly while the
 * file is broken, which is the state the banner exists to explain.
 */
const settingsLayerFileSchema = v.object({
  text: v.string(),
  revision: v.string(),
  parseErrors: v.array(settingsParseErrorSchema),
  keyRanges: v.record(v.string(), settingsTextRangeSchema),
})

/**
 * One layer as the client sees it: the unfiltered contents, so the page can
 * render "set here but not applied" without a second round trip.
 */
const settingsLayerSnapshotSchema = v.object({
  id: settingsLayerIdSchema,
  /** Absent when the layer has no file — no workspace open, no policy configured. */
  present: v.boolean(),
  raw: v.record(v.string(), v.unknown()),
  /**
   * Absent only for `policy`, which is an environment variable and has no file
   * to edit.
   *
   * Present for a writable layer whose file does not exist yet, with an empty
   * `text` and an empty `revision` — that is not a missing value, it is the
   * state a fresh install is in, and it is exactly when the JSON view has to be
   * able to open a blank document and create the file. `present` above is what
   * distinguishes "no file" from "a file someone emptied"; this field answers
   * the different question of what the bytes are.
   */
  file: v.optional(settingsLayerFileSchema),
})

export const settingsSnapshotSchema = v.strictObject({
  values: settingsValuesSchema,
  layers: v.array(settingsLayerSnapshotSchema),
  diagnostics: v.array(settingsDiagnosticSchema),
  serverVersion: settingsServerVersionSchema,
})

export type SettingsLayerFile = v.InferOutput<typeof settingsLayerFileSchema>
export type SettingsLayerSnapshot = v.InferOutput<typeof settingsLayerSnapshotSchema>
export type SettingsParseError = v.InferOutput<typeof settingsParseErrorSchema>
export type SettingsServerVersion = v.InferOutput<typeof settingsServerVersionSchema>
export type SettingsTextRange = v.InferOutput<typeof settingsTextRangeSchema>
export type SettingsSnapshot = v.InferOutput<typeof settingsSnapshotSchema>
export type SettingsWriteTarget = v.InferOutput<typeof settingsWriteTargetSchema>
