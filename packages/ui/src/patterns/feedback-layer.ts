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

type ControlGesture =
  | { kind: 'pressed'; pointerId: number; control: HTMLElement }
  | {
      kind: 'released'
      pointerId: number
      control: HTMLElement
      event: MouseEvent
      target: HTMLElement | null
    }
  | { kind: 'canceled' }

type FeedbackState = {
  channels: ReadonlySet<FeedbackChannel>
  volume: number
  context: AudioContext | null
  output: GainNode | null
  lastPlayed: Map<FeedbackVoice, number>
  playedInputs: WeakSet<Event>
  inputSources: WeakMap<Event, Event | null>
  gesture: ControlGesture | null
  releaseDispatch: MouseEvent | null
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
  playedInputs: new WeakSet(),
  inputSources: new WeakMap(),
  gesture: null,
  releaseDispatch: null,
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
  if (!audio || (channel !== 'controls' && !admit(voice))) return
  try {
    scheduleFeedbackVoice(audio.context, audio.output, voice)
  } catch {
    // Feedback never throws into the UI.
  }
}

/** Pointer input acknowledgement; keyboard and programmatic changes stay silent. */
export function playControlFeedback(voice: FeedbackVoice, event: Event) {
  playControlInput(voice, event, feedbackControl(event))
}

function playControlInput(voice: FeedbackVoice, event: Event, control: HTMLElement | null) {
  const source = controlInputSource(event)
  if (!source || state.playedInputs.has(source) || event.defaultPrevented) return
  if (
    control?.matches(
      ':disabled, [aria-disabled="true"], [data-disabled]:not([data-disabled="false"])',
    )
  )
    return
  if (control?.dataset.feedback === 'silent') return
  state.playedInputs.add(source)
  playFeedback(voice, 'controls')
}

function pointerInput(event: Event) {
  const pointer =
    typeof PointerEvent !== 'undefined' && event instanceof PointerEvent && event.pointerType !== ''
  const mouse = typeof MouseEvent !== 'undefined' && event instanceof MouseEvent && event.detail > 0
  return (pointer || mouse) && ['click', 'pointerup', 'mouseup', 'mousedown'].includes(event.type)
}

function parentPopup(popup: Element): Element | null {
  for (const trigger of popup.ownerDocument.querySelectorAll('[aria-controls]')) {
    if (trigger.getAttribute('aria-controls') !== popup.id) continue
    return trigger.closest('[role="menu"]')
  }
  return null
}

function popupRelease(gesture: Extract<ControlGesture, { kind: 'released' }>) {
  const controlledId = gesture.control.getAttribute('aria-controls')
  if (
    !controlledId ||
    !gesture.control.matches('[aria-haspopup="listbox"], [aria-haspopup="menu"]')
  )
    return false
  let popup = gesture.target?.closest('[role="listbox"], [role="menu"]') ?? null
  const visited = new Set<Element>()
  while (popup && !visited.has(popup)) {
    if (popup.id === controlledId) return true
    visited.add(popup)
    popup = parentPopup(popup)
  }
  return false
}

/** Capture the native press/release pair so generated picker clicks retain their real input. */
export function beginControlGesture(event: PointerEvent) {
  const control = feedbackControl(event)
  state.gesture =
    event.button === 0 && !event.defaultPrevented && control
      ? { kind: 'pressed', pointerId: event.pointerId, control }
      : null
}

export function cancelControlGesture(pointerId?: number) {
  if (
    pointerId !== undefined &&
    state.gesture &&
    state.gesture.kind !== 'canceled' &&
    state.gesture.pointerId !== pointerId
  )
    return
  state.gesture = { kind: 'canceled' }
  state.releaseDispatch = null
}

export function releaseControlGesture(event: MouseEvent) {
  if (event.button !== 0 || state.gesture?.kind !== 'pressed') return
  const gesture: Extract<ControlGesture, { kind: 'released' }> = {
    ...state.gesture,
    kind: 'released',
    event,
    target: feedbackControl(event),
  }
  state.gesture = gesture
  state.releaseDispatch = event
  // A task boundary expires stopped propagation without racing native event listeners.
  setTimeout(() => finishControlRelease(gesture), 0)
}

export function finishControlGesture(event: MouseEvent) {
  const gesture = state.gesture
  if (gesture?.kind === 'released' && gesture.event === event) finishControlRelease(gesture)
}

function finishControlRelease(gesture: Extract<ControlGesture, { kind: 'released' }>) {
  if (state.releaseDispatch !== gesture.event) return
  state.releaseDispatch = null
  if (state.gesture !== gesture || !popupRelease(gesture)) return
  const bounds = gesture.control.getBoundingClientRect()
  const { clientX, clientY } = gesture.event
  if (
    clientX < bounds.left ||
    clientX > bounds.right ||
    clientY < bounds.top ||
    clientY > bounds.bottom
  )
    return
  // An aligned popup can cover the trigger before its release, suppressing its native click.
  const voice = gesture.control.dataset.feedback === 'open' ? 'open' : 'tap'
  playControlInput(voice, gesture.event, gesture.control)
}

function controlInputSource(event: Event): Event | null {
  const known = state.inputSources.get(event)
  if (known !== undefined) return known
  const gesture = state.gesture
  if (event.type !== 'click') return pointerInput(event) ? event : null
  const generatedPopup =
    gesture?.kind === 'released' &&
    state.releaseDispatch === gesture.event &&
    gesture.event.eventPhase !== Event.NONE &&
    popupRelease(gesture) &&
    feedbackControl(event) === gesture.target
  if (!pointerInput(event) && !generatedPopup) return null
  if (gesture?.kind === 'canceled') {
    state.inputSources.set(event, null)
    state.gesture = null
    return null
  }
  const source = gesture?.kind === 'released' ? gesture.event : event
  const valid =
    gesture?.kind !== 'released' || gesture.control === gesture.target || popupRelease(gesture)
  state.inputSources.set(event, valid ? source : null)
  if (!generatedPopup) state.gesture = null
  return valid ? source : null
}

/** The innermost control owns a pointer action, including its explicit silence policy. */
export function feedbackControl(event: Event): HTMLElement | null {
  const target = event.composedPath().find((node) => node instanceof Element)
  if (!(target instanceof Element)) return null
  const control = target.closest<HTMLElement>(
    '[data-feedback], .pressable, [data-press-depth], [data-row-press], button, a[href], input, select, textarea, [role="button"], [role="option"], [role="treeitem"], [role="tab"], [role^="menuitem"]',
  )
  if (control) return control
  const label = target.closest('label')
  const labeledControl = label?.control
  if (!labeledControl) return null
  // Base UI's labelable checkbox sits beside its visible switch, after an optional hidden value.
  if (labeledControl.matches('input[type="checkbox"][aria-hidden="true"]')) {
    const sibling = labeledControl.previousElementSibling
    const visible = sibling?.matches('input[type="hidden"]')
      ? sibling.previousElementSibling
      : sibling
    return visible instanceof HTMLElement && visible.matches('[data-slot="switch"]')
      ? visible
      : labeledControl
  }
  return labeledControl
}

/** One enabled control acknowledges each pointer click, even when its action stops propagation. */
export function playClickFeedback(event: Event, currentTarget?: HTMLElement) {
  if (event.type !== 'click') return
  const control = feedbackControl(event)
  if (!control || (currentTarget && currentTarget !== control)) return
  const voice =
    control.dataset.feedback ??
    (control.matches('.pressable, [data-press-depth]') ? 'tap' : undefined)
  if (voice !== 'tap' && voice !== 'tick' && voice !== 'tick-off' && voice !== 'open') return
  const toggleOff = voice === 'tick' && control.matches('[role="switch"][aria-checked="true"]')
  playControlFeedback(toggleOff ? 'tick-off' : voice, event)
}

function admit(voice: FeedbackVoice) {
  const now = state.now()
  const last = state.lastPlayed.get(voice)
  const gap = MIN_GAP_MS[voice] ?? COALESCE_MS
  if (last !== undefined && now - last < gap) return false
  state.lastPlayed.set(voice, now)
  return true
}

export function scheduleFeedbackVoice(
  context: BaseAudioContext,
  output: AudioNode,
  voice: FeedbackVoice,
) {
  for (const click of VOICES[voice]) playClick(context, output, click)
}

function playClick(context: BaseAudioContext, output: AudioNode, click: Click) {
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
  state.playedInputs = new WeakSet()
  state.inputSources = new WeakMap()
  state.gesture = null
  state.releaseDispatch = null
}
