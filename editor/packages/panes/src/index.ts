import './style.css'

export type ResizablePaneOrientation = 'horizontal' | 'vertical'

export type ResizablePaneLayout = Readonly<Record<string, number>>

export type ResizablePane = {
  readonly id: string
  readonly element: HTMLElement
  readonly defaultSize?: number
  readonly minSize?: number
  readonly maxSize?: number
  readonly disabled?: boolean
}

export type ResizablePaneHandleContext = {
  readonly document: Document
  readonly groupId: string
  readonly handleId: string
  readonly index: number
  readonly beforePaneId: string
  readonly afterPaneId: string
  readonly orientation: ResizablePaneOrientation
}

export type ResizablePaneHandleFactory = (context: ResizablePaneHandleContext) => HTMLElement

export type ResizablePaneGroupOptions = {
  readonly id?: string
  readonly orientation?: ResizablePaneOrientation
  readonly panes: readonly ResizablePane[]
  readonly defaultLayout?: ResizablePaneLayout
  readonly createHandle?: ResizablePaneHandleFactory
  readonly onLayoutChange?: (layout: ResizablePaneLayout) => void
  readonly onLayoutChanged?: (layout: ResizablePaneLayout) => void
  readonly keyboardStep?: number
  readonly disabled?: boolean
}

type NormalizedPane = {
  readonly id: string
  readonly element: HTMLElement
  readonly defaultSize?: number
  readonly minSize: number
  readonly maxSize: number
  readonly disabled: boolean
}

type MountedHandle = {
  readonly id: string
  readonly element: HTMLElement
  readonly index: number
  readonly onKeyDown: (event: KeyboardEvent) => void
  readonly onPointerDown: (event: PointerEvent) => void
  readonly onPointerEnter: () => void
  readonly onPointerLeave: () => void
  readonly onBlur: () => void
  readonly onFocus: () => void
}

type DragState = {
  readonly handle: MountedHandle
  readonly initialLayout: ResizablePaneLayout
  readonly pointerId: number | null
  readonly startX: number
  readonly startY: number
  readonly groupSize: number
  changed: boolean
}

type LayoutApplyMode = 'silent' | 'change' | 'changed' | 'both'

const DEFAULT_KEYBOARD_STEP = 5
const FLOAT_TOLERANCE = 0.001
let nextPaneGroupId = 0

export class ResizablePaneGroup {
  private readonly container: HTMLElement
  private readonly document: Document
  private readonly groupId: string
  private readonly orientation: ResizablePaneOrientation
  private readonly keyboardStep: number
  private readonly disabled: boolean
  private readonly panes: readonly NormalizedPane[]
  private readonly handles: MountedHandle[] = []
  private readonly onDocumentPointerMove = (event: PointerEvent): void => {
    this.handleDocumentPointerMove(event)
  }
  private readonly onDocumentPointerUp = (event: PointerEvent): void => {
    this.handleDocumentPointerUp(event)
  }
  private readonly onLayoutChange?: (layout: ResizablePaneLayout) => void
  private readonly onLayoutChanged?: (layout: ResizablePaneLayout) => void
  private dragState: DragState | null = null
  private disposed = false
  private layout: ResizablePaneLayout

  public constructor(container: HTMLElement, options: ResizablePaneGroupOptions) {
    this.container = container
    this.document = container.ownerDocument
    this.groupId = options.id ?? `editor-pane-group-${nextPaneGroupId++}`
    this.orientation = options.orientation ?? 'horizontal'
    this.keyboardStep = normalizeKeyboardStep(options.keyboardStep)
    this.disabled = options.disabled === true
    this.onLayoutChange = options.onLayoutChange
    this.onLayoutChanged = options.onLayoutChanged
    this.panes = normalizePanes(options.panes)
    this.layout = createInitialLayout(this.panes, options.defaultLayout)

    mountContainer(this.container, this.groupId, this.orientation)
    this.mountPanesAndHandles(options.createHandle)
    this.applyLayout(this.layout, 'silent')
  }

  public getLayout(): ResizablePaneLayout {
    return { ...this.layout }
  }

  public setLayout(layout: ResizablePaneLayout): ResizablePaneLayout {
    if (this.disposed) return this.getLayout()

    const nextLayout = normalizeLayout(layout, this.panes)
    this.applyLayout(nextLayout, 'both')
    return this.getLayout()
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.uninstallDocumentDragListeners()
    for (const handle of this.handles) disposeHandle(handle)
    this.handles.length = 0
    for (const pane of this.panes) unmountPane(pane)
    unmountContainer(this.container)
  }

  private mountPanesAndHandles(createHandle: ResizablePaneHandleFactory | undefined): void {
    for (const [index, pane] of this.panes.entries()) {
      mountPane(this.container, pane, this.groupId, index)
      if (index === 0) continue
      this.mountHandle(index - 1, createHandle)
    }
  }

  private mountHandle(index: number, createHandle: ResizablePaneHandleFactory | undefined): void {
    const beforePane = this.panes[index]
    const afterPane = this.panes[index + 1]
    if (!beforePane || !afterPane) return

    const handleId = `${this.groupId}-handle-${index}`
    const element =
      createHandle?.({
        document: this.document,
        groupId: this.groupId,
        handleId,
        index,
        beforePaneId: beforePane.id,
        afterPaneId: afterPane.id,
        orientation: this.orientation,
      }) ?? createDefaultHandle(this.document)
    const handle = this.createMountedHandle(element, handleId, index)
    this.handles.push(handle)
    configureHandle(handle, this.separatorOrientation(), this.disabled)
    this.container.insertBefore(element, afterPane.element)
  }

  private createMountedHandle(element: HTMLElement, id: string, index: number): MountedHandle {
    const handle: MountedHandle = {
      id,
      element,
      index,
      onKeyDown: (event) => this.handleKeyDown(handle, event),
      onPointerDown: (event) => this.handlePointerDown(handle, event),
      onPointerEnter: () => setHandleState(handle, 'hover'),
      onPointerLeave: () => setHandleState(handle, 'inactive'),
      onBlur: () => setHandleState(handle, 'inactive'),
      onFocus: () => setHandleState(handle, 'focus'),
    }
    element.addEventListener('keydown', handle.onKeyDown)
    element.addEventListener('pointerdown', handle.onPointerDown)
    element.addEventListener('pointerenter', handle.onPointerEnter)
    element.addEventListener('pointerleave', handle.onPointerLeave)
    element.addEventListener('blur', handle.onBlur)
    element.addEventListener('focus', handle.onFocus)
    return handle
  }

  private handlePointerDown(handle: MountedHandle, event: PointerEvent): void {
    if (!this.canStartInteraction(event)) return

    const groupSize = this.groupSize()
    if (groupSize <= 0) return

    event.preventDefault()
    handle.element.focus({ preventScroll: true })
    setHandleState(handle, 'dragging')
    this.dragState = {
      handle,
      initialLayout: this.getLayout(),
      pointerId: pointerIdFromEvent(event),
      startX: event.clientX,
      startY: event.clientY,
      groupSize,
      changed: false,
    }
    capturePointer(handle.element, event)
    this.installDocumentDragListeners()
  }

  private handleDocumentPointerMove(event: PointerEvent): void {
    const drag = this.dragState
    if (!drag) return
    if (!matchesPointer(drag, event)) return

    event.preventDefault()
    const delta = this.pointerDeltaPercent(drag, event)
    const changed = this.applyHandleDelta(drag.handle.index, delta, drag.initialLayout, 'change')
    drag.changed ||= changed
  }

  private handleDocumentPointerUp(event: PointerEvent): void {
    const drag = this.dragState
    if (!drag) return
    if (!matchesPointer(drag, event)) return

    this.dragState = null
    this.uninstallDocumentDragListeners()
    releasePointer(drag.handle.element, event)
    setHandleState(drag.handle, 'focus')
    if (drag.changed) this.onLayoutChanged?.(this.getLayout())
  }

  private handleKeyDown(handle: MountedHandle, event: KeyboardEvent): void {
    if (this.disabled) return
    if (event.key === 'F6') {
      event.preventDefault()
      this.focusSiblingHandle(handle, event.shiftKey)
      return
    }

    const delta = keyboardDelta(event, this.orientation, this.keyboardStep)
    if (delta === null) return

    event.preventDefault()
    const changed = this.applyHandleDelta(handle.index, delta, this.layout, 'both')
    if (changed) setHandleState(handle, 'focus')
  }

  private focusSiblingHandle(handle: MountedHandle, reverse: boolean): void {
    const nextHandle = nextFocusableHandle(this.handles, handle, reverse)
    nextHandle?.element.focus({ preventScroll: true })
  }

  private applyHandleDelta(
    handleIndex: number,
    delta: number,
    initialLayout: ResizablePaneLayout,
    mode: LayoutApplyMode,
  ): boolean {
    const nextLayout = adjustLayoutByDelta({
      delta,
      initialLayout,
      panes: this.panes,
      pivotIndex: handleIndex,
      prevLayout: this.layout,
    })
    return this.applyLayout(nextLayout, mode)
  }

  private applyLayout(layout: ResizablePaneLayout, mode: LayoutApplyMode): boolean {
    const nextLayout = normalizeLayout(layout, this.panes)
    if (layoutsEqual(this.layout, nextLayout)) {
      this.updateHandles()
      return false
    }

    this.layout = nextLayout
    for (const pane of this.panes) applyPaneLayout(pane, nextLayout[pane.id] ?? 0)
    this.updateHandles()
    notifyLayoutChange(mode, nextLayout, this.onLayoutChange, this.onLayoutChanged)
    return true
  }

  private updateHandles(): void {
    for (const handle of this.handles) this.updateHandle(handle)
  }

  private updateHandle(handle: MountedHandle): void {
    const beforePane = this.panes[handle.index]
    if (!beforePane) return

    const aria = calculateHandleAria({
      handleIndex: handle.index,
      layout: this.layout,
      panes: this.panes,
    })
    handle.element.id = handle.id
    handle.element.setAttribute('aria-controls', beforePane.element.id)
    handle.element.setAttribute('aria-valuemin', formatAriaNumber(aria.min))
    handle.element.setAttribute('aria-valuemax', formatAriaNumber(aria.max))
    handle.element.setAttribute('aria-valuenow', formatAriaNumber(aria.now))
  }

  private canStartInteraction(event: PointerEvent): boolean {
    if (this.disabled || this.disposed || event.defaultPrevented) return false
    if (event.pointerType === 'mouse' && event.button > 0) return false
    return true
  }

  private pointerDeltaPercent(drag: DragState, event: PointerEvent): number {
    if (this.orientation === 'horizontal')
      return ((event.clientX - drag.startX) / drag.groupSize) * 100
    return ((event.clientY - drag.startY) / drag.groupSize) * 100
  }

  private groupSize(): number {
    const rect = this.container.getBoundingClientRect()
    if (this.orientation === 'horizontal') return rect.width
    return rect.height
  }

  private separatorOrientation(): 'horizontal' | 'vertical' {
    if (this.orientation === 'horizontal') return 'vertical'
    return 'horizontal'
  }

  private installDocumentDragListeners(): void {
    this.document.addEventListener('pointermove', this.onDocumentPointerMove)
    this.document.addEventListener('pointerup', this.onDocumentPointerUp, true)
  }

  private uninstallDocumentDragListeners(): void {
    this.document.removeEventListener('pointermove', this.onDocumentPointerMove)
    this.document.removeEventListener('pointerup', this.onDocumentPointerUp, true)
  }
}

function mountContainer(
  container: HTMLElement,
  groupId: string,
  orientation: ResizablePaneOrientation,
): void {
  container.classList.add('editor-resizable-pane-group')
  container.dataset.editorPaneGroup = groupId
  container.dataset.editorPaneOrientation = orientation
  container.style.display = 'flex'
  container.style.flexDirection = orientation === 'horizontal' ? 'row' : 'column'
  container.style.flexWrap = 'nowrap'
  container.style.overflow = 'hidden'
  container.style.touchAction = orientation === 'horizontal' ? 'pan-y' : 'pan-x'
}

function unmountContainer(container: HTMLElement): void {
  container.classList.remove('editor-resizable-pane-group')
  delete container.dataset.editorPaneGroup
  delete container.dataset.editorPaneOrientation
}

function mountPane(
  container: HTMLElement,
  pane: NormalizedPane,
  groupId: string,
  index: number,
): void {
  ensureElementId(pane.element, `${groupId}-pane-${pane.id}`)
  pane.element.classList.add('editor-resizable-pane')
  pane.element.dataset.editorPane = pane.id
  pane.element.dataset.editorPaneIndex = String(index)
  pane.element.style.minHeight = '0'
  pane.element.style.minWidth = '0'
  if (pane.disabled) pane.element.dataset.disabled = 'true'
  container.appendChild(pane.element)
}

function unmountPane(pane: NormalizedPane): void {
  pane.element.classList.remove('editor-resizable-pane')
  delete pane.element.dataset.editorPane
  delete pane.element.dataset.editorPaneIndex
  delete pane.element.dataset.disabled
}

function applyPaneLayout(pane: NormalizedPane, size: number): void {
  pane.element.style.flexGrow = formatFlexNumber(size)
  pane.element.style.flexShrink = '1'
  pane.element.style.flexBasis = '0'
}

function createDefaultHandle(document: Document): HTMLElement {
  const handle = document.createElement('div')
  handle.className = 'editor-resizable-pane-handle'
  return handle
}

function configureHandle(
  handle: MountedHandle,
  orientation: 'horizontal' | 'vertical',
  disabled: boolean,
): void {
  handle.element.classList.add('editor-resizable-pane-handle')
  handle.element.dataset.editorPaneHandle = handle.id
  handle.element.dataset.editorPaneHandleState = 'inactive'
  handle.element.setAttribute('aria-disabled', disabled ? 'true' : 'false')
  handle.element.setAttribute('aria-orientation', orientation)
  handle.element.setAttribute('role', 'separator')
  handle.element.style.flexGrow = '0'
  handle.element.style.flexShrink = '0'
  handle.element.style.touchAction = 'none'
  applyHandleOrientationStyle(handle.element, orientation, disabled)
  handle.element.tabIndex = disabled ? -1 : 0
}

function applyHandleOrientationStyle(
  element: HTMLElement,
  orientation: 'horizontal' | 'vertical',
  disabled: boolean,
): void {
  if (orientation === 'vertical') {
    element.style.width = element.style.width || '8px'
    element.style.cursor = disabled ? 'default' : 'ew-resize'
    return
  }

  element.style.height = element.style.height || '8px'
  element.style.cursor = disabled ? 'default' : 'ns-resize'
}

function disposeHandle(handle: MountedHandle): void {
  handle.element.removeEventListener('keydown', handle.onKeyDown)
  handle.element.removeEventListener('pointerdown', handle.onPointerDown)
  handle.element.removeEventListener('pointerenter', handle.onPointerEnter)
  handle.element.removeEventListener('pointerleave', handle.onPointerLeave)
  handle.element.removeEventListener('blur', handle.onBlur)
  handle.element.removeEventListener('focus', handle.onFocus)
  handle.element.remove()
}

function setHandleState(handle: MountedHandle, state: string): void {
  if (handle.element.dataset.editorPaneHandleState === 'dragging' && state === 'inactive') return
  handle.element.dataset.editorPaneHandleState = state
}

function normalizePanes(panes: readonly ResizablePane[]): readonly NormalizedPane[] {
  const seenIds = new Set<string>()
  return panes.map((pane) => normalizePane(pane, seenIds))
}

function normalizePane(pane: ResizablePane, seenIds: Set<string>): NormalizedPane {
  const id = String(pane.id)
  if (!id) throw new Error('Resizable panes must have an id')
  if (seenIds.has(id)) throw new Error(`Duplicate resizable pane id "${id}"`)
  seenIds.add(id)

  const minSize = clampPercent(pane.minSize ?? 0)
  const maxSize = Math.max(minSize, clampPercent(pane.maxSize ?? 100))
  return {
    id,
    element: pane.element,
    defaultSize: optionalPercent(pane.defaultSize),
    minSize,
    maxSize,
    disabled: pane.disabled === true,
  }
}

function createInitialLayout(
  panes: readonly NormalizedPane[],
  defaultLayout: ResizablePaneLayout | undefined,
): ResizablePaneLayout {
  const configured = layoutFromDefaultLayout(panes, defaultLayout)
  if (configured) return configured

  const paneDefaults = layoutFromPaneDefaults(panes)
  if (paneDefaults) return paneDefaults

  return equalLayout(panes)
}

function layoutFromDefaultLayout(
  panes: readonly NormalizedPane[],
  defaultLayout: ResizablePaneLayout | undefined,
): ResizablePaneLayout | null {
  if (!defaultLayout) return null
  if (!panes.every((pane) => finiteNumber(defaultLayout[pane.id]))) return null
  return normalizeLayout(defaultLayout, panes)
}

function layoutFromPaneDefaults(panes: readonly NormalizedPane[]): ResizablePaneLayout | null {
  if (!panes.some((pane) => pane.defaultSize !== undefined)) return null

  const fixedTotal = sumValues(panes.map((pane) => pane.defaultSize ?? 0))
  const flexiblePanes = panes.filter((pane) => pane.defaultSize === undefined)
  const flexibleSize =
    flexiblePanes.length > 0 ? Math.max(0, 100 - fixedTotal) / flexiblePanes.length : 0
  const layout: Record<string, number> = {}
  for (const pane of panes) layout[pane.id] = pane.defaultSize ?? flexibleSize
  return normalizeLayout(layout, panes)
}

function equalLayout(panes: readonly NormalizedPane[]): ResizablePaneLayout {
  const size = panes.length > 0 ? 100 / panes.length : 0
  const layout: Record<string, number> = {}
  for (const pane of panes) layout[pane.id] = size
  return normalizeLayout(layout, panes)
}

function normalizeLayout(
  layout: ResizablePaneLayout,
  panes: readonly NormalizedPane[],
): ResizablePaneLayout {
  const nextLayout = mutableLayout(layout, panes)
  return freezeLayout(rebalanceLayout(nextLayout, panes))
}

function mutableLayout(
  layout: ResizablePaneLayout,
  panes: readonly NormalizedPane[],
): Record<string, number> {
  const nextLayout: Record<string, number> = {}
  for (const pane of panes) nextLayout[pane.id] = clampToPane(layout[pane.id], pane)
  return nextLayout
}

function rebalanceLayout(
  layout: Record<string, number>,
  panes: readonly NormalizedPane[],
): Record<string, number> {
  let remaining = 100 - sumValues(Object.values(layout))
  let iterations = 0
  while (Math.abs(remaining) > FLOAT_TOLERANCE && iterations < panes.length * 3) {
    const applied = distributeRebalanceDelta(layout, panes, remaining)
    if (Math.abs(applied) <= FLOAT_TOLERANCE) break
    remaining -= applied
    iterations += 1
  }
  return layout
}

function distributeRebalanceDelta(
  layout: Record<string, number>,
  panes: readonly NormalizedPane[],
  remaining: number,
): number {
  const candidates = rebalanceCandidates(layout, panes, remaining)
  if (candidates.length === 0) return 0

  const share = remaining / candidates.length
  let applied = 0
  for (const pane of candidates) applied += applyRebalanceShare(layout, pane, share)
  return applied
}

function rebalanceCandidates(
  layout: Record<string, number>,
  panes: readonly NormalizedPane[],
  remaining: number,
): readonly NormalizedPane[] {
  if (remaining > 0) return panes.filter((pane) => layout[pane.id] < pane.maxSize)
  return panes.filter((pane) => layout[pane.id] > pane.minSize)
}

function applyRebalanceShare(
  layout: Record<string, number>,
  pane: NormalizedPane,
  share: number,
): number {
  const current = layout[pane.id] ?? 0
  const next = clampToPane(current + share, pane)
  layout[pane.id] = next
  return next - current
}

function adjustLayoutByDelta(options: {
  readonly delta: number
  readonly initialLayout: ResizablePaneLayout
  readonly panes: readonly NormalizedPane[]
  readonly pivotIndex: number
  readonly prevLayout: ResizablePaneLayout
}): ResizablePaneLayout {
  const { delta, initialLayout, panes, pivotIndex, prevLayout } = options
  if (Math.abs(delta) <= FLOAT_TOLERANCE) return prevLayout

  const nextLayout = mutableLayout(initialLayout, panes)
  const amount = Math.abs(delta)
  const shrinkIndices = shrinkCandidateIndices(delta, panes, pivotIndex)
  const growIndices = growCandidateIndices(delta, panes, pivotIndex)
  const applicableDelta = Math.min(
    amount,
    totalShrinkCapacity(nextLayout, panes, shrinkIndices),
    totalGrowCapacity(nextLayout, panes, growIndices),
  )
  if (applicableDelta <= FLOAT_TOLERANCE) return prevLayout

  distributeResizeDelta(nextLayout, panes, shrinkIndices, -applicableDelta)
  distributeResizeDelta(nextLayout, panes, growIndices, applicableDelta)
  const next = freezeLayout(nextLayout)
  if (layoutsEqual(prevLayout, next)) return prevLayout
  return next
}

function shrinkCandidateIndices(
  delta: number,
  panes: readonly NormalizedPane[],
  pivotIndex: number,
): readonly number[] {
  if (delta > 0) return forwardIndices(pivotIndex + 1, panes.length)
  return reverseIndices(pivotIndex)
}

function growCandidateIndices(
  delta: number,
  panes: readonly NormalizedPane[],
  pivotIndex: number,
): readonly number[] {
  if (delta > 0) return reverseIndices(pivotIndex)
  return forwardIndices(pivotIndex + 1, panes.length)
}

function forwardIndices(start: number, length: number): readonly number[] {
  const indices: number[] = []
  for (let index = start; index < length; index += 1) indices.push(index)
  return indices
}

function reverseIndices(start: number): readonly number[] {
  const indices: number[] = []
  for (let index = start; index >= 0; index -= 1) indices.push(index)
  return indices
}

function totalShrinkCapacity(
  layout: ResizablePaneLayout,
  panes: readonly NormalizedPane[],
  indices: readonly number[],
): number {
  return indices.reduce((total, index) => {
    const pane = panes[index]
    if (!pane || pane.disabled) return total
    return total + Math.max(0, (layout[pane.id] ?? 0) - pane.minSize)
  }, 0)
}

function totalGrowCapacity(
  layout: ResizablePaneLayout,
  panes: readonly NormalizedPane[],
  indices: readonly number[],
): number {
  return indices.reduce((total, index) => {
    const pane = panes[index]
    if (!pane || pane.disabled) return total
    return total + Math.max(0, pane.maxSize - (layout[pane.id] ?? 0))
  }, 0)
}

function distributeResizeDelta(
  layout: Record<string, number>,
  panes: readonly NormalizedPane[],
  indices: readonly number[],
  delta: number,
): void {
  let remaining = Math.abs(delta)
  const direction = delta < 0 ? -1 : 1
  for (const index of indices) {
    const pane = panes[index]
    if (!pane || pane.disabled) continue
    remaining = applyResizeDelta(layout, pane, remaining, direction)
    if (remaining <= FLOAT_TOLERANCE) return
  }
}

function applyResizeDelta(
  layout: Record<string, number>,
  pane: NormalizedPane,
  remaining: number,
  direction: number,
): number {
  const current = layout[pane.id] ?? 0
  const target = current + remaining * direction
  const next = clampToPane(target, pane)
  layout[pane.id] = next
  return remaining - Math.abs(next - current)
}

function calculateHandleAria(options: {
  readonly handleIndex: number
  readonly layout: ResizablePaneLayout
  readonly panes: readonly NormalizedPane[]
}): { readonly min: number; readonly max: number; readonly now: number } {
  const pane = options.panes[options.handleIndex]
  if (!pane) return { min: 0, max: 100, now: 0 }

  const now = options.layout[pane.id] ?? 0
  const minLayout = adjustLayoutByDelta({
    delta: pane.minSize - now,
    initialLayout: options.layout,
    panes: options.panes,
    pivotIndex: options.handleIndex,
    prevLayout: options.layout,
  })
  const maxLayout = adjustLayoutByDelta({
    delta: pane.maxSize - now,
    initialLayout: options.layout,
    panes: options.panes,
    pivotIndex: options.handleIndex,
    prevLayout: options.layout,
  })
  return {
    min: minLayout[pane.id] ?? pane.minSize,
    max: maxLayout[pane.id] ?? pane.maxSize,
    now,
  }
}

function keyboardDelta(
  event: KeyboardEvent,
  orientation: ResizablePaneOrientation,
  keyboardStep: number,
): number | null {
  if (event.key === 'Home') return -100
  if (event.key === 'End') return 100
  if (orientation === 'horizontal') return horizontalKeyboardDelta(event.key, keyboardStep)
  return verticalKeyboardDelta(event.key, keyboardStep)
}

function horizontalKeyboardDelta(key: string, keyboardStep: number): number | null {
  if (key === 'ArrowLeft') return -keyboardStep
  if (key === 'ArrowRight') return keyboardStep
  return null
}

function verticalKeyboardDelta(key: string, keyboardStep: number): number | null {
  if (key === 'ArrowUp') return -keyboardStep
  if (key === 'ArrowDown') return keyboardStep
  return null
}

function nextFocusableHandle(
  handles: readonly MountedHandle[],
  current: MountedHandle,
  reverse: boolean,
): MountedHandle | null {
  if (handles.length === 0) return null

  const index = handles.indexOf(current)
  if (index === -1) return handles[0] ?? null
  const offset = reverse ? -1 : 1
  const nextIndex = (index + offset + handles.length) % handles.length
  return handles[nextIndex] ?? null
}

function notifyLayoutChange(
  mode: LayoutApplyMode,
  layout: ResizablePaneLayout,
  onLayoutChange: ((layout: ResizablePaneLayout) => void) | undefined,
  onLayoutChanged: ((layout: ResizablePaneLayout) => void) | undefined,
): void {
  if (mode === 'silent') return
  if (mode === 'change' || mode === 'both') onLayoutChange?.({ ...layout })
  if (mode === 'changed' || mode === 'both') onLayoutChanged?.({ ...layout })
}

function layoutsEqual(a: ResizablePaneLayout, b: ResizablePaneLayout): boolean {
  const keys = new Set(Object.keys(a).concat(Object.keys(b)))
  for (const key of keys) {
    if (Math.abs((a[key] ?? 0) - (b[key] ?? 0)) > FLOAT_TOLERANCE) return false
  }
  return true
}

function freezeLayout(layout: Record<string, number>): ResizablePaneLayout {
  return Object.freeze({ ...layout })
}

function clampToPane(value: number | undefined, pane: NormalizedPane): number {
  if (!finiteNumber(value)) return pane.minSize
  return clamp(value, pane.minSize, pane.maxSize)
}

function clampPercent(value: number): number {
  if (!finiteNumber(value)) return 0
  return clamp(value, 0, 100)
}

function optionalPercent(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return clampPercent(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sumValues(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function normalizeKeyboardStep(value: number | undefined): number {
  if (!finiteNumber(value) || value <= 0) return DEFAULT_KEYBOARD_STEP
  return value
}

function ensureElementId(element: HTMLElement, fallback: string): void {
  if (element.id) return
  element.id = fallback.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function formatFlexNumber(value: number): string {
  return Number(value.toFixed(4)).toString()
}

function formatAriaNumber(value: number): string {
  return Number(value.toFixed(2)).toString()
}

function pointerIdFromEvent(event: PointerEvent): number | null {
  if (typeof event.pointerId !== 'number') return null
  return event.pointerId
}

function matchesPointer(drag: DragState, event: PointerEvent): boolean {
  if (drag.pointerId === null) return true
  return event.pointerId === drag.pointerId
}

function capturePointer(element: HTMLElement, event: PointerEvent): void {
  if (typeof event.pointerId !== 'number') return
  element.setPointerCapture?.(event.pointerId)
}

function releasePointer(element: HTMLElement, event: PointerEvent): void {
  if (typeof event.pointerId !== 'number') return
  element.releasePointerCapture?.(event.pointerId)
}
