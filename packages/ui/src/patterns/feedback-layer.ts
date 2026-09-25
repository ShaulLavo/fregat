// The click voice follows web-haptics (MIT): a short noise burst through a narrow bandpass.

export type FeedbackVoice = 'tap' | 'tick' | 'tick-off' | 'open' | 'success' | 'error' | 'bell'
export type FeedbackChannel = 'controls' | 'errors' | 'git' | 'terminalBell' | 'agent'

type Click = { readonly intensity: number; readonly centre?: number; readonly delayMs?: number }

const VOICES: Record<FeedbackVoice, readonly Click[]> = {
  tap: [{ intensity: 0.4 }],
  tick: [{ intensity: 0.7 }],
  'tick-off': [{ intensity: 0.7, centre: 0.8 * (2000 + 0.7 * 2000) }],
  open: [{ intensity: 0.3, centre: 1600 }],
  success: [{ intensity: 0.5 }, { intensity: 0.7, delayMs: 60 }],
  error: [{ intensity: 1 }, { intensity: 0.9, delayMs: 45 }, { intensity: 1, delayMs: 90 }],
  bell: [{ intensity: 0.5, centre: 1200 }],
}

const COALESCE_MS = 30
const MIN_GAP_MS: Partial<Record<FeedbackVoice, number>> = { error: 2000, bell: 500 }

type FeedbackOptions = {
  readonly channels: readonly FeedbackChannel[]
  /** 0–100. */
  readonly volume: number
}

type FeedbackState = {
  channels: ReadonlySet<FeedbackChannel>
  volume: number
  context: AudioContext | null
  output: GainNode | null
  lastPlayed: Map<FeedbackVoice, number>
  createContext: () => AudioContext | null
  now: () => number
  hidden: () => boolean
}

const state: FeedbackState = {
  channels: new Set(),
  volume: 0.5,
  context: null,
  output: null,
  lastPlayed: new Map(),
  createContext: () =>
    typeof AudioContext === 'undefined' ? null : new AudioContext({ latencyHint: 'interactive' }),
  now: () => performance.now(),
  hidden: () => typeof document !== 'undefined' && document.hidden,
}

/** Which channels may sound and how loud. Call sites never read a setting; this is where it lands. */
export function configureFeedback({ channels, volume }: FeedbackOptions) {
  state.channels = new Set(channels)
  state.volume = Math.min(1, Math.max(0, volume / 100))
  if (state.output) state.output.gain.value = state.volume
  if (state.channels.size === 0) {
    document.removeEventListener('pointerdown', unlockFeedback, true)
    document.removeEventListener('keydown', unlockFeedback, true)
    return
  }
  document.addEventListener('pointerdown', unlockFeedback, true)
  document.addEventListener('keydown', unlockFeedback, true)
}

/** Browsers only start audio inside a gesture, so the context is created or resumed from one. */
export function unlockFeedback() {
  try {
    if (!state.context) {
      state.context = state.createContext()
      if (!state.context) return
      state.output = state.context.createGain()
      state.output.gain.value = state.volume
      state.output.connect(state.context.destination)
    }
    if (state.context.state === 'suspended') void state.context.resume().catch(() => undefined)
  } catch {
    state.context = null
    state.output = null
  }
}

/**
 * The shared output for `channel` when it may sound right now, or `null`. The agent notification
 * mp3s play through this; everything else goes through `playFeedback`.
 */
export function feedbackOutput(channel: FeedbackChannel) {
  // Agent notices exist for the user who looked away; every other sound needs the tab visible.
  if (!state.channels.has(channel) || (channel !== 'agent' && state.hidden())) return null
  const { context, output } = state
  if (!context || !output || context.state !== 'running') return null
  return { context, output }
}

export function playFeedback(voice: FeedbackVoice, channel: FeedbackChannel) {
  const audio = feedbackOutput(channel)
  if (!audio || !admit(voice)) return
  try {
    for (const click of VOICES[voice]) playClick(audio.context, audio.output, click)
  } catch {
    // Feedback never throws into the UI.
  }
}

function admit(voice: FeedbackVoice) {
  const now = state.now()
  const last = state.lastPlayed.get(voice)
  const gap = MIN_GAP_MS[voice] ?? COALESCE_MS
  if (last !== undefined && now - last < gap) return false
  state.lastPlayed.set(voice, now)
  return true
}

function playClick(context: AudioContext, output: AudioNode, click: Click) {
  const length = Math.ceil(context.sampleRate * 0.004)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const samples = buffer.getChannelData(0)
  const decay = context.sampleRate * 0.0005
  for (let index = 0; index < length; index += 1)
    samples[index] = (Math.random() * 2 - 1) * Math.exp(-index / decay)

  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 8
  const centre = click.centre ?? 2000 + click.intensity * 2000
  filter.frequency.value = centre * (1 + (Math.random() * 2 - 1) * 0.15)
  const gain = context.createGain()
  gain.gain.value = 0.5 * click.intensity

  source.connect(filter).connect(gain).connect(output)
  source.start(context.currentTime + (click.delayMs ?? 0) / 1000)
}

/** Test seam: swap the context factory, clock and visibility, and forget every played voice. */
export function resetFeedbackForTest(
  overrides: Partial<Pick<FeedbackState, 'createContext' | 'now' | 'hidden'>>,
) {
  Object.assign(state, overrides)
  state.context = null
  state.output = null
  state.lastPlayed.clear()
}
