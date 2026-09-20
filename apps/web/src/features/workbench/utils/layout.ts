import { isPercentage as isLayoutSize } from '@workspace/utils/numbers'
/**
 * Pane geometry is global, not per-project. Restored tabs are state the user put
 * there; a sidebar that changes width because they clicked a session in another
 * project reads as a rendering bug rather than as restored state.
 */
export type WorkbenchOuterLayout = {
  readonly main: number
  readonly sidebar: number
}

export type WorkbenchMainLayout = {
  readonly bottom: number
  readonly editor: number
}

export type WorkbenchLayout = {
  readonly mainLayout: WorkbenchMainLayout
  readonly outerLayout: WorkbenchOuterLayout
}

const DEFAULT_OUTER_LAYOUT: WorkbenchOuterLayout = {
  main: 76,
  sidebar: 24,
}
const DEFAULT_MAIN_LAYOUT: WorkbenchMainLayout = {
  bottom: 30,
  editor: 70,
}

export function createDefaultWorkbenchLayout(): WorkbenchLayout {
  return {
    mainLayout: DEFAULT_MAIN_LAYOUT,
    outerLayout: DEFAULT_OUTER_LAYOUT,
  }
}

export function setWorkbenchOuterLayout(
  layout: WorkbenchLayout,
  patch: Partial<Record<keyof WorkbenchOuterLayout, number>>,
): WorkbenchLayout {
  const outerLayout = normalizeOuterLayout(patch)
  if (outerLayoutsEqual(layout.outerLayout, outerLayout)) return layout

  return { ...layout, outerLayout }
}

export function setWorkbenchMainLayout(
  layout: WorkbenchLayout,
  patch: Partial<Record<keyof WorkbenchMainLayout, number>>,
): WorkbenchLayout {
  const mainLayout = normalizeMainLayout(patch)
  if (mainLayoutsEqual(layout.mainLayout, mainLayout)) return layout

  return { ...layout, mainLayout }
}

/** A collapsed bottom panel reports zero; persisting it would lose the chosen height. */
export function isBottomCollapsed(layout: Partial<Record<keyof WorkbenchMainLayout, number>>) {
  return (layout.bottom ?? 0) === 0
}

export function normalizeWorkbenchLayout(value: WorkbenchLayout): WorkbenchLayout {
  return {
    mainLayout: normalizeMainLayout(value.mainLayout),
    outerLayout: normalizeOuterLayout(value.outerLayout),
  }
}

function normalizeOuterLayout(
  layout: Partial<Record<keyof WorkbenchOuterLayout, number>>,
): WorkbenchOuterLayout {
  const normalized = normalizeSplitLayout(
    layout.sidebar,
    layout.main,
    DEFAULT_OUTER_LAYOUT.sidebar,
    DEFAULT_OUTER_LAYOUT.main,
  )

  return {
    main: normalized.second,
    sidebar: normalized.first,
  }
}

function normalizeMainLayout(
  layout: Partial<Record<keyof WorkbenchMainLayout, number>>,
): WorkbenchMainLayout {
  const normalized = normalizeSplitLayout(
    layout.editor,
    layout.bottom,
    DEFAULT_MAIN_LAYOUT.editor,
    DEFAULT_MAIN_LAYOUT.bottom,
  )

  return {
    bottom: normalized.second,
    editor: normalized.first,
  }
}

function normalizeSplitLayout(
  first: number | undefined,
  second: number | undefined,
  fallbackFirst: number,
  fallbackSecond: number,
) {
  const fallback = {
    first: fallbackFirst,
    second: fallbackSecond,
  }
  if (!isLayoutSize(first)) return fallback
  if (!isLayoutSize(second)) return fallback

  const total = first + second
  if (total <= 0) return fallback

  const normalizedFirst = (first / total) * 100
  return {
    first: normalizedFirst,
    second: 100 - normalizedFirst,
  }
}

function outerLayoutsEqual(left: WorkbenchOuterLayout, right: WorkbenchOuterLayout) {
  if (left.sidebar !== right.sidebar) return false

  return left.main === right.main
}

function mainLayoutsEqual(left: WorkbenchMainLayout, right: WorkbenchMainLayout) {
  if (left.editor !== right.editor) return false

  return left.bottom === right.bottom
}
