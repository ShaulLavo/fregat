export type DecodeMode = 'autoregressive' | 'parallel' | 'diffusion' | 'token'

export type DecodePluginOptions = {
  /** Decoding style. Defaults to `autoregressive`. */
  readonly mode?: DecodeMode
  /** Typing speed: milliseconds per character (one step per character). Defaults to `20`. */
  readonly perCharMs?: number
  /**
   * `token` mode only: milliseconds per token (one step per token, steady rate
   * like an LLM streaming). Defaults to `65`.
   */
  readonly perTokenMs?: number
  /**
   * Global speed multiplier applied to whichever mode is active: `1` = default,
   * `2` = twice as fast, `0.5` = half. Defaults to `1`.
   */
  readonly speed?: number
  /**
   * Hard cap on the whole reveal. For the clip family the schedule scales to fit;
   * for `diffusion` it is the window over which glyphs settle. Defaults to `1400`.
   */
  readonly maxDurationMs?: number
  /**
   * `parallel` mode only: width of the random start-time window (ms). Each line
   * starts at a jittered offset in `[0, staggerMs)` so lines type out of phase
   * (scattered typists) instead of in a uniform wipe. Defaults to `420`.
   */
  readonly staggerMs?: number
  /** Safety cap on how many visible rows participate. Defaults to `400`. */
  readonly maxRows?: number
}

export type ResolvedDecodeOptions = {
  readonly mode: DecodeMode
  readonly perCharMs: number
  readonly perTokenMs: number
  readonly speed: number
  readonly maxDurationMs: number
  readonly staggerMs: number
  readonly maxRows: number
}

const DEFAULTS: ResolvedDecodeOptions = {
  mode: 'autoregressive',
  // ~one glyph per frame: fast, but the per-character steps stay visible so it
  // reads as typing rather than a smooth wipe.
  perCharMs: 20,
  // ~15 tokens/sec — brisk LLM streaming cadence.
  perTokenMs: 65,
  speed: 1,
  maxDurationMs: 1400,
  staggerMs: 420,
  maxRows: 400,
}

export function resolveDecodeOptions(options: DecodePluginOptions): ResolvedDecodeOptions {
  return {
    mode: resolveMode(options.mode),
    perCharMs: positiveNumber(options.perCharMs, DEFAULTS.perCharMs),
    perTokenMs: positiveNumber(options.perTokenMs, DEFAULTS.perTokenMs),
    speed: positiveNumber(options.speed, DEFAULTS.speed),
    maxDurationMs: positiveNumber(options.maxDurationMs, DEFAULTS.maxDurationMs),
    staggerMs: nonNegativeNumber(options.staggerMs, DEFAULTS.staggerMs),
    maxRows: Math.floor(positiveNumber(options.maxRows, DEFAULTS.maxRows)),
  }
}

function resolveMode(mode: DecodeMode | undefined): DecodeMode {
  if (mode === 'parallel' || mode === 'diffusion' || mode === 'token') return mode
  return DEFAULTS.mode
}

function positiveNumber(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0) return fallback
  return value
}
