import type {
  EditorGutterContribution,
  EditorGutterRowContext,
  EditorPlugin,
} from '@singapore-editor/core/extensions'
import type { VirtualizedFoldMarker } from '@singapore-editor/core/rendering'
import { addClassName, normalizeNonNegativeNumber, setElementHidden } from './utils'
import './foldGutter.css'

export type FoldGutterIconContext = {
  readonly document: Document
  readonly state: 'expanded' | 'collapsed'
  readonly marker: VirtualizedFoldMarker
}

export type FoldGutterSvgIcon = {
  readonly kind: 'svg'
  readonly viewBox: string
  readonly path: string
}

export type FoldGutterIcon =
  | string
  | FoldGutterSvgIcon
  | ((context: FoldGutterIconContext) => string | Node)

export type FoldGutterPluginOptions = {
  readonly width?: number
  readonly expandedIndicator?: string
  readonly collapsedIndicator?: string
  readonly icon?: FoldGutterIcon
  readonly expandedIcon?: FoldGutterIcon
  readonly collapsedIcon?: FoldGutterIcon
  readonly buttonClassName?: string
  readonly iconClassName?: string
}

type FoldGutterState = FoldGutterIconContext['state']

type FoldGutterTransition = 'expand' | 'collapse'

type FoldGutterIconSource = {
  readonly icon: FoldGutterIcon
  readonly stateSpecific: boolean
}

type FoldGutterRenderOptions = {
  readonly expandedIndicator: string
  readonly collapsedIndicator: string
  readonly icon?: FoldGutterIcon
  readonly expandedIcon?: FoldGutterIcon
  readonly collapsedIcon?: FoldGutterIcon
  readonly iconClassName?: string
}

const DEFAULT_FOLD_GUTTER_WIDTH = 10
const DEFAULT_EXPANDED_INDICATOR = 'v'
const DEFAULT_COLLAPSED_INDICATOR = '>'
const FOLD_GUTTER_CELL_CLASS = 'editor-virtualized-fold-gutter-cell'

export function createFoldGutterPlugin(options: FoldGutterPluginOptions = {}): EditorPlugin {
  const contribution = createFoldGutterContribution(options)

  return {
    name: 'fold-gutter',
    activate(context) {
      return context.registerGutterContribution(contribution)
    },
  }
}

export function createFoldGutterContribution(
  options: FoldGutterPluginOptions = {},
): EditorGutterContribution {
  const width = normalizeNonNegativeNumber(options.width, DEFAULT_FOLD_GUTTER_WIDTH)
  const renderOptions: FoldGutterRenderOptions = {
    expandedIndicator: options.expandedIndicator ?? DEFAULT_EXPANDED_INDICATOR,
    collapsedIndicator: options.collapsedIndicator ?? DEFAULT_COLLAPSED_INDICATOR,
    icon: options.icon,
    expandedIcon: options.expandedIcon,
    collapsedIcon: options.collapsedIcon,
    iconClassName: options.iconClassName,
  }

  return {
    id: 'fold-gutter',
    interactive: true,
    snapshotRenderer: createFoldSnapshotRenderer(options, renderOptions, width),
    createCell(document) {
      const cell = document.createElement('span')
      const button = createFoldButton(document, options.buttonClassName)
      cell.className = FOLD_GUTTER_CELL_CLASS
      cell.appendChild(button)
      return cell
    },
    width() {
      return width
    },
    updateCell(element, row) {
      const button = foldButtonFromCell(element)
      if (!button) return
      updateFoldGutterButton(button, row, renderOptions)
    },
    disposeCell(element) {
      const button = foldButtonFromCell(element)
      if (!button) return
      disposeFoldButton(button)
    },
  }
}

function createFoldSnapshotRenderer(
  options: FoldGutterPluginOptions,
  renderOptions: FoldGutterRenderOptions,
  width: number,
): EditorGutterContribution['snapshotRenderer'] {
  if (
    [options.icon, options.expandedIcon, options.collapsedIcon].some(
      (icon) => typeof icon === 'function',
    )
  )
    return undefined
  return {
    key: JSON.stringify(['fold-gutter', 1, width, options.buttonClassName, renderOptions]),
    capture: captureFoldPaint,
    restore: (element, paint) => restoreFoldPaint(element, paint, renderOptions),
  }
}

function captureFoldPaint(element: HTMLElement): string | null {
  const button = foldButtonFromCell(element)
  if (!button) return null
  if (button.hidden) return 'hidden'
  const state = button.dataset.editorFoldState
  return isFoldGutterState(state) ? state : null
}

function restoreFoldPaint(
  element: HTMLElement,
  paint: string,
  options: FoldGutterRenderOptions,
): boolean {
  const button = foldButtonFromCell(element)
  if (!button || (paint !== 'hidden' && !isFoldGutterState(paint))) return false
  hideFoldButton(button)
  if (paint === 'hidden') return true
  const source = resolveFoldIconSource(options, paint)
  if (typeof source.icon === 'function') return false
  const content = createStaticFoldIconContent(button.ownerDocument, source.icon)
  const icon = createFoldIconElement(button.ownerDocument, options.iconClassName)
  appendFoldIconContent(icon, content)
  button.replaceChildren(icon)
  button.dataset.editorFoldState = paint
  syncFoldIndicatorDataset(button, content)
  setElementHidden(button, false)
  return true
}

function createFoldButton(document: Document, className: string | undefined): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'editor-virtualized-fold-toggle'
  addClassName(button, className)
  button.type = 'button'
  button.hidden = true
  button.disabled = true
  button.tabIndex = -1
  button.addEventListener('mousedown', preventFoldButtonMouseDown)
  button.addEventListener('animationend', clearFoldTransition)
  button.addEventListener('animationcancel', clearFoldTransition)
  return button
}

function foldButtonFromCell(element: HTMLElement): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>('.editor-virtualized-fold-toggle')
}

function disposeFoldButton(button: HTMLButtonElement): void {
  button.onclick = null
  button.removeEventListener('mousedown', preventFoldButtonMouseDown)
  button.removeEventListener('animationend', clearFoldTransition)
  button.removeEventListener('animationcancel', clearFoldTransition)
}

function updateFoldGutterButton(
  button: HTMLButtonElement,
  row: EditorGutterRowContext,
  options: FoldGutterRenderOptions,
): void {
  const marker = row.foldMarker
  if (!marker) {
    hideFoldButton(button)
    return
  }

  const state = marker.collapsed ? 'collapsed' : 'expanded'
  const previousKey = button.dataset.editorFoldKey
  const previousState = button.dataset.editorFoldState
  showFoldButton(button, marker.key, state)
  updateFoldTransition(button, previousKey, previousState, marker.key, state)
  renderFoldIconIfNeeded(button, marker, state, options)
  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    row.toggleFold(marker)
  }
}

function hideFoldButton(button: HTMLButtonElement): void {
  setElementHidden(button, true)
  if (!button.disabled) button.disabled = true
  if (button.tabIndex !== -1) button.tabIndex = -1
  button.onclick = null
  delete button.dataset.editorFoldKey
  delete button.dataset.editorFoldState
  delete button.dataset.editorFoldIndicator
  delete button.dataset.editorFoldIconSignature
  delete button.dataset.editorFoldTransition
  if (button.childNodes.length > 0) button.replaceChildren()
  button.removeAttribute('aria-label')
}

function showFoldButton(button: HTMLButtonElement, key: string, state: FoldGutterState): void {
  const label = state === 'collapsed' ? 'Expand folded region' : 'Collapse foldable region'
  setElementHidden(button, false)
  if (button.disabled) button.disabled = false
  if (button.tabIndex !== 0) button.tabIndex = 0
  button.dataset.editorFoldKey = key
  button.dataset.editorFoldState = state
  button.setAttribute('aria-label', label)
}

function renderFoldIconIfNeeded(
  button: HTMLButtonElement,
  marker: VirtualizedFoldMarker,
  state: FoldGutterState,
  options: FoldGutterRenderOptions,
): void {
  const source = resolveFoldIconSource(options, state)
  const signature = foldIconSignature(marker, state, source)
  if (button.dataset.editorFoldIconSignature === signature) return

  const content = createFoldIconContent(button.ownerDocument, marker, state, source.icon)
  const icon = createFoldIconElement(button.ownerDocument, options.iconClassName)
  appendFoldIconContent(icon, content)
  button.replaceChildren(icon)
  button.dataset.editorFoldIconSignature = signature
  syncFoldIndicatorDataset(button, content)
}

function resolveFoldIconSource(
  options: FoldGutterRenderOptions,
  state: FoldGutterState,
): FoldGutterIconSource {
  const stateIcon = state === 'collapsed' ? options.collapsedIcon : options.expandedIcon
  if (stateIcon !== undefined) return { icon: stateIcon, stateSpecific: true }
  if (options.icon !== undefined) return { icon: options.icon, stateSpecific: false }

  const icon = state === 'collapsed' ? options.collapsedIndicator : options.expandedIndicator
  return { icon, stateSpecific: true }
}

function foldIconSignature(
  marker: VirtualizedFoldMarker,
  state: FoldGutterState,
  source: FoldGutterIconSource,
): string {
  const stateKey = source.stateSpecific ? state : 'shared'
  return `${marker.key}:${stateKey}`
}

function createFoldIconContent(
  document: Document,
  marker: VirtualizedFoldMarker,
  state: FoldGutterState,
  icon: FoldGutterIcon,
): string | Node {
  if (typeof icon === 'function') return icon({ document, state, marker })
  return createStaticFoldIconContent(document, icon)
}

function createStaticFoldIconContent(
  document: Document,
  icon: string | FoldGutterSvgIcon,
): string | SVGSVGElement {
  if (typeof icon === 'string') return icon
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', icon.viewBox)
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', icon.path)
  svg.appendChild(path)
  return svg
}

function createFoldIconElement(document: Document, className: string | undefined): HTMLSpanElement {
  const icon = document.createElement('span')
  icon.className = 'editor-virtualized-fold-icon'
  icon.setAttribute('aria-hidden', 'true')
  addClassName(icon, className)
  return icon
}

function appendFoldIconContent(icon: HTMLSpanElement, content: string | Node): void {
  if (typeof content === 'string') {
    icon.textContent = content
    return
  }

  icon.appendChild(content)
}

function syncFoldIndicatorDataset(button: HTMLButtonElement, content: string | Node): void {
  if (typeof content === 'string') {
    button.dataset.editorFoldIndicator = content
    return
  }

  delete button.dataset.editorFoldIndicator
}

function updateFoldTransition(
  button: HTMLButtonElement,
  previousKey: string | undefined,
  previousState: string | undefined,
  nextKey: string,
  nextState: FoldGutterState,
): void {
  if (previousKey !== nextKey) {
    delete button.dataset.editorFoldTransition
    return
  }
  if (!isFoldGutterState(previousState)) {
    delete button.dataset.editorFoldTransition
    return
  }
  if (previousState === nextState) return

  button.dataset.editorFoldTransition = foldTransitionForState(nextState)
}

function foldTransitionForState(state: FoldGutterState): FoldGutterTransition {
  return state === 'collapsed' ? 'collapse' : 'expand'
}

function isFoldGutterState(state: string | undefined): state is FoldGutterState {
  return state === 'collapsed' || state === 'expanded'
}

function preventFoldButtonMouseDown(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

function clearFoldTransition(event: Event): void {
  if (!(event.currentTarget instanceof HTMLButtonElement)) return
  delete event.currentTarget.dataset.editorFoldTransition
}
