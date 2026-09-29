import { createAnchoredSurface } from '@singapore-editor/plugin-ui/anchored-surface'

export type RenameWidgetOptions = {
  readonly document: Document
  /** Element whose computed style carries the editor theme variables. */
  readonly themeSource: HTMLElement
  readonly classNamespace?: string
  /** Called when the prompt closes while it holds focus, which hiding it would otherwise strand. */
  readonly returnFocus?: () => void
}

type RenameWidgetPrompt = {
  readonly anchor: DOMRect
  readonly currentName: string
  readonly signal: AbortSignal
}

export type RenameWidgetController = {
  /** Shows the input and resolves with the new name, or null when dismissed. */
  prompt(options: RenameWidgetPrompt): Promise<string | null>
  /** Moves an open prompt to where the symbol is drawn now. */
  reanchor(anchor: DOMRect): void
  containsTarget(target: EventTarget | null): boolean
  dispose(): void
}

type RenamePromptState = {
  removeAbortListener: (() => void) | null
  settle: ((value: string | null) => void) | null
}

const THEME_VARIABLES = [
  '--editor-background',
  '--editor-popup-background',
  '--editor-foreground',
  '--editor-font-family',
  '--editor-font-size',
] as const

/** Tighter than the tooltips: the input reads as attached to the symbol, not floating near it. */
const RENAME_GAP_PX = 4

/**
 * The editor's own rename input: a small floating field anchored at the symbol.
 *
 * It exists so the engine is usable on its own. A host with its own dialog language passes
 * `onRequestRenameName` instead and this is never built.
 */
export function createRenameWidgetController(options: RenameWidgetOptions): RenameWidgetController {
  const namespace = options.classNamespace ?? 'lsp-plugin'
  const element = options.document.createElement('div')
  element.className = `${namespace}-rename`
  element.style.zIndex = '60'
  element.style.display = 'none'
  element.style.background = 'var(--editor-popup-background, var(--editor-background, #1e1e1e))'

  const input = options.document.createElement('input')
  input.className = `${namespace}-rename-input`
  input.type = 'text'
  input.spellcheck = false
  input.autocomplete = 'off'
  input.setAttribute('aria-label', 'New name')
  element.appendChild(input)
  options.document.body.appendChild(element)
  const surface = createAnchoredSurface({
    element,
    anchorClassName: `${namespace}-rename-anchor`,
    // Below the symbol, so the word being renamed stays readable while the new one is typed.
    preferredPlacement: 'bottom',
    alignment: 'start',
    gapPx: RENAME_GAP_PX,
  })

  const promptState: RenamePromptState = {
    removeAbortListener: null,
    settle: null,
  }

  function close(value: string | null): void {
    if (!promptState.settle) return

    const resolve = promptState.settle
    promptState.settle = null
    promptState.removeAbortListener?.()
    promptState.removeAbortListener = null
    // A close from a click elsewhere has already moved focus; Enter and Escape leave it here.
    const heldFocus = element.contains(options.document.activeElement)
    element.style.display = 'none'
    surface.release()
    if (heldFocus) options.returnFocus?.()
    resolve(value)
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      // An unchanged or empty name is a cancel: renaming a symbol to itself is a no-op edit, and to
      // nothing is not a rename at all.
      const next = input.value.trim()
      close(next.length === 0 ? null : next)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(null)
    }
  })
  input.addEventListener('blur', () => close(null))

  return {
    containsTarget: (target) => target instanceof Node && element.contains(target),
    reanchor(anchor) {
      if (!promptState.settle) return

      surface.place(anchor)
    },
    dispose() {
      close(null)
      surface.dispose()
      element.remove()
    },
    prompt({ anchor, currentName, signal }) {
      // A prompt already open is dismissed first, because dismissing it hides the element and takes
      // the anchor out of the page — done afterwards it would undo the showing it comes with.
      close(null)
      if (signal.aborted) return Promise.resolve(null)

      applyTheme(element, options.themeSource)
      element.style.display = 'block'
      surface.place(anchor)
      input.value = currentName
      input.focus()
      // Selected, so typing replaces the old name — the common case — while arrow keys still edit it.
      input.select()

      return beginRenamePrompt(promptState, signal, close)
    },
  }
}

function beginRenamePrompt(
  state: RenamePromptState,
  signal: AbortSignal,
  close: (value: string | null) => void,
): Promise<string | null> {
  return new Promise((resolve) => {
    state.settle = resolve
    const handleAbort = () => close(null)
    signal.addEventListener('abort', handleAbort, { once: true })
    state.removeAbortListener = () => signal.removeEventListener('abort', handleAbort)
    if (signal.aborted) close(null)
  })
}

function applyTheme(element: HTMLElement, source: HTMLElement): void {
  const style = getComputedStyle(source)
  for (const variable of THEME_VARIABLES) {
    const value = style.getPropertyValue(variable)
    if (value) {
      element.style.setProperty(variable, value)
      continue
    }
    element.style.removeProperty(variable)
  }
}
