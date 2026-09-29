import type { EditorTokenStyle } from './tokens'
import { clamp, SharedStyleRules } from './style-utils'

export type EditorSyntaxThemeColor =
  | 'attribute'
  | 'bracket'
  | 'comment'
  | 'constant'
  | 'function'
  | 'keyword'
  | 'keywordDeclaration'
  | 'keywordImport'
  | 'namespace'
  | 'number'
  | 'parameter'
  | 'property'
  | 'string'
  | 'type'
  | 'typeDefinition'
  | 'typeParameter'
  | 'variable'
  | 'variableBuiltin'

export type EditorSyntaxTheme = Partial<Record<EditorSyntaxThemeColor, string>>

/**
 * Which canvas a theme paints on. Only the registered defaults branch on this — a theme that
 * declares its own value for a colour uses it whatever the type is.
 */
export type EditorThemeType = 'light' | 'dark' | 'highContrast'

export type EditorColorId = string

/** A literal CSS colour, a reference to another registered id, or a transform over either. */
export type EditorColorValue = string | EditorColorTransform

export type EditorColorTransform =
  | { readonly kind: 'reference'; readonly id: EditorColorId }
  | { readonly kind: 'darken'; readonly value: EditorColorValue; readonly amount: number }
  | { readonly kind: 'lighten'; readonly value: EditorColorValue; readonly amount: number }
  | { readonly kind: 'transparent'; readonly value: EditorColorValue; readonly alpha: number }
  | { readonly kind: 'oneOf'; readonly values: readonly EditorColorValue[] }

type EditorColorThemeTypeDefaults = {
  readonly light?: EditorColorValue
  readonly dark?: EditorColorValue
  readonly highContrast?: EditorColorValue
}

/** A single value when the colour does not depend on the canvas, one value per type when it does. */
export type EditorColorDefaults = EditorColorValue | EditorColorThemeTypeDefaults

export type EditorTheme = {
  readonly type?: EditorThemeType
  readonly backgroundColor?: string
  readonly foregroundColor?: string
  readonly gutterBackgroundColor?: string
  readonly gutterForegroundColor?: string
  readonly selectionColor?: string
  readonly inactiveSelectionColor?: string
  readonly popupBackgroundColor?: string
  readonly caretColor?: string
  readonly minimapBackgroundColor?: string
  readonly syntax?: EditorSyntaxTheme
  /** Values for registered colour ids, including ids contributed by plugin packages. */
  readonly colors?: Readonly<Record<EditorColorId, string>>
}

// Ids and CSS variables are one vocabulary: an id names a colour for theme authors and for the
// packages that consume it, and the variable is how the value reaches CSS. Deriving one from the
// other is what keeps a contributed colour from needing a hand-written variable name that could
// disagree with the id a theme sets.
const EDITOR_COLOR_VARIABLE_PREFIX = '--editor'
const EDITOR_THEME_TYPE_ATTRIBUTE = 'data-editor-theme-type'
// Defaults are declared on the themed element rather than on the document root because a transform
// reads its inputs where its own declaration sits: on the host, a reference resolves against the
// package stylesheet and against the theme's own values, both of which land on that same element.
const EDITOR_COLORS_ATTRIBUTE = 'data-editor-colors'

const EDITOR_THEME_TYPES = [
  'light',
  'dark',
  'highContrast',
] as const satisfies ReadonlyArray<EditorThemeType>

const EDITOR_THEME_TYPE_ATTRIBUTE_VALUES = {
  light: 'light',
  dark: 'dark',
  highContrast: 'high-contrast',
} as const satisfies Record<EditorThemeType, string>

type RegisteredEditorColor = {
  readonly id: EditorColorId
  readonly variable: string
  readonly defaults: EditorColorDefaults | undefined
}

const registeredEditorColors = new Map<EditorColorId, RegisteredEditorColor>()
const editorColorRulesByDocument = new WeakMap<Document, SharedStyleRules>()
// The variables a theme wrote for ids the registry did not know, so clearing that theme can find
// them again — the registry walk cannot, and an id that is still unregistered by then would
// otherwise leave its value behind for the next theme to inherit.
const unregisteredEditorColorVariables = new WeakMap<HTMLElement, readonly string[]>()
// A colour can be registered long after a document has been themed, so the sheets already built have
// to be reachable from here — but only for as long as their documents are. A sheet holds its
// document, so holding the sheet strongly would pin every document an editor was ever themed in:
// harmless for a host with one, a detached tree per pop-out for a host that prints or opens windows.
const liveEditorColorRules = new Set<WeakRef<SharedStyleRules>>()
const collectedEditorColorRules = new FinalizationRegistry<WeakRef<SharedStyleRules>>((ref) => {
  liveEditorColorRules.delete(ref)
})

/**
 * Declares a themable colour and returns the CSS value that reads it, so the caller styles with the
 * registration's result and cannot drift from the id it registered. Registering is also what makes a
 * colour reachable through `EditorTheme.colors` and cleared again when a theme is removed.
 *
 * A duplicate id keeps the first registration: the same module can be instantiated twice by a
 * bundler, and losing a rule or throwing on the second copy would be worse than ignoring it.
 */
export function registerEditorColor(id: EditorColorId, defaults?: EditorColorDefaults): string {
  const existing = registeredEditorColors.get(id)
  const registered: RegisteredEditorColor = existing ?? {
    id,
    variable: editorColorVariableName(id),
    defaults,
  }
  if (!existing) registeredEditorColors.set(id, registered)

  for (const ref of liveEditorColorRules) {
    // Collection is what normally drops an entry; deref covers the window between the sheet dying
    // and the registry getting round to saying so.
    const rules = ref.deref()
    if (!rules) {
      liveEditorColorRules.delete(ref)
      continue
    }

    acquireEditorColorRule(rules, registered)
    rules.flush()
  }

  return `var(${registered.variable})`
}

/** The CSS value that reads a registered id, for callers that did not register it themselves. */
export function editorColorValue(id: EditorColorId): string {
  return `var(${editorColorVariable(id)})`
}

export function editorColorReference(id: EditorColorId): EditorColorTransform {
  return { kind: 'reference', id }
}

export function darkenEditorColor(value: EditorColorValue, amount: number): EditorColorTransform {
  return { kind: 'darken', value, amount }
}

export function lightenEditorColor(value: EditorColorValue, amount: number): EditorColorTransform {
  return { kind: 'lighten', value, amount }
}

export function transparentEditorColor(
  value: EditorColorValue,
  alpha: number,
): EditorColorTransform {
  return { kind: 'transparent', value, alpha }
}

/** Resolves to the first of `values` a theme actually defines. */
export function firstEditorColor(
  ...values: readonly [EditorColorValue, ...EditorColorValue[]]
): EditorColorTransform {
  return { kind: 'oneOf', values }
}

const EDITOR_THEME_COLORS = [
  { key: 'backgroundColor', id: 'background' },
  { key: 'foregroundColor', id: 'foreground' },
  { key: 'gutterBackgroundColor', id: 'gutter.background' },
  { key: 'gutterForegroundColor', id: 'gutter.foreground' },
  { key: 'caretColor', id: 'caret.color' },
  { key: 'selectionColor', id: 'selection.background' },
  { key: 'inactiveSelectionColor', id: 'selection.inactive.background' },
  { key: 'popupBackgroundColor', id: 'popup.background' },
  { key: 'minimapBackgroundColor', id: 'minimap.background' },
] satisfies ReadonlyArray<{
  readonly key: Exclude<keyof EditorTheme, 'syntax' | 'colors' | 'type'>
  readonly id: EditorColorId
}>

const EDITOR_SYNTAX_THEME_COLORS = [
  { key: 'attribute', id: 'syntax.attribute' },
  { key: 'bracket', id: 'syntax.bracket' },
  { key: 'comment', id: 'syntax.comment' },
  { key: 'constant', id: 'syntax.constant' },
  { key: 'function', id: 'syntax.function' },
  { key: 'keyword', id: 'syntax.keyword' },
  { key: 'keywordDeclaration', id: 'syntax.keywordDeclaration' },
  { key: 'keywordImport', id: 'syntax.keywordImport' },
  { key: 'namespace', id: 'syntax.namespace' },
  { key: 'number', id: 'syntax.number' },
  { key: 'property', id: 'syntax.property' },
  { key: 'string', id: 'syntax.string' },
  { key: 'type', id: 'syntax.type' },
  { key: 'typeDefinition', id: 'syntax.typeDefinition' },
  { key: 'typeParameter', id: 'syntax.typeParameter' },
  { key: 'variable', id: 'syntax.variable' },
  { key: 'variableBuiltin', id: 'syntax.variableBuiltin' },
] satisfies ReadonlyArray<{
  readonly key: EditorSyntaxThemeColor
  readonly id: EditorColorId
}>

// The named theme properties are ordinary registrations, so the merge, equality and clearing paths
// below have one table to walk instead of one per property group. Their defaults stay in the
// package stylesheet: those values also have to be readable by hand-written CSS rules, and a
// default declared in two places is a default that will disagree with itself.
for (const { id } of EDITOR_THEME_COLORS) registerEditorColor(id)
for (const { id } of EDITOR_SYNTAX_THEME_COLORS) registerEditorColor(id)

type WritableEditorTheme = {
  -readonly [Key in keyof EditorTheme]: EditorTheme[Key]
}

export function applyEditorTheme(
  element: HTMLElement,
  theme: EditorTheme | null | undefined,
): void {
  ensureEditorColorRules(element.ownerDocument)
  clearEditorTheme(element)
  element.setAttribute(EDITOR_COLORS_ATTRIBUTE, '')
  if (!theme) return

  for (const { key, id } of EDITOR_THEME_COLORS) {
    setOptionalEditorColor(element, id, theme[key])
  }

  for (const { key, id } of EDITOR_SYNTAX_THEME_COLORS) {
    setOptionalEditorColor(element, id, theme.syntax?.[key])
  }

  // A contributed id is themed by name, often before the package that registers it has finished
  // loading, so the value is written whether or not the id is known yet — both sides derive the
  // variable from the id the same way, so a registration that lands later finds the value already
  // sitting on the element. Registration is only needed for clearing, which walks the registry, so
  // the variables written for ids it has never heard of are remembered against the element instead.
  if (theme.colors) {
    const unregistered: string[] = []
    for (const [id, value] of Object.entries(theme.colors)) {
      setOptionalEditorColor(element, id, value)
      if (!registeredEditorColors.has(id)) unregistered.push(editorColorVariable(id))
    }
    if (unregistered.length > 0) unregisteredEditorColorVariables.set(element, unregistered)
  }

  if (theme.type) {
    element.setAttribute(
      EDITOR_THEME_TYPE_ATTRIBUTE,
      EDITOR_THEME_TYPE_ATTRIBUTE_VALUES[theme.type],
    )
  }
}

export function mergeEditorThemes(
  ...themes: readonly (EditorTheme | null | undefined)[]
): EditorTheme | null {
  const merged: WritableEditorTheme = {}
  let syntax: EditorSyntaxTheme | undefined
  let colors: Readonly<Record<EditorColorId, string>> | undefined
  let hasTheme = false

  for (const theme of themes) {
    if (!theme) continue

    hasTheme = true
    mergeThemeColors(merged, theme)
    syntax = mergeThemeRecord(syntax, theme.syntax)
    colors = mergeThemeRecord(colors, theme.colors)
  }

  if (!hasTheme) return null
  if (syntax) merged.syntax = syntax
  if (colors) merged.colors = colors
  return merged
}

export function editorThemesEqual(
  left: EditorTheme | null | undefined,
  right: EditorTheme | null | undefined,
): boolean {
  const normalizedLeft = left ?? null
  const normalizedRight = right ?? null
  if (normalizedLeft === normalizedRight) return true
  if (!normalizedLeft || !normalizedRight) return false
  if (normalizedLeft.type !== normalizedRight.type) return false

  for (const { key } of EDITOR_THEME_COLORS) {
    if (normalizedLeft[key] !== normalizedRight[key]) return false
  }

  if (!editorSyntaxThemesEqual(normalizedLeft.syntax, normalizedRight.syntax)) return false

  return contributedColorsEqual(normalizedLeft.colors, normalizedRight.colors)
}

function clearEditorTheme(element: HTMLElement): void {
  for (const { variable } of registeredEditorColors.values()) element.style.removeProperty(variable)

  const unregistered = unregisteredEditorColorVariables.get(element)
  if (unregistered) {
    for (const variable of unregistered) element.style.removeProperty(variable)
    unregisteredEditorColorVariables.delete(element)
  }

  element.removeAttribute(EDITOR_THEME_TYPE_ATTRIBUTE)
}

function setOptionalEditorColor(
  element: HTMLElement,
  id: EditorColorId,
  value: string | undefined,
): void {
  if (value === undefined) return
  element.style.setProperty(editorColorVariable(id), value)
}

function mergeThemeColors(target: WritableEditorTheme, theme: EditorTheme): void {
  if (theme.type !== undefined) target.type = theme.type
  for (const { key } of EDITOR_THEME_COLORS) {
    const value = theme[key]
    if (value !== undefined) target[key] = value
  }
}

function mergeThemeRecord<Values extends object>(
  previous: Values | undefined,
  next: Values | undefined,
): Values | undefined {
  if (!next) return previous
  return { ...previous, ...next }
}

function editorSyntaxThemesEqual(
  left: EditorSyntaxTheme | undefined,
  right: EditorSyntaxTheme | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false

  for (const { key } of EDITOR_SYNTAX_THEME_COLORS) {
    if (left[key] !== right[key]) return false
  }

  return true
}

// Contributed ids are open-ended, so equality compares the union of both bags rather than a known
// key list — the whole point is that a colour this module has never heard of still counts.
function contributedColorsEqual(
  left: Readonly<Record<EditorColorId, string>> | undefined,
  right: Readonly<Record<EditorColorId, string>> | undefined,
): boolean {
  if (left === right) return true

  const leftEntries = left ? Object.entries(left) : []
  const rightEntries = right ? Object.entries(right) : []
  if (leftEntries.length !== rightEntries.length) return false

  for (const [id, value] of leftEntries) {
    if (right?.[id] !== value) return false
  }

  return true
}

function editorColorVariable(id: EditorColorId): string {
  return registeredEditorColors.get(id)?.variable ?? editorColorVariableName(id)
}

function editorColorVariableName(id: EditorColorId): string {
  const segments = id.split('.').map((segment) => segment.replace(/([a-z0-9])([A-Z])/g, '$1-$2'))
  return `${EDITOR_COLOR_VARIABLE_PREFIX}-${segments.join('-').toLowerCase()}`
}

// Registration happens while a package is still being imported, long before there is a document to
// write to, so each document picks up the registry as it is when its first editor is themed and
// stays on the list to be topped up by whatever registers after that.
function ensureEditorColorRules(doc: Document): void {
  const existing = editorColorRulesByDocument.get(doc)
  if (existing) {
    // Theming is the one moment this module is certain to run against a live document, so it is
    // where a sheet a host has torn out of the head is written back. Settling for the pending batch
    // would leave it gone until some unrelated registration happened to dirty the set again.
    existing.restore()
    return
  }

  const rules = new SharedStyleRules(doc)
  editorColorRulesByDocument.set(doc, rules)
  const ref = new WeakRef(rules)
  liveEditorColorRules.add(ref)
  collectedEditorColorRules.register(rules, ref)
  for (const registered of registeredEditorColors.values())
    acquireEditorColorRule(rules, registered)
  rules.flush()
}

function acquireEditorColorRule(rules: SharedStyleRules, registered: RegisteredEditorColor): void {
  const text = editorColorDefaultRules(registered)
  if (text.length === 0) return

  rules.acquire(registered.id, text)
}

/**
 * Emits a registered colour's defaults as CSS rather than resolving them in TypeScript, so a
 * transform re-derives itself when the colour it reads is overridden — the engine recomputes
 * `color-mix` and `var` fallbacks on its own, with no recompute path of ours to keep correct.
 *
 * Every theme type is emitted at once: first the unconditional fallback, then the rules that follow
 * the viewer's own preference, then the same values keyed by declared type, so a theme that names
 * its type overrides that preference for its own editor. That order is the whole mechanism — the
 * selectors weigh the same, so the ones written last are the ones that win.
 */
function editorColorDefaultRules(registered: RegisteredEditorColor): string {
  const fallbackRules: string[] = []
  const preferenceRules: string[] = []
  const attributeRules: string[] = []

  for (const type of EDITOR_THEME_TYPES) {
    const value = editorColorDefault(registered.defaults, type)
    if (value === undefined) continue

    const declaration = `${registered.variable}: ${compileEditorColorValue(value)};`
    const rule = `[${EDITOR_COLORS_ATTRIBUTE}] { ${declaration} }`
    const condition = editorColorPreferenceCondition(type)
    if (condition === null) fallbackRules.push(rule)
    else preferenceRules.push(`@media (${condition}) { ${rule} }`)
    attributeRules.push(
      `[${EDITOR_THEME_TYPE_ATTRIBUTE}='${EDITOR_THEME_TYPE_ATTRIBUTE_VALUES[type]}'] { ${declaration} }`,
    )
  }

  return fallbackRules.concat(preferenceRules, attributeRules).join('\n')
}

// The shipped palette is dark, so dark is what an editor nobody has configured has to resolve to:
// an unconditional light default would leave every registered colour disagreeing with the surface
// it is painted on until a theme arrives. Every other type asks for its canvas by media query, and
// a media query buys no specificity — which is why the caller writes the unconditional rule before
// them rather than after, where it would win back the preference it is only the fallback for.
function editorColorPreferenceCondition(type: EditorThemeType): string | null {
  if (type === 'light') return 'prefers-color-scheme: light'
  if (type === 'highContrast') return 'forced-colors: active'
  return null
}

// A high contrast surface is a sharpened version of one of the other two rather than a third
// palette, so it borrows the dark value before the light one when it declares nothing itself.
function editorColorDefault(
  defaults: EditorColorDefaults | undefined,
  type: EditorThemeType,
): EditorColorValue | undefined {
  if (defaults === undefined) return undefined
  if (typeof defaults === 'string' || 'kind' in defaults) return defaults
  if (type === 'light') return defaults.light ?? defaults.dark
  if (type === 'dark') return defaults.dark ?? defaults.light
  return defaults.highContrast ?? defaults.dark ?? defaults.light
}

function compileEditorColorValue(value: EditorColorValue): string {
  if (typeof value === 'string') return value

  switch (value.kind) {
    case 'reference':
      return editorColorValue(value.id)
    case 'darken':
      return mixEditorColor(value.value, 1 - clamp(value.amount, 0, 1), 'black')
    case 'lighten':
      return mixEditorColor(value.value, 1 - clamp(value.amount, 0, 1), 'white')
    case 'transparent':
      return mixEditorColor(value.value, clamp(value.alpha, 0, 1), 'transparent')
    case 'oneOf':
      return compileFirstEditorColor(value.values)
  }
}

function mixEditorColor(value: EditorColorValue, weight: number, toward: string): string {
  return `color-mix(in srgb, ${compileEditorColorValue(value)} ${formatColorWeight(weight)}, ${toward})`
}

// `var()`'s own fallback chain is what makes 'first one defined' a cascade decision: a theme that
// sets the leading id later still wins, which a value picked at registration time could not do.
function compileFirstEditorColor(values: readonly EditorColorValue[]): string {
  const [first, ...rest] = values
  if (first === undefined) return 'transparent'

  const compiled = compileEditorColorValue(first)
  if (typeof first === 'string' || first.kind !== 'reference') return compiled
  if (rest.length === 0) return compiled

  return `var(${editorColorVariable(first.id)}, ${compileFirstEditorColor(rest)})`
}

function formatColorWeight(weight: number): string {
  return `${Math.round(clamp(weight, 0, 1) * 1000) / 10}%`
}

export type EditorScopeStyleRule = {
  readonly scope: string
  readonly style: EditorTokenStyle
}

export type EditorScopeStyles = {
  /** The style for a dot-separated scope, inherited from its nearest styled ancestor scope. */
  resolve(scope: string): EditorTokenStyle | null
}

type EditorScopeStyleNode = {
  style: EditorTokenStyle | null
  readonly children: Map<string, EditorScopeStyleNode>
}

/**
 * Indexes scope rules by segment so a scope resolves against the longest prefix that carries a
 * style, at any depth: `keyword.control.conditional` picks up `keyword.control` where a two-level
 * lookup could only see `keyword` and would drop the distinction the grammar went to the trouble
 * of making. A rule overrides only the properties it names, so a deeper scope keeps the weight or
 * slant it inherits while changing the colour.
 *
 * Rules are sorted before insertion so that a scope is always inserted after the scopes it extends
 * — a node copies its parent's resolved style when it is created, and a parent that arrived later
 * would have nothing to copy.
 */
export function createEditorScopeStyles(rules: readonly EditorScopeStyleRule[]): EditorScopeStyles {
  const root: EditorScopeStyleNode = { style: null, children: new Map() }
  for (const rule of rules.toSorted(compareEditorScopeRules)) {
    insertEditorScopeRule(root, rule)
  }

  const resolved = new Map<string, EditorTokenStyle | null>()
  return {
    resolve(scope: string): EditorTokenStyle | null {
      const cached = resolved.get(scope)
      if (cached !== undefined) return cached

      const style = resolveEditorScopeStyle(root, scope)
      resolved.set(scope, style)
      return style
    },
  }
}

function compareEditorScopeRules(left: EditorScopeStyleRule, right: EditorScopeStyleRule): number {
  if (left.scope === right.scope) return 0
  return left.scope < right.scope ? -1 : 1
}

function insertEditorScopeRule(root: EditorScopeStyleNode, rule: EditorScopeStyleRule): void {
  let node = root
  for (const segment of rule.scope.split('.')) {
    let child = node.children.get(segment)
    if (!child) {
      child = { style: node.style, children: new Map() }
      node.children.set(segment, child)
    }
    node = child
  }

  node.style = overrideEditorScopeStyle(node.style, rule.style)
}

function overrideEditorScopeStyle(
  inherited: EditorTokenStyle | null,
  style: EditorTokenStyle,
): EditorTokenStyle | null {
  const merged: Record<string, unknown> = { ...inherited }
  for (const [key, value] of Object.entries(style)) {
    if (value !== undefined) merged[key] = value
  }

  return Object.keys(merged).length > 0 ? (merged as EditorTokenStyle) : null
}

function resolveEditorScopeStyle(
  root: EditorScopeStyleNode,
  scope: string,
): EditorTokenStyle | null {
  let node = root
  let start = 0

  while (start <= scope.length) {
    const dot = scope.indexOf('.', start)
    const end = dot === -1 ? scope.length : dot
    const child = node.children.get(scope.slice(start, end))
    if (!child) break

    node = child
    if (dot === -1) break
    start = dot + 1
  }

  return node.style
}
