/**
 * How an opened file arrives. `magicMove` carries the text the previous file shares with it from
 * where it stood to where it stands now; the rest fades out and in.
 */
export type FileTransitionMode = 'autoregressive' | 'parallel' | 'diffusion' | 'token' | 'magicMove'

export type FileTransitionPluginOptions = {
  /** How the opened file writes itself in. Defaults to `autoregressive`. */
  readonly mode?: FileTransitionMode
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
   * Hard cap on the whole reveal. The typing modes' schedule scales to fit; for
   * `diffusion` it is the window over which pieces settle. Defaults to `1400`.
   */
  readonly maxDurationMs?: number
  /**
   * `parallel` mode only: width of the random start-time window (ms). Each line
   * starts at a jittered offset in `[0, staggerMs)` so lines type out of phase
   * (scattered typists) instead of in lockstep. Defaults to `420`.
   */
  readonly staggerMs?: number
  /** Safety cap on how many visible rows participate. Defaults to `400`. */
  readonly maxRows?: number
}

export type ResolvedTransitionOptions = {
  readonly mode: FileTransitionMode
  readonly perCharMs: number
  readonly perTokenMs: number
  readonly speed: number
  readonly maxDurationMs: number
  readonly staggerMs: number
  readonly maxRows: number
}

const DEFAULTS: ResolvedTransitionOptions = {
  mode: 'autoregressive',
  // ~one character per frame: fast, but still reads as typing.
  perCharMs: 20,
  // ~15 tokens/sec — brisk LLM streaming cadence.
  perTokenMs: 65,
  speed: 1,
  maxDurationMs: 1400,
  staggerMs: 420,
  maxRows: 400,
}

export function resolveTransitionOptions(
  options: FileTransitionPluginOptions,
): ResolvedTransitionOptions {
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

function resolveMode(mode: FileTransitionMode | undefined): FileTransitionMode {
  if (mode === 'parallel' || mode === 'diffusion' || mode === 'token' || mode === 'magicMove')
    return mode
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
