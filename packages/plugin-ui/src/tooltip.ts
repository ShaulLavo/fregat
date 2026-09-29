import type { EditorTheme } from '@singapore-editor/core/rendering'

import { createAnchoredSurface, type AnchoredSurfacePlacement } from './anchoredSurface'
import type { TooltipCodeTokenizer } from './codeTokens'
import { renderTooltipMarkdown } from './markdownTooltip'
import { HOVER_COLORS, HOVER_THEME_VARIABLES } from './styles'

/** The full pointer-settle delay. Semantic requests begin halfway through it. */
export const HOVER_REQUEST_DEBOUNCE_MS = 300
export const HOVER_ASYNC_DISPATCH_DELAY_MS = HOVER_REQUEST_DEBOUNCE_MS / 2
export const HOVER_LOADING_DELAY_MS = HOVER_REQUEST_DEBOUNCE_MS * 3
export const TOOLTIP_HIDE_DELAY_MS = 300
export const COPY_BUTTON_RESET_DELAY_MS = 1200

const TOOLTIP_GAP_PX = 8
const TOOLTIP_VIEWPORT_MARGIN_PX = 12
const TOOLTIP_MIN_WIDTH_PX = 150
const TOOLTIP_MIN_HEIGHT_PX = 32
const TOOLTIP_MIN_MAX_HEIGHT_PX = 250
const TOOLTIP_MAX_WIDTH_FRACTION = 0.66
const TOOLTIP_POINTER_INTENT_TOLERANCE_PX = 4
const TOOLTIP_RESIZE_HANDLE_PX = 5
const TOOLTIP_SCROLL_STEP_PX = 30
const SVG_NS = 'http://www.w3.org/2000/svg'
const TOOLTIP_THEME_VARIABLES = [
  '--editor-background',
  '--editor-popup-background',
  '--editor-foreground',
  '--editor-caret-color',
  '--editor-font-family',
  '--editor-font-size',
  '--editor-row-height',
  ...HOVER_THEME_VARIABLES,
  '--editor-syntax-bracket',
  '--editor-syntax-comment',
  '--editor-syntax-keyword',
  '--editor-syntax-number',
  '--editor-syntax-string',
  '--editor-syntax-type',
] as const

type TooltipDimensions = {
  readonly width: number
  readonly height: number
}

type TooltipResizeEdge = 'right' | 'top' | 'bottom'

type TooltipResizeState = {
  readonly edge: TooltipResizeEdge
  readonly startX: number
  readonly startY: number
  readonly startWidth: number
  readonly startHeight: number
  readonly maxWidth: number
  readonly maxHeight: number
}

const lastTooltipDimensions = new WeakMap<Document, TooltipDimensions>()

export type TooltipAction = {
  readonly label: string
  readonly run: () => void | Promise<void>
}

/** A place a note points at, opened by the host: the other half of a duplicate, a related site. */
export type TooltipNoteLink = {
  /** What is clicked, such as `file.ts(12, 3): `. */
  readonly label: string
  readonly text: string
  open(): void
}

/** One line under the hover text, laid out as a VS Code marker: a diagnostic, a warning. */
export type TooltipNote = {
  /** Shown as written, so a multi-line message keeps its lines. */
  readonly text: string
  /** Who raised it, and its code, shown muted after the message as VS Code does. */
  readonly source?: string
  readonly code?: string
  /** Makes the code a link to its documentation. */
  readonly codeHref?: string
  readonly related?: readonly TooltipNoteLink[]
  readonly actions?: readonly TooltipAction[]
}

/** One row group of the tooltip; shown in the order given. */
export type TooltipPart = {
  readonly markdown?: string
  readonly notes?: readonly TooltipNote[]
  readonly actions?: readonly TooltipAction[]
}

export type TooltipShowOptions = {
  readonly anchor: DOMRect
  /** A single Markdown body, for a surface with one thing to say. */
  readonly hoverText: string | null
  readonly parts?: readonly TooltipPart[]
  readonly theme: EditorTheme | null
  readonly loading?: boolean
  readonly focus?: boolean
  readonly preferredPlacement?: AnchoredSurfacePlacement
}

export type TooltipOptions = {
  readonly document: Document
  readonly themeSource: HTMLElement
  readonly reentryElement: HTMLElement
  readonly markdownCodeBackground?: boolean
  readonly classNamespace?: string
  readonly codeTokenizer?: TooltipCodeTokenizer | null
  onDidHide?(): void
  onRequestEditorFocus?(): void
}

export type TooltipController = {
  show(options: TooltipShowOptions): void
  reanchor(anchor: DOMRect): void
  hide(): void
  scheduleHide(): void
  cancelHide(): void
  containsTarget(target: EventTarget | null): boolean
  /** Keeps a sticky hover only while the pointer is inside it or is still moving closer to it. */
  shouldKeepForPointer(clientX: number, clientY: number): boolean
  dispose(): void
}

export function createTooltipController(options: TooltipOptions): TooltipController {
  const { document, themeSource, reentryElement } = options
  const classNamespace = options.classNamespace ?? 'plugin'
  const tooltip = createTooltipElement(document, classNamespace)
  document.body.append(tooltip)

  let actionRows = new WeakMap<TooltipAction, HTMLElement>()
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let pointerDown = false
  let keyboardFocusOwned = false
  let resize: TooltipResizeState | null = null
  let disposed = false
  let anchorRect: DOMRect | null = null
  let placement: AnchoredSurfacePlacement = 'top'
  let closestPointerDistance: number | null = null

  const surface = createAnchoredSurface({
    element: tooltip,
    anchorClassName: tooltipClassName(classNamespace, 'anchor'),
    preferredPlacement: 'top',
    gapPx: TOOLTIP_GAP_PX,
    viewportMarginPx: TOOLTIP_VIEWPORT_MARGIN_PX,
    maxHeightPx: () => tooltipMaximumHeight(reentryElement, document),
    onPlaced: (maxHeightPx, nextPlacement) => {
      placement = nextPlacement
      setTooltipBodyMaxHeight(tooltip, maxHeightPx)
      updateResizeHandles(tooltip, nextPlacement, classNamespace)
    },
  })

  const cancelHide = (): void => {
    if (!hideTimer) return

    clearTimeout(hideTimer)
    hideTimer = null
  }

  const hide = (): void => {
    const restoreFocus = keyboardFocusOwned && tooltip.contains(document.activeElement)
    cancelHide()
    pointerDown = false
    keyboardFocusOwned = false
    resize = null
    closestPointerDistance = null
    tooltip.hidden = true
    anchorRect = null
    surface.release()
    tooltip.replaceChildren()
    actionRows = new WeakMap()
    if (restoreFocus) options.onRequestEditorFocus?.()
    options.onDidHide?.()
  }

  const scheduleHide = (): void => {
    if (pointerDown || resize) return
    if (hideTimer) clearTimeout(hideTimer)

    // @justification A pointer grace period before the hover goes away, cancelled by re-entry;
    // it schedules no editor work.
    hideTimer = setTimeout(() => {
      hideTimer = null
      hide()
    }, TOOLTIP_HIDE_DELAY_MS)
  }

  const show = (showOptions: TooltipShowOptions): void => {
    const focusState = tooltipFocusState(tooltip, document.activeElement)
    const scrollState = tooltipScrollState(tooltip)
    const anchorChanged = !anchorRect || !sameRect(anchorRect, showOptions.anchor)
    if (anchorChanged) closestPointerDistance = null
    anchorRect = showOptions.anchor
    const parts = showOptions.parts ?? []
    const hasNotes = parts.some((part) => part.notes && part.notes.length > 0)
    placement = showOptions.preferredPlacement ?? (hasNotes ? 'bottom' : 'top')
    syncEditorThemeVariables(tooltip, themeSource)
    applyTooltipDimensions(tooltip, reentryElement, tooltip.hidden !== false)
    renderTooltip(tooltip, {
      actionRows,
      hoverText: showOptions.hoverText,
      parts,
      theme: showOptions.theme,
      loading: showOptions.loading ?? false,
      markdownCodeBackground: options.markdownCodeBackground ?? false,
      classNamespace,
      codeTokenizer: options.codeTokenizer ?? null,
    })
    surface.place(showOptions.anchor, placement)
    restoreTooltipScroll(tooltip, scrollState)
    restoreTooltipFocus(tooltip, focusState, showOptions.focus ?? false)
    if (showOptions.focus) keyboardFocusOwned = true
  }

  const reanchor = (nextAnchor: DOMRect): void => {
    if (tooltip.hidden) return

    anchorRect = nextAnchor
    closestPointerDistance = null
    surface.place(nextAnchor, placement)
  }

  const containsTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) return false
    return tooltip.contains(target)
  }

  const shouldKeepForPointer = (clientX: number, clientY: number): boolean => {
    if (tooltip.hidden || !anchorRect) return false
    if (pointerDown || resize) return true
    if (tooltip.contains(document.activeElement)) return true
    if (selectionInsideTooltip(document, tooltip)) return true

    const tooltipRect = tooltip.getBoundingClientRect()
    const distance = pointToRectDistance(tooltipRect, clientX, clientY)
    if (rectContainsPoint(tooltipRect, clientX, clientY)) {
      closestPointerDistance = 0
      return true
    }
    if (rectContainsPoint(anchorRect, clientX, clientY)) {
      closestPointerDistance = distance
      return true
    }
    if (closestPointerDistance === null) return false
    if (distance > closestPointerDistance + TOOLTIP_POINTER_INTENT_TOLERANCE_PX) return false

    closestPointerDistance = Math.min(closestPointerDistance, distance)
    return true
  }

  const handleTooltipPointerEnter = (): void => cancelHide()

  const handleTooltipPointerLeave = (event: PointerEvent): void => {
    if (pointerDown || resize) return
    if (targetInsideElement(reentryElement, event.relatedTarget)) return
    scheduleHide()
  }

  const handleTooltipPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return

    pointerDown = true
    cancelHide()
    const edge = resizeEdgeFromTarget(event.target)
    if (!edge) return

    resize = beginTooltipResize(tooltip, reentryElement, event, edge)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleDocumentPointerMove = (event: PointerEvent): void => {
    if (!resize) return

    applyTooltipResize(tooltip, resize, event)
    if (anchorRect) surface.place(anchorRect, placement)
    event.preventDefault()
  }

  const handleDocumentPointerUp = (): void => {
    if (resize) rememberTooltipDimensions(tooltip)
    resize = null
    pointerDown = false
  }

  const handleTooltipKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      hide()
      return
    }
    if (isInteractiveKeyboardTarget(event.target)) return

    const body = tooltipBody(tooltip)
    if (!body) return
    if (!scrollTooltipBody(body, event.key)) return

    event.preventDefault()
    event.stopPropagation()
  }

  tooltip.addEventListener('pointerenter', handleTooltipPointerEnter)
  tooltip.addEventListener('pointerleave', handleTooltipPointerLeave)
  tooltip.addEventListener('pointerdown', handleTooltipPointerDown)
  tooltip.addEventListener('keydown', handleTooltipKeyDown)
  document.addEventListener('pointermove', handleDocumentPointerMove)
  document.addEventListener('pointerup', handleDocumentPointerUp)
  document.addEventListener('pointercancel', handleDocumentPointerUp)

  const dispose = (): void => {
    if (disposed) return

    disposed = true
    cancelHide()
    tooltip.removeEventListener('pointerenter', handleTooltipPointerEnter)
    tooltip.removeEventListener('pointerleave', handleTooltipPointerLeave)
    tooltip.removeEventListener('pointerdown', handleTooltipPointerDown)
    tooltip.removeEventListener('keydown', handleTooltipKeyDown)
    document.removeEventListener('pointermove', handleDocumentPointerMove)
    document.removeEventListener('pointerup', handleDocumentPointerUp)
    document.removeEventListener('pointercancel', handleDocumentPointerUp)
    surface.dispose()
    tooltip.remove()
  }

  return {
    show,
    reanchor,
    hide,
    scheduleHide,
    cancelHide,
    containsTarget,
    shouldKeepForPointer,
    dispose,
  }
}

function createTooltipElement(document: Document, classNamespace: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = tooltipClassName(classNamespace)
  element.hidden = true
  element.tabIndex = -1
  element.setAttribute('role', 'dialog')
  element.setAttribute('aria-label', 'Editor hover')
  Object.assign(element.style, {
    zIndex: '1000',
    width: 'max-content',
    minWidth: `${TOOLTIP_MIN_WIDTH_PX}px`,
    overflow: 'hidden',
    padding: '0',
    border: `1px solid ${HOVER_COLORS.border}`,
    borderRadius: '2px',
    boxSizing: 'border-box',
    background: `var(--editor-popup-background, ${HOVER_COLORS.background})`,
    color: HOVER_COLORS.foreground,
    boxShadow: `0 8px 28px ${HOVER_COLORS.shadow}`,
    // No inline display: it would beat the `hidden` attribute and leave an empty box on the page.
    fontFamily:
      'var(--editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
    fontSize: 'var(--editor-font-size, 13px)',
    lineHeight: '1.45',
    whiteSpace: 'normal',
    pointerEvents: 'auto',
    userSelect: 'text',
    cursor: 'default',
  })
  return element
}

type TooltipContent = {
  readonly actionRows: WeakMap<TooltipAction, HTMLElement>
  readonly hoverText: string | null
  readonly parts: readonly TooltipPart[]
  readonly theme?: EditorTheme | null
  readonly loading: boolean
  readonly markdownCodeBackground: boolean
  readonly classNamespace: string
  readonly codeTokenizer: TooltipCodeTokenizer | null
}

function renderTooltip(element: HTMLDivElement, content: TooltipContent): void {
  element.replaceChildren()
  element.setAttribute('aria-busy', String(content.loading))
  const body = createTooltipBody(element.ownerDocument, content.classNamespace)
  const parts = content.hoverText
    ? [{ markdown: content.hoverText }, ...content.parts]
    : content.parts
  let markdownIndex = 0
  for (const part of parts) {
    if (part.markdown) {
      body.append(hoverPart(content, element.ownerDocument, part.markdown, markdownIndex))
      markdownIndex += 1
    }
    // One row per note, as VS Code gives each marker its own hover row.
    for (const note of part.notes ?? []) {
      body.append(noteSection(content, element.ownerDocument, note))
    }
    for (const action of part.actions ?? []) {
      body.append(tooltipAction(element.ownerDocument, content, action))
    }
  }
  if (content.loading) body.append(loadingSection(content, element.ownerDocument))
  const firstRow = body.firstElementChild as HTMLElement | null
  if (firstRow) firstRow.style.borderTop = '0'

  element.append(
    body,
    createResizeHandle(element.ownerDocument, content.classNamespace, 'right'),
    createResizeHandle(element.ownerDocument, content.classNamespace, 'top'),
    createResizeHandle(element.ownerDocument, content.classNamespace, 'bottom'),
  )
  element.hidden = false
}

function createTooltipBody(document: Document, classNamespace: string): HTMLDivElement {
  const body = document.createElement('div')
  body.className = tooltipClassName(classNamespace, 'body')
  Object.assign(body.style, {
    width: '100%',
    height: '100%',
    minWidth: '0',
    minHeight: '0',
    overflowX: 'auto',
    overflowY: 'auto',
    scrollbarGutter: 'stable',
  })
  return body
}

function hoverPart(
  content: TooltipContent,
  document: Document,
  markdown: string,
  index: number,
): HTMLElement {
  const row = createTooltipRow(content, document, 'part')
  row.tabIndex = 0
  row.dataset.hoverPartIndex = String(index)
  row.setAttribute('role', 'document')
  row.setAttribute('aria-label', plainHoverText(markdown) || 'Hover information')
  row.append(
    renderTooltipMarkdown(document, markdown, content.theme, {
      codeBackground: content.markdownCodeBackground,
      classNamespace: content.classNamespace,
      codeTokenizer: content.codeTokenizer,
    }),
  )
  const button = createCopyButton(document, plainHoverText(markdown), content.classNamespace)
  row.append(button)
  installCopyButtonVisibility(row, button)
  return row
}

function createTooltipRow(
  content: TooltipContent,
  document: Document,
  part: string,
): HTMLDivElement {
  const row = document.createElement('div')
  row.className = tooltipClassName(content.classNamespace, part)
  Object.assign(row.style, {
    position: 'relative',
    minWidth: '0',
    padding: '6px 30px 6px 10px',
    borderTop: `1px solid ${HOVER_COLORS.separator}`,
    boxSizing: 'border-box',
    cursor: 'text',
  })
  return row
}

function noteSection(content: TooltipContent, document: Document, note: TooltipNote): HTMLElement {
  const section = createTooltipRow(content, document, 'notes')
  section.tabIndex = 0
  section.setAttribute('role', 'document')
  section.setAttribute('aria-label', noteCopyText(note))
  section.append(noteRow(document, note))
  for (const action of note.actions ?? []) section.append(tooltipAction(document, content, action))
  const copyText = noteCopyText(note)
  const button = createCopyButton(document, copyText, content.classNamespace)
  section.append(button)
  installCopyButtonVisibility(section, button)
  return section
}

function loadingSection(content: TooltipContent, document: Document): HTMLElement {
  const row = createTooltipRow(content, document, 'loading')
  row.setAttribute('role', 'status')
  row.setAttribute('aria-live', 'polite')
  row.textContent = 'Loading…'
  row.style.color = HOVER_COLORS.secondaryForeground
  row.style.cursor = 'progress'
  return row
}

function createCopyButton(
  document: Document,
  copyText: string,
  classNamespace: string,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = tooltipClassName(classNamespace, 'copy')
  Object.assign(button.style, {
    position: 'absolute',
    top: '4px',
    right: '5px',
    display: 'inline-grid',
    placeItems: 'center',
    width: '22px',
    height: '22px',
    border: '1px solid transparent',
    borderRadius: '4px',
    padding: '0',
    background: 'transparent',
    color: HOVER_COLORS.secondaryForeground,
    cursor: 'pointer',
    opacity: '0',
    userSelect: 'none',
  })
  setCopyButtonState(button, 'idle')
  button.addEventListener('mouseenter', () => styleCopyButtonHover(button, true))
  button.addEventListener('mouseleave', () => styleCopyButtonHover(button, false))
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    void handleCopyButtonClick(button, copyText)
  })
  return button
}

function installCopyButtonVisibility(row: HTMLElement, button: HTMLButtonElement): void {
  const show = (): void => {
    button.style.opacity = '1'
  }
  const hide = (event: FocusEvent | MouseEvent): void => {
    if (targetInsideElement(row, event.relatedTarget)) return
    button.style.opacity = '0'
  }
  row.addEventListener('mouseenter', show)
  row.addEventListener('mouseleave', hide)
  row.addEventListener('focusin', show)
  row.addEventListener('focusout', hide)
}

type CopyButtonState = 'idle' | 'copied' | 'failed'

function setCopyButtonState(button: HTMLButtonElement, state: CopyButtonState): void {
  button.title = copyButtonLabel(state)
  button.setAttribute('aria-label', copyButtonLabel(state))
  button.style.color = copyButtonColor(state)
  button.replaceChildren(copyButtonIcon(button.ownerDocument, state))
}

function styleCopyButtonHover(button: HTMLButtonElement, active: boolean): void {
  Object.assign(button.style, {
    background: active
      ? 'color-mix(in srgb, var(--editor-foreground, #a1a1aa) 14%, transparent)'
      : 'transparent',
    borderColor: active
      ? 'color-mix(in srgb, var(--editor-foreground, #a1a1aa) 22%, transparent)'
      : 'transparent',
  })
}

function copyButtonLabel(state: CopyButtonState): string {
  if (state === 'copied') return 'Copied hover text'
  if (state === 'failed') return 'Copy failed'
  return 'Copy hover text'
}

function copyButtonColor(state: CopyButtonState): string {
  if (state === 'copied') return HOVER_COLORS.actionSuccess
  if (state === 'failed') return HOVER_COLORS.actionFailure
  return HOVER_COLORS.secondaryForeground
}

function copyButtonIcon(document: Document, state: CopyButtonState): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('width', '16')
  icon.setAttribute('height', '16')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '2')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  for (const pathData of copyButtonIconPaths(state)) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', pathData)
    icon.append(path)
  }
  return icon
}

function copyButtonIconPaths(state: CopyButtonState): readonly string[] {
  if (state === 'copied') return ['M20 6 9 17l-5-5']
  if (state === 'failed') return ['M12 8v5', 'M12 17h.01', 'M10.3 4h3.4L22 19H2L10.3 4Z']
  return ['M8 8h12v12H8Z', 'M4 4h12v2', 'M4 4v12h2']
}

async function handleCopyButtonClick(button: HTMLButtonElement, copyText: string): Promise<void> {
  const copied = await copyTextToClipboard(button.ownerDocument, copyText)
  showCopyButtonStatus(button, copied)
}

function showCopyButtonStatus(button: HTMLButtonElement, copied: boolean): void {
  setCopyButtonState(button, copied ? 'copied' : 'failed')
  // @justification Resets the copy button's label after the user has had time to read it; DOM only.
  setTimeout(() => {
    if (!button.isConnected) return
    setCopyButtonState(button, 'idle')
  }, COPY_BUTTON_RESET_DELAY_MS)
}

async function copyTextToClipboard(document: Document, text: string): Promise<boolean> {
  const clipboard = document.defaultView?.navigator.clipboard
  if (!clipboard) return copyTextWithTextarea(document, text)

  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return copyTextWithTextarea(document, text)
  }
}

function copyTextWithTextarea(document: Document, text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  Object.assign(textarea.style, {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    opacity: '0',
  })
  document.body.append(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

function plainHoverText(markdown: string): string {
  return markdown
    .replace(/^```[^\n]*\n/gm, '')
    .replace(/^```\s*$/gm, '')
    .trim()
}

function noteCopyText(note: TooltipNote): string {
  const details = noteDetailsText(note)
  const head = `${note.text}${details ? ` ${details}` : ''}`
  const related = (note.related ?? []).map((link) => `${link.label}${link.text}`)
  return [head, ...related].join('\n').trim()
}

function noteDetailsText(note: TooltipNote): string {
  if (note.source && note.code) return `${note.source}(${note.code})`
  if (note.source) return note.source
  if (note.code) return `(${note.code})`
  return ''
}

// Laid out as VS Code's marker hover: the message as written, its source and code muted after it,
// and each related location on its own line below.
function noteRow(document: Document, note: TooltipNote): HTMLElement {
  const row = document.createElement('div')
  row.style.minWidth = '0'
  const message = document.createElement('span')
  message.textContent = note.text
  message.style.whiteSpace = 'pre-wrap'
  row.append(message)
  const details = noteDetails(document, note)
  if (details) row.append(details)
  for (const link of note.related ?? []) row.append(relatedRow(document, link))
  return row
}

function noteDetails(document: Document, note: TooltipNote): HTMLElement | null {
  if (!note.source && !note.code) return null

  const details = document.createElement('span')
  details.style.opacity = '0.6'
  details.style.paddingLeft = '6px'
  if (!note.codeHref || !note.code) {
    details.textContent = noteDetailsText(note)
    return details
  }

  if (note.source) details.append(note.source)
  const link = document.createElement('a')
  link.href = note.codeHref
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = `(${note.code})`
  styleNoteLink(link)
  details.append(link)
  return details
}

function relatedRow(document: Document, link: TooltipNoteLink): HTMLElement {
  const row = document.createElement('div')
  row.style.marginTop = '8px'
  const anchor = document.createElement('a')
  anchor.textContent = link.label
  anchor.setAttribute('role', 'button')
  anchor.tabIndex = 0
  styleNoteLink(anchor)
  const open = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    link.open()
  }
  anchor.addEventListener('click', open)
  anchor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') open(event)
  })
  const text = document.createElement('span')
  text.textContent = link.text
  row.append(anchor, text)
  return row
}

function styleNoteLink(anchor: HTMLAnchorElement): void {
  anchor.style.color = 'var(--editor-caret-color, #93c5fd)'
  anchor.style.textDecoration = 'underline'
  anchor.style.cursor = 'pointer'
}

function createResizeHandle(
  document: Document,
  classNamespace: string,
  edge: TooltipResizeEdge,
): HTMLDivElement {
  const handle = document.createElement('div')
  handle.className = tooltipClassName(classNamespace, `resize-${edge}`)
  handle.dataset.tooltipResizeEdge = edge
  handle.setAttribute('aria-hidden', 'true')
  Object.assign(handle.style, resizeHandleStyle(edge))
  return handle
}

function resizeHandleStyle(edge: TooltipResizeEdge): Partial<CSSStyleDeclaration> {
  if (edge === 'right') {
    return {
      position: 'absolute',
      top: '0',
      right: '-2px',
      width: `${TOOLTIP_RESIZE_HANDLE_PX}px`,
      height: '100%',
      cursor: 'ew-resize',
      userSelect: 'none',
    }
  }
  return {
    position: 'absolute',
    left: '0',
    width: '100%',
    height: `${TOOLTIP_RESIZE_HANDLE_PX}px`,
    cursor: 'ns-resize',
    userSelect: 'none',
  }
}

function updateResizeHandles(
  tooltip: HTMLElement,
  placement: AnchoredSurfacePlacement,
  classNamespace: string,
): void {
  const top = tooltip.querySelector<HTMLElement>(
    `.${tooltipClassName(classNamespace, 'resize-top')}`,
  )
  const bottom = tooltip.querySelector<HTMLElement>(
    `.${tooltipClassName(classNamespace, 'resize-bottom')}`,
  )
  if (!top || !bottom) return

  top.hidden = placement !== 'bottom'
  top.style.top = '-2px'
  bottom.hidden = placement !== 'top'
  bottom.style.bottom = '-2px'
}

function resizeEdgeFromTarget(target: EventTarget | null): TooltipResizeEdge | null {
  if (!(target instanceof HTMLElement)) return null
  const edge = target.dataset.tooltipResizeEdge
  if (edge === 'right' || edge === 'top' || edge === 'bottom') return edge
  return null
}

function beginTooltipResize(
  tooltip: HTMLElement,
  editor: HTMLElement,
  event: PointerEvent,
  edge: TooltipResizeEdge,
): TooltipResizeState {
  const rect = tooltip.getBoundingClientRect()
  const styledMaxHeight = Number.parseFloat(tooltip.style.maxHeight)
  return {
    edge,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
    maxWidth: tooltipMaximumWidth(editor, tooltip.ownerDocument),
    maxHeight: Number.isFinite(styledMaxHeight)
      ? styledMaxHeight
      : tooltipMaximumHeight(editor, tooltip.ownerDocument),
  }
}

function applyTooltipResize(
  tooltip: HTMLElement,
  resize: TooltipResizeState,
  event: PointerEvent,
): void {
  if (resize.edge === 'right') {
    const width = clamp(
      resize.startWidth + event.clientX - resize.startX,
      TOOLTIP_MIN_WIDTH_PX,
      resize.maxWidth,
    )
    tooltip.style.width = `${Math.round(width)}px`
    return
  }

  const delta =
    resize.edge === 'top' ? resize.startY - event.clientY : event.clientY - resize.startY
  const height = clamp(resize.startHeight + delta, TOOLTIP_MIN_HEIGHT_PX, resize.maxHeight)
  tooltip.style.height = `${Math.round(height)}px`
}

function rememberTooltipDimensions(tooltip: HTMLElement): void {
  const rect = tooltip.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  lastTooltipDimensions.set(tooltip.ownerDocument, { width: rect.width, height: rect.height })
}

function applyTooltipDimensions(
  tooltip: HTMLElement,
  editor: HTMLElement,
  resetToRememberedSize: boolean,
): void {
  const maximumWidth = tooltipMaximumWidth(editor, tooltip.ownerDocument)
  const maximumHeight = tooltipMaximumHeight(editor, tooltip.ownerDocument)
  tooltip.style.maxWidth = `${maximumWidth}px`
  tooltip.style.maxHeight = `${maximumHeight}px`
  if (!resetToRememberedSize) return

  const last = lastTooltipDimensions.get(tooltip.ownerDocument)
  tooltip.style.width = last ? `${Math.min(last.width, maximumWidth)}px` : 'max-content'
  tooltip.style.height = last ? `${Math.min(last.height, maximumHeight)}px` : 'auto'
}

function tooltipMaximumWidth(editor: HTMLElement, document: Document): number {
  const viewportWidth = document.defaultView?.innerWidth ?? 0
  const editorWidth = editor.getBoundingClientRect().width
  const desired = Math.max(editorWidth * TOOLTIP_MAX_WIDTH_FRACTION, 750)
  const viewportMaximum = viewportWidth - TOOLTIP_VIEWPORT_MARGIN_PX * 2
  return Math.max(TOOLTIP_MIN_WIDTH_PX, Math.min(desired, viewportMaximum))
}

function tooltipMaximumHeight(editor: HTMLElement, document: Document): number {
  const viewportHeight = document.defaultView?.innerHeight ?? 0
  const editorHeight = editor.getBoundingClientRect().height
  const lastHeight = lastTooltipDimensions.get(document)?.height ?? 0
  const desired = Math.max(editorHeight / 4, TOOLTIP_MIN_MAX_HEIGHT_PX, lastHeight)
  const viewportMaximum = viewportHeight - TOOLTIP_VIEWPORT_MARGIN_PX * 2
  return Math.max(TOOLTIP_MIN_HEIGHT_PX, Math.min(desired, viewportMaximum))
}

function setTooltipBodyMaxHeight(element: HTMLDivElement, maxHeight: number): void {
  const body = tooltipBody(element)
  if (!body) return
  body.style.maxHeight = `${Math.max(1, maxHeight - 2)}px`
}

function tooltipBody(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>(`.${tooltipClassNameForElement(element, 'body')}`)
}

type TooltipFocusState = {
  readonly partIndex: string | null
  readonly inside: boolean
  readonly element: HTMLElement | null
}
type TooltipScrollState = { readonly left: number; readonly top: number }

function tooltipScrollState(tooltip: HTMLElement): TooltipScrollState {
  const body = tooltipBody(tooltip)
  return { left: body?.scrollLeft ?? 0, top: body?.scrollTop ?? 0 }
}

function restoreTooltipScroll(tooltip: HTMLElement, state: TooltipScrollState): void {
  const body = tooltipBody(tooltip)
  if (!body) return
  body.scrollLeft = state.left
  body.scrollTop = state.top
}

function tooltipFocusState(tooltip: HTMLElement, active: Element | null): TooltipFocusState {
  if (!active || !tooltip.contains(active)) return { partIndex: null, inside: false, element: null }
  const part = active.closest<HTMLElement>('[data-hover-part-index]')
  return {
    partIndex: part?.dataset.hoverPartIndex ?? null,
    inside: true,
    element: active instanceof HTMLElement ? active : null,
  }
}

function restoreTooltipFocus(
  tooltip: HTMLElement,
  previous: TooltipFocusState,
  requested: boolean,
): void {
  if (!previous.inside && !requested) return
  if (previous.element && tooltip.contains(previous.element)) return previous.element.focus()
  if (previous.partIndex !== null) {
    const part = tooltip.querySelector<HTMLElement>(
      `[data-hover-part-index="${previous.partIndex}"]`,
    )
    if (part) return part.focus()
  }
  const firstPart = tooltip.querySelector<HTMLElement>('[data-hover-part-index], [tabindex="0"]')
  if (firstPart) return firstPart.focus()
  tooltip.focus()
}

function scrollTooltipBody(body: HTMLElement, key: string): boolean {
  if (key === 'ArrowDown') body.scrollTop += TOOLTIP_SCROLL_STEP_PX
  else if (key === 'ArrowUp') body.scrollTop -= TOOLTIP_SCROLL_STEP_PX
  else if (key === 'PageDown') body.scrollTop += Math.max(1, body.clientHeight)
  else if (key === 'PageUp') body.scrollTop -= Math.max(1, body.clientHeight)
  else if (key === 'Home') body.scrollTop = 0
  else if (key === 'End') body.scrollTop = body.scrollHeight
  else return false
  return true
}

function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('button, a, input, textarea, select'))
}

function selectionInsideTooltip(document: Document, tooltip: HTMLElement): boolean {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed) return false
  return tooltip.contains(selection.anchorNode) || tooltip.contains(selection.focusNode)
}

function syncEditorThemeVariables(target: HTMLElement, source: HTMLElement): void {
  const style = source.ownerDocument.defaultView?.getComputedStyle(source)
  if (!style) return
  for (const variable of TOOLTIP_THEME_VARIABLES) {
    const value =
      source.style.getPropertyValue(variable).trim() || style.getPropertyValue(variable).trim()
    if (value) {
      target.style.setProperty(variable, value)
      continue
    }
    target.style.removeProperty(variable)
  }
}

function tooltipClassName(classNamespace: string, part?: string): string {
  const base = `editor-${classNamespace}-hover`
  return part ? `${base}-${part}` : base
}

function tooltipClassNameForElement(element: HTMLElement, part: string): string {
  const namespace = tooltipNamespaceFromClassName(element.className)
  return tooltipClassName(namespace, part)
}

function tooltipNamespaceFromClassName(className: string): string {
  const match = /^editor-(.+)-hover(?:\s|$)/.exec(className)
  return match?.[1] ?? 'plugin'
}

function targetInsideElement(element: Element, target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  return element.contains(target)
}

function pointToRectDistance(rect: DOMRect, clientX: number, clientY: number): number {
  const horizontal = Math.max(rect.left - clientX, 0, clientX - rect.right)
  const vertical = Math.max(rect.top - clientY, 0, clientY - rect.bottom)
  return Math.hypot(horizontal, vertical)
}

function rectContainsPoint(rect: DOMRect, clientX: number, clientY: number): boolean {
  if (clientX < rect.left || clientX > rect.right) return false
  if (clientY < rect.top) return false
  return clientY <= rect.bottom
}

function sameRect(left: DOMRect, right: DOMRect): boolean {
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum))
}

async function runTooltipAction(
  button: HTMLButtonElement,
  failure: HTMLElement,
  action: TooltipAction,
): Promise<void> {
  if (button.getAttribute('aria-disabled') === 'true') return
  button.setAttribute('aria-disabled', 'true')
  button.setAttribute('aria-busy', 'true')
  failure.textContent = ''
  try {
    await action.run()
  } catch (error) {
    failure.textContent = error instanceof Error ? error.message : 'Could not complete action.'
  } finally {
    button.removeAttribute('aria-disabled')
    button.removeAttribute('aria-busy')
  }
}

function tooltipAction(
  document: Document,
  content: TooltipContent,
  action: TooltipAction,
): HTMLElement {
  const existing = content.actionRows.get(action)
  if (existing) return existing
  const row = createTooltipRow(content, document, 'action')
  content.actionRows.set(action, row)
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = action.label
  Object.assign(button.style, {
    background: 'transparent',
    border: '0',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    textDecoration: 'underline',
  })
  const failure = document.createElement('span')
  failure.setAttribute('role', 'status')
  button.addEventListener('click', () => {
    void runTooltipAction(button, failure, action)
  })
  row.append(button, failure)
  return row
}
