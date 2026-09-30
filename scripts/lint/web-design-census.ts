import type { Node, JSXOpeningElement, JSXElement, JSXElementName } from 'oxc-parser'
import type { Hit, Roots } from './census-report.ts'
import { isNode } from './ast.ts'
type CensusHit = Hit & { row?: boolean }
type Census = { files: number; hits: Record<string, CensusHit[]>; parseErrors: string[] }
type Measure = {
  title: string
  allowed?: readonly string[]
  histogram?: boolean
  histogramOnly?: boolean
  listed?: boolean
  limit?: number
  skipUnder?: readonly string[]
  gates?: string
  allowListed?: boolean
}
type StringEntry = {
  value: string
  start: number
  elementName: string | null
  elementKey: string | null
  attributeName?: string
  row: boolean
  text: boolean
  disabled: boolean
  titled: boolean
}
type ElementEntry = {
  name: string | null
  start: number
  opening: JSXOpeningElement
  children: JSXElement['children']
  renderedChildren: JSXElement['children']
  ancestors: JSXOpeningElement[]
}
type Group = {
  bases: Set<string>
  heights: CensusHit[]
  round: CensusHit | null
  cap: CensusHit | null
}
type Groups = Map<string, Group>
type Token = { raw: string; variants: string[]; base: string; index: number }
type LineAt = (offset: number) => number
type AllowEntry = { file: string; class: string; reason: string }
import fs from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'
import {
  formatGate,
  formatHistogram,
  formatList,
  histogram,
  runCensusIfMain,
} from './census-report.ts'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')
// The app and the primitives it composes are one design surface; measuring only the app leaves
// every class the primitives encode unmeasured.
const DEFAULT_ROOTS = ['apps/web/src', 'packages/markdown/src', 'packages/ui/src'].map((root) =>
  path.join(REPOSITORY, root),
)
const DEFAULT_ALLOW = path.join(REPOSITORY, 'scripts/lint/web-design-allow.json')
const UI_PACKAGE = 'packages/ui/src/'
const BAR_HEIGHT = 'h-(--bar-height)'

/**
 * Every measure the census reports, and the target each one has to reach.
 *
 * `limit` and `allowed` gate: a hit outside them fails `--check` unless the allow-list excuses it.
 * `histogramOnly` reports instead of failing; where it is paired with `gates`, the one slice named
 * there still fails. `skipUnder` drops a root from a measure that cannot apply there.
 */
export const TARGETS = {
  radius: {
    title: 'radius steps',
    // `none` stays on this list so a `rounded-none` is not counted twice. It gates on its own as
    // `nullRadius`, which is a different defect from picking a step off the scale.
    allowed: ['md', 'lg', 'full', 'none'],
    histogram: true,
  },
  bareRadius: { title: "bare 'rounded'", limit: 0, listed: true },
  nullRadius: { title: "redundant 'rounded-none'", limit: 0, listed: true },
  buttonRadius: {
    title: 'radius on <Button>',
    limit: 0,
    // In the primitives package a radius beside a <Button> is the control defining its own corner,
    // not an app overriding it.
    skipUnder: [UI_PACKAGE],
  },
  compactVariant: { title: "'compact:' utilities", limit: 0 },
  densityVars: { title: 'density variables', histogram: true, histogramOnly: true },
  barHeights: { title: 'bar heights', allowed: [BAR_HEIGHT], histogram: true },
  hairlines: { title: 'hairline borders', limit: 0, listed: true },
  arbitraryText: { title: 'arbitrary text sizes', limit: 0, histogram: true, listed: true },
  shadow: {
    title: 'elevation steps',
    allowed: ['shadow-md', 'shadow-xl', 'shadow-none'],
    histogram: true,
  },
  rawControls: {
    title: 'raw form controls',
    allowListed: true,
    listed: true,
    // A primitive is the button, so the raw element has to be written somewhere in packages/ui.
    skipUnder: [UI_PACKAGE],
  },
  hoverFills: {
    title: 'hover fills',
    histogram: true,
    histogramOnly: true,
    gates: 'rows use bg-row-hover; row fills never add an opacity modifier',
    listed: true,
  },
  iconSize: {
    title: 'icon sizes',
    allowed: ['size-(--icon-size)', 'size-(--icon-size-sm)'],
    histogram: true,
    listed: true,
  },
  textAlpha: { title: 'text alpha', limit: 0, listed: true },
  iconOnlyHint: { title: 'icon-only controls without a Tooltip', limit: 0, listed: true },
  paletteLeaks: { title: 'raw palette colours', limit: 0, listed: true },
  statusDots: { title: 'hand-made status dots', limit: 0, listed: true },
  scrollIdiom: { title: 'hand-styled scrollbars', limit: 0, listed: true },
  kbdSpelling: { title: 'keys drawn outside Kbd', limit: 0, listed: true },
  uncontainedScroller: {
    title: 'capped scrollers without overscroll-contain',
    limit: 0,
    listed: true,
  },
  truncationRecovery: {
    title: 'truncation with no title on the row',
    limit: 0,
    listed: true,
    allowListed: true,
    // A primitive cannot know whether the string it renders is a label or a value; the consumer
    // that knows sets the title.
    skipUnder: [UI_PACKAGE],
  },
} satisfies Record<string, Measure>
const targets: Record<string, Measure> = TARGETS

/** Measures read back out of the radius histogram rather than collected in a bucket of their own. */
const DERIVED: Record<string, (census: Census) => CensusHit[]> = {
  bareRadius: bareRadiusHits,
  nullRadius: nullRadiusHits,
}
const MEASURES = Object.keys(TARGETS).filter((measure) => !(measure in DERIVED))
const ALL_MEASURES = MEASURES.concat(Object.keys(DERIVED))

const RADIUS_SIDES = new Set([
  't',
  'r',
  'b',
  'l',
  's',
  'e',
  'tl',
  'tr',
  'br',
  'bl',
  'ss',
  'se',
  'ee',
  'es',
])
const SHADOW_STEPS = new Set(['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', 'inner'])
const PALETTE_HUES =
  'red|blue|sky|amber|emerald|green|zinc|slate|gray|neutral|stone|yellow|orange|violet|purple|pink|rose|indigo|cyan|teal|lime'
const PALETTE_CLASS = new RegExp(`^(?:bg|text|border|ring)-(?:${PALETTE_HUES})-\\d+(?:/\\d+)?$`)
const COLOR_LITERAL = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|oklch\(/gi
const DENSITY_VAR = /\((--density-[a-z-]+|--bar-height|--rail-width)\)/g
// Any unit, not just px and rem: `text-[0.9em]` is as much an off-scale size as `text-[11px]`.
// A leading digit is what separates a size from `text-[var(--x)]` or `text-[#abc]`, which are
// colours and belong to the palette measure.
const ARBITRARY_TEXT = /^text-\[(?:length:)?\d*\.?\d+[a-z%]*\]$/i
// The row fills carry their own alpha (see the row tokens in globals.css), so an opacity modifier
// on one always fights the design rather than expressing it.
const ROW_FILL_OPACITY = /^(?:hover:)?bg-row-(?:hover|selected)\/\d+$/
// Surfaces separate by tone, never by a line. A `border` class survives only as a sizing base for
// a state color (`border border-transparent … aria-invalid:border-destructive`).
const HAIRLINE =
  /^(?:border(?:-(?:[trbl]|x|y|s|e))?(?:-(?:border|subtle)(?:\/\d+)?)?|divide-(?:x|y))$/
const HAIRLINE_BASE = /\bborder-transparent\b/
// A small round mark is a StatusDot drawn by hand; its colour often comes from a helper elsewhere.
const DOT_MARK = /^size-(?:1|1\.5|2|2\.5)$/
// The base layer styles every bar; a class that restyles or hides one is an exception. Read
// from the raw string, because an arbitrary property fails the class-string test.
const SCROLLBAR_CLASS = /(?:^|\s)((?:\S*[[:]\S*scrollbar|no-scrollbar)\S*)/g
// A capped scroller sits inside something else that scrolls, so it keeps the wheel to itself.
const CAPPED = /^max-h-/
const SCROLLS = /^overflow-(?:[xy]-)?(?:auto|scroll)$/
const KBD_PRIMITIVE = 'packages/ui/src/components/kbd.tsx'
const HEIGHT_TOKEN = /^h-(?:\d+(?:\.\d+)?|px|\[[^\]]*\]|\([^)]*\))$/
const TRUNCATION = /^(?:truncate|line-clamp-\d+)$/
const SOURCE_FILE = /\.tsx?$/
const TEST_FILE = /(?:^|\/)tests?\/|\.(?:test|browser|test-d)\.tsx?$/

// A class string is any literal whose whitespace-separated words all read as utilities. The
// dash-or-colon check keeps prose such as 'Hello world' out of the census.
const CLASS_TOKEN = /^(?:[^\s:]+:)*!?-?[a-z][a-z0-9]*(?:[-./][^\s:]*)*!?$/i
const BARE_UTILITIES = new Set([
  'absolute',
  'block',
  'border',
  'container',
  'contents',
  'fixed',
  'flex',
  'grid',
  'hidden',
  'inline',
  'isolate',
  'italic',
  'relative',
  'rounded',
  'shadow',
  'sticky',
  'transition',
  'truncate',
  'underline',
  'uppercase',
])

function looksLikeClassString(value: string) {
  const tokens = value.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  if (!tokens.every((token: string) => CLASS_TOKEN.test(token))) return false
  return tokens.some(
    (token) => token.includes('-') || token.includes(':') || BARE_UTILITIES.has(token),
  )
}

/** Splits a class string into `{ raw, variants, base, index }` words, keeping each word's offset. */
function classTokens(value: string) {
  const tokens = []
  const words = /\S+/g
  for (let word = words.exec(value); word !== null; word = words.exec(value)) {
    tokens.push({ ...splitVariants(word[0]), index: word.index })
  }
  return tokens
}

function splitVariants(word: string) {
  const parsed = /^((?:[^:\s]+:)*)(.*)$/.exec(word)!
  const prefix = parsed[1]
  return {
    raw: word,
    variants: prefix === '' ? [] : prefix.slice(0, -1).split(':'),
    base: parsed[2].replace(/^!/, '').replace(/!$/, ''),
  }
}

/** `rounded-t-md` -> `{ side: 't', step: 'md' }`. A null step is the banned off-scale default. */
function radiusInfo(base: string) {
  if (base !== 'rounded' && !base.startsWith('rounded-')) return null
  const segments = base === 'rounded' ? [] : base.slice('rounded-'.length).split('-')
  const side = RADIUS_SIDES.has(segments[0]) ? segments.shift() : null
  const step = segments.join('-')
  return { side, step: step === '' ? null : step }
}

function shadowStep(base: string) {
  if (base === 'shadow') return 'shadow'
  if (!base.startsWith('shadow-')) return null
  const step = base.slice('shadow-'.length)
  if (SHADOW_STEPS.has(step)) return base
  // Anything else after `shadow-` is a colour, not an elevation step.
  return step.startsWith('[') || step.startsWith('(') ? base : null
}

export function isTestFile(relative: string) {
  return TEST_FILE.test(relative)
}

function emptyCensus(): Census {
  const hits: Record<string, CensusHit[]> = {}
  for (const measure of MEASURES) hits[measure] = []
  return { files: 0, hits, parseErrors: [] }
}

function mergeCensus(censuses: readonly Census[]) {
  const merged = emptyCensus()
  for (const census of censuses) {
    merged.files += census.files
    merged.parseErrors.push(...census.parseErrors)
    for (const measure of MEASURES) merged.hits[measure].push(...census.hits[measure])
  }
  return merged
}

export function censusSource(file: string, source: string) {
  const census = emptyCensus()
  census.files = 1
  const parsed = parseSync(file, source)
  for (const error of parsed.errors) census.parseErrors.push(`${file}: ${error.message}`)
  const lineAt = lineLocator(source)
  const { strings, elements } = scan(parsed.program)
  for (const element of elements) recordElement(census, file, element, lineAt)
  const groups: Groups = new Map()
  const markup = file.endsWith('.tsx')
  for (const entry of strings) {
    if (markup) recordColorLiterals(census, file, entry, lineOfEntry(entry, lineAt))
    recordString(census, file, entry, lineAt, groups)
  }
  recordBarHeights(census, groups)
  recordStatusDots(census, groups)
  recordUncontainedScrollers(census, groups)
  return census
}

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(filename)
    // `.ts` too: a module that exports class-name strings is a design decision like any other.
    return SOURCE_FILE.test(entry.name) ? [filename] : []
  })
}

function censusTree(root: string) {
  const files = sourceFiles(root).filter((file) => !isTestFile(posix(path.relative(root, file))))
  return mergeCensus(
    files.map((file) => censusSource(posix(path.relative(REPOSITORY, file)), read(file))),
  )
}

function read(file: string) {
  return fs.readFileSync(file, 'utf8')
}

function posix(value: string) {
  return value.replaceAll('\\', '/')
}

const SKIPPED_KEYS = new Set(['type', 'start', 'end', 'range', 'loc', 'parent'])

function walk(
  node: unknown,
  visit: (node: Node, ancestors: Node[]) => void,
  ancestors: Node[],
): void {
  if (Array.isArray(node)) return walkAll(node, visit, ancestors)
  if (!isNode(node)) return
  visit(node, ancestors)
  ancestors.push(node)
  for (const key of Object.keys(node)) {
    if (!SKIPPED_KEYS.has(key))
      walk(Object.getOwnPropertyDescriptor(node, key)?.value, visit, ancestors)
  }
  ancestors.pop()
}

function walkAll(
  nodes: readonly unknown[],
  visit: (node: Node, ancestors: Node[]) => void,
  ancestors: Node[],
) {
  for (const node of nodes) walk(node, visit, ancestors)
}

function scan(program: Node) {
  const strings: never[] = []
  const elements: never[] = []
  walk(program, (node, ancestors) => collect(node, ancestors, strings, elements), [])
  return { strings, elements }
}

function collect(node: Node, ancestors: Node[], strings: StringEntry[], elements: ElementEntry[]) {
  if (node.type === 'JSXOpeningElement')
    elements.push({
      name: jsxName(node.name),
      start: node.start,
      opening: node,
      children: enclosingElement(ancestors)?.children ?? [],
      renderedChildren: renderOwnerChildren(ancestors),
      ancestors: enclosingElements(ancestors),
    })
  const value = stringValue(node)
  if (value === null) return
  const element = nearestElement(ancestors)
  const attribute = nearestAttribute(ancestors)
  strings.push({
    value,
    start: node.start,
    elementName: element === null ? null : jsxName(element.name),
    elementKey: element === null ? null : `e${element.start}`,
    attributeName: attribute?.name.type === 'JSXIdentifier' ? attribute.name.name : undefined,
    row: element !== null && isRowElement(element),
    text: element !== null && elementHasText(enclosingElement(ancestors)),
    disabled:
      element !== null &&
      (hasAttribute(element, 'disabled') || hasAttribute(element, 'aria-disabled')),
    // A truncating class recovers through a title on its own element or on any element that
    // encloses it in this file. What a parent component renders around it is out of view here.
    titled: element !== null && (hasTitle(element) || enclosingElements(ancestors).some(hasTitle)),
  })
}

function hasAttribute(opening: JSXOpeningElement, name: string) {
  return opening.attributes.some(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name?.name === name,
  )
}

function hasTitle(opening: JSXOpeningElement) {
  // `data-tooltip` recovers the same value through the shared tooltip layer,
  // which rows use instead of a native title.
  return hasAttribute(opening, 'title') || hasAttribute(opening, 'data-tooltip')
}

function attributeValue(opening: JSXOpeningElement, name: string) {
  const attribute = opening.attributes.find(
    (entry) => entry.type === 'JSXAttribute' && entry.name?.name === name,
  )
  if (!attribute || attribute.type !== 'JSXAttribute') return null
  const value = attribute.value
  return stringValue(value?.type === 'JSXExpressionContainer' ? value.expression : value)
}

function isRowElement(opening: JSXOpeningElement) {
  return (
    jsxName(opening.name) === 'ListRow' ||
    ['option', 'treeitem', 'row', 'tab'].includes(attributeValue(opening, 'role') ?? '')
  )
}

function enclosingElement(ancestors: Node[]) {
  return ancestors.findLast((node) => node.type === 'JSXElement')
}

function renderOwnerChildren(ancestors: Node[]) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]
    if (ancestor.type !== 'JSXAttribute' || ancestor.name?.name !== 'render') continue
    const owner = enclosingElement(ancestors.slice(0, index))
    if (owner?.children.some(isVisibleChild)) return owner.children
  }
  return []
}

function nearestAttribute(ancestors: Node[]) {
  return ancestors.findLast((node) => node.type === 'JSXAttribute')
}

function childHasText(child: Node): boolean {
  if (child.type === 'JSXText') return child.value.trim() !== ''
  if (child.type === 'JSXExpressionContainer') return child.expression.type !== 'JSXEmptyExpression'
  if (child.type !== 'JSXElement') return false
  if (jsxName(child.openingElement.name)?.endsWith('Icon')) return false
  return child.children.some(childHasText)
}

function elementHasText(element: JSXElement | undefined) {
  return element?.children.some(childHasText) ?? false
}

// The stack holds the JSXElement of every enclosing tag; its opening element carries the props.
function enclosingElements(ancestors: Node[]) {
  return ancestors.filter((node) => node.type === 'JSXElement').map((node) => node.openingElement)
}

function stringValue(node: Node | null | undefined) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateElement') return node.value.cooked ?? node.value.raw
  return null
}

function jsxName(name: JSXElementName | undefined): string | null {
  if (name?.type === 'JSXIdentifier') return name.name
  if (name?.type === 'JSXMemberExpression')
    return `${jsxName(name.object)}.${jsxName(name.property)}`
  return null
}

function nearestElement(ancestors: Node[]) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index]
    if (node.type === 'JSXOpeningElement') return node
  }
  return null
}

function lineLocator(source: string) {
  const lines = new Int32Array(source.length + 1)
  let line = 1
  for (let index = 0; index < source.length; index += 1) {
    lines[index] = line
    if (source[index] === '\n') line += 1
  }
  lines[source.length] = line
  return (offset: number) => lines[Math.min(Math.max(offset, 0), source.length)]
}

function newlinesBefore(value: string, index: number) {
  let count = 0
  for (let at = value.indexOf('\n'); at >= 0 && at < index; at = value.indexOf('\n', at + 1))
    count += 1
  return count
}

// Every element `@workspace/ui` ships a primitive for. Reaching for the raw tag skips the
// primitive's radius, height, focus ring and density, which is the whole point of having one.
const RAW_CONTROL_ELEMENTS = new Set(['button', 'input', 'select', 'textarea'])

function recordElement(census: Census, file: string, element: ElementEntry, lineAt: LineAt) {
  const hit = { file, line: lineAt(element.start), value: `<${element.name}>` }
  if (RAW_CONTROL_ELEMENTS.has(element.name ?? '')) census.hits.rawControls.push(hit)
  if (/^[a-z]/.test(element.name ?? '') && attributeValue(element.opening, 'role') === 'button') {
    census.hits.rawControls.push({ ...hit, value: 'role="button"' })
  }
  if (element.name === 'kbd' && file !== KBD_PRIMITIVE) census.hits.kbdSpelling.push(hit)
  if (!isControl(element)) return
  const ownChildren = element.children.filter(isVisibleChild)
  const children =
    ownChildren.length > 0 ? ownChildren : element.renderedChildren.filter(isVisibleChild)
  const iconSize = /^icon(?:-|$)/.test(attributeValue(element.opening, 'size') ?? '')
  if (!iconSize && (children.length === 0 || !children.every(isIconChild))) return
  const problem = iconHintProblem(element)
  if (problem !== null) census.hits.iconOnlyHint.push({ ...hit, value: problem })
}

function iconHintProblem(element: ElementEntry) {
  // `data-tooltip` is the shared tooltip layer, not a native title: rows use it so nothing mounts per control.
  const sharedTooltip = hasAttribute(element.opening, 'data-tooltip')
  if (!sharedTooltip && hasTitle(element.opening)) return 'icon-only title'
  if (!sharedTooltip && !hasTooltipTrigger(element)) return 'missing Tooltip'
  if (!['Button', 'InputGroupButton'].includes(element.name ?? '')) return null
  if (!booleanAttribute(element.opening, 'disabled')) return null
  if (booleanAttribute(element.opening, 'focusableWhenDisabled')) return null
  return 'disabled Tooltip trigger needs focusableWhenDisabled'
}

function booleanAttribute(opening: JSXOpeningElement, name: string) {
  const attribute = opening.attributes.find(
    (entry) => entry.type === 'JSXAttribute' && entry.name?.name === name,
  )
  if (!attribute) return false
  if (attribute.type !== 'JSXAttribute') return false
  const value = attribute.value
  return (
    value?.type !== 'JSXExpressionContainer' ||
    value.expression.type !== 'Literal' ||
    value.expression.value !== false
  )
}

function isControl(element: ElementEntry) {
  if (['button', 'Button', 'InputGroupButton', 'a', 'Link'].includes(element.name ?? ''))
    return true
  if (attributeValue(element.opening, 'role') === 'button') return true
  if (hasAttribute(element.opening, 'render')) return false
  return /^(?:DropdownMenu|Popover|Dialog|Collapsible|Select|Accordion)(?:Trigger|Close)$/.test(
    element.name ?? '',
  )
}

function hasTooltipTrigger(element: ElementEntry) {
  for (const opening of element.ancestors.toReversed()) {
    const name = jsxName(opening.name)
    if (name === 'TooltipContent') return false
    if (name === 'TooltipTrigger' || name === 'IconTooltip') return true
  }
  return false
}

function isVisibleChild(child: Node) {
  if (child.type === 'JSXText') return child.value.trim() !== ''
  if (child.type === 'JSXElement') return !isHiddenElement(child.openingElement)
  return child.type !== 'JSXExpressionContainer' || child.expression.type !== 'JSXEmptyExpression'
}

function isHiddenElement(opening: JSXOpeningElement) {
  const classes = attributeValue(opening, 'className')?.split(/\s+/) ?? []
  return classes.includes('sr-only') || classes.includes('hidden')
}

function isIconChild(child: Node): boolean {
  if (child.type === 'JSXElement') {
    const name = jsxName(child.openingElement.name)
    if (isHiddenElement(child.openingElement)) return true
    if (name?.endsWith('Icon')) return true
    if (['svg', 'img', 'Spinner'].includes(name ?? '')) return true
    if (name !== 'span' && name !== 'div') return false
    const children = child.children.filter(isVisibleChild)
    return children.length > 0 && children.every(isIconChild)
  }
  if (child.type === 'JSXFragment') {
    const children = child.children.filter(isVisibleChild)
    return children.length > 0 && children.every(isIconChild)
  }
  if (child.type === 'JSXExpressionContainer') return isIconChild(child.expression)
  if (child.type === 'Literal') return child.value === null || typeof child.value === 'boolean'
  if (child.type === 'ConditionalExpression')
    return isIconChild(child.consequent) || isIconChild(child.alternate)
  if (child.type === 'LogicalExpression') return isIconChild(child.right)
  return false
}

function lineOfEntry(entry: StringEntry, lineAt: LineAt) {
  return (index: number) => lineAt(entry.start) + newlinesBefore(entry.value, index)
}

function recordString(
  census: Census,
  file: string,
  entry: StringEntry,
  lineAt: LineAt,
  groups: Groups,
) {
  const lineOf = lineOfEntry(entry, lineAt)
  for (const match of entry.value.matchAll(SCROLLBAR_CLASS)) {
    census.hits.scrollIdiom.push({ file, line: lineOf(match.index), value: match[1] })
  }
  if (!looksLikeClassString(entry.value)) return
  recordDensityVars(census, file, entry, lineOf)
  const group = groupFor(groups, entry)
  for (const token of classTokens(entry.value))
    recordToken(census, file, entry, token, lineOf, group)
}

// Only markup is scanned for these. A hex in a component is a styling decision that owed a token;
// in a plain `.ts` module it is data — a CodeMirror theme, a canvas fillStyle — with no token form.
// A palette *class* still counts in either kind of file.
function recordColorLiterals(census: Census, file: string, entry: StringEntry, lineOf: LineAt) {
  for (const match of entry.value.matchAll(COLOR_LITERAL)) {
    census.hits.paletteLeaks.push({ file, line: lineOf(match.index), value: match[0] })
  }
}

function recordDensityVars(census: Census, file: string, entry: StringEntry, lineOf: LineAt) {
  for (const match of entry.value.matchAll(DENSITY_VAR)) {
    census.hits.densityVars.push({ file, line: lineOf(match.index), value: match[0] })
  }
}

function groupFor(groups: Groups, entry: StringEntry) {
  const key = entry.elementKey ?? `s${entry.start}`
  const existing = groups.get(key)
  if (existing) return existing
  const created: Group = { bases: new Set(), heights: [], round: null, cap: null }
  groups.set(key, created)
  return created
}

function recordToken(
  census: Census,
  file: string,
  entry: StringEntry,
  token: Token,
  lineOf: LineAt,
  group: Group,
) {
  const hit = { file, line: lineOf(token.index), value: token.base }
  // Only an unconditional class describes this element. Behind a variant it is an override for a
  // breakpoint, a state or — with `[&_input]:` — a descendant, and none of those make it a bar.
  if (token.variants.length === 0) recordBarShape(group, hit, token.base)
  if (token.variants.includes('compact'))
    census.hits.compactVariant.push({ ...hit, value: token.raw })
  if (HAIRLINE.test(token.base) && !HAIRLINE_BASE.test(entry.value)) census.hits.hairlines.push(hit)
  if (ARBITRARY_TEXT.test(token.base)) census.hits.arbitraryText.push(hit)
  if (PALETTE_CLASS.test(token.base)) census.hits.paletteLeaks.push(hit)
  if (TRUNCATION.test(token.base) && !entry.titled) census.hits.truncationRecovery.push(hit)
  recordPatternTokens(census, entry, token, hit)
  recordHoverFill(census, file, entry, token, hit)
  recordShadow(census, token, hit)
  recordRadius(census, entry, token, hit)
}

function recordBarShape(group: Group, hit: CensusHit, base: string) {
  group.bases.add(base)
  if (base === 'rounded-full') group.round = hit
  if (CAPPED.test(base)) group.cap = hit
  if (HEIGHT_TOKEN.test(base)) group.heights.push(hit)
}

// A hovered fill of any kind is histogram material; a row token wearing an opacity modifier is
// recorded whatever variant it carries, because that is the slice this measure gates.
function recordHoverFill(
  census: Census,
  file: string,
  entry: StringEntry,
  token: Token,
  hit: CensusHit,
) {
  const hovers = token.variants.includes('hover')
  const fill = hovers && token.base.startsWith('bg-')
  if (!fill && !ROW_FILL_OPACITY.test(token.base)) return
  census.hits.hoverFills.push({
    ...hit,
    value: hovers ? `hover:${token.base}` : token.base,
    row: entry.row || file.endsWith('-row.tsx'),
  })
}

function recordPatternTokens(census: Census, entry: StringEntry, token: Token, hit: CensusHit) {
  if (
    entry.elementName?.endsWith('Icon') &&
    entry.attributeName === 'className' &&
    token.base.startsWith('size-')
  )
    census.hits.iconSize.push(hit)
  if (/^text-(?:muted-)?foreground\//.test(token.base)) census.hits.textAlpha.push(hit)
  const opacity = /^opacity-(\d+)$/.exec(token.base)?.[1]
  if (!entry.text || opacity === undefined || opacity === '0' || opacity === '100') return
  const disabled =
    entry.disabled ||
    token.variants.some((variant: string) =>
      ['disabled', 'aria-disabled', 'data-disabled'].includes(variant),
    )
  if (opacity === '50' && disabled) return
  census.hits.textAlpha.push(hit)
}

function recordShadow(census: Census, token: Token, hit: CensusHit) {
  const step = shadowStep(token.base)
  if (step === null) return
  census.hits.shadow.push({ ...hit, value: step })
}

function recordRadius(census: Census, entry: StringEntry, token: Token, hit: CensusHit) {
  if (radiusInfo(token.base) === null) return
  census.hits.radius.push(hit)
  if (entry.elementName === 'Button') census.hits.buttonRadius.push(hit)
}

// A bar carries a top or bottom rule and lays its cells out along one line: `items-center` for a
// flex bar, `grid` for the titlebar, which sizes its cells with grid columns instead. Requiring a
// fixed height as well is what keeps a bordered content block out: those grow with their content.
function isBar(bases: Set<string>) {
  if (!bases.has('border-b') && !bases.has('border-t')) return false
  return bases.has('items-center') || bases.has('grid')
}

// Every explicit `h-(--bar-height)` counts wherever it sits, so the token shows up in the
// histogram as the single settled value.
function recordBarHeights(census: Census, groups: Groups) {
  const seen = new Set()
  for (const group of groups.values()) {
    const bar = isBar(group.bases)
    for (const hit of group.heights) {
      if (!bar && hit.value !== BAR_HEIGHT) continue
      if (seen.has(`${hit.file}:${hit.line}:${hit.value}`)) continue
      seen.add(`${hit.file}:${hit.line}:${hit.value}`)
      census.hits.barHeights.push(hit)
    }
  }
}

function recordStatusDots(census: Census, groups: Groups) {
  for (const group of groups.values()) {
    if (group.round === null) continue
    if (![...group.bases].some((base) => DOT_MARK.test(base))) continue
    census.hits.statusDots.push(group.round)
  }
}

function recordUncontainedScrollers(census: Census, groups: Groups) {
  for (const group of groups.values()) {
    if (group.cap === null || group.bases.has('overscroll-contain')) continue
    if (![...group.bases].some((base) => SCROLLS.test(base))) continue
    census.hits.uncontainedScroller.push(group.cap)
  }
}

function readAllowList(file: string) {
  if (!fs.existsSync(file)) return []
  return JSON.parse(read(file))
}

function validateAllowEntries(value: unknown) {
  if (!Array.isArray(value))
    return ['the allow-list must be a JSON array of { file, class, reason } entries']
  return value.flatMap(entryProblems)
}

function entryProblems(entry: unknown, index: number) {
  const label = `allow[${index}]`
  if (!entry || typeof entry !== 'object') return [`${label}: entry must be an object`]
  const file = 'file' in entry ? entry.file : undefined
  const className = 'class' in entry ? entry.class : undefined
  const reason = 'reason' in entry ? entry.reason : undefined
  const problems = []
  if (typeof file !== 'string' || file === '') problems.push(`${label}: missing "file"`)
  if (typeof className !== 'string' || className === '') problems.push(`${label}: missing "class"`)
  if (typeof reason !== 'string' || reason.trim() === '')
    problems.push(
      `${label} (${file ?? '?'} ${className ?? '?'}): an exception without a reason is itself a violation`,
    )
  return problems
}

function isAllowEntry(entry: unknown): entry is AllowEntry {
  return entryProblems(entry, 0).length === 0
}

function allowKey(file: string, className: string) {
  return `${file} :: ${className}`
}

function allowIndex(entries: unknown) {
  const index = new Set<string>()
  if (!Array.isArray(entries)) return index
  for (const entry of entries) {
    if (!isAllowEntry(entry)) continue
    index.add(allowKey(entry.file, entry.class))
  }
  return index
}

function unallowed(hits: CensusHit[], allow: Set<string>) {
  return hits.filter((hit) => !allow.has(allowKey(hit.file, hit.value)))
}

function bareRadiusHits(census: Census) {
  return census.hits.radius.filter((hit) => radiusInfo(hit.value)?.step === null)
}

// No radius class already means no radius, so a `rounded-none` only ever cancels a corner a
// primitive owns. Where that is deliberate it needs an allow-list entry saying so.
function nullRadiusHits(census: Census) {
  return census.hits.radius.filter((hit) => radiusInfo(hit.value)?.step === 'none')
}

function rowFillOpacityHits(census: Census) {
  return census.hits.hoverFills.filter(
    (hit) => ROW_FILL_OPACITY.test(hit.value) || (hit.row && hit.value !== 'hover:bg-row-hover'),
  )
}

/** Drops the hits a measure cannot judge in the root they came from. */
function scoped(measure: string, hits: CensusHit[]) {
  const skip = targets[measure].skipUnder
  if (skip === undefined) return hits
  return hits.filter((hit: { file: string }) => !skip.some((prefix) => hit.file.startsWith(prefix)))
}

function offScaleRadius(census: Census) {
  return census.hits.radius.filter((hit) => {
    const step = radiusInfo(hit.value)?.step
    return step !== null && step !== undefined && !TARGETS.radius.allowed?.includes(step)
  })
}

function offTarget(hits: CensusHit[], allowed: readonly string[] | undefined) {
  return hits.filter((hit) => !allowed?.includes(hit.value))
}

function offScaleShadows(census: Census) {
  return offTarget(census.hits.shadow, TARGETS.shadow.allowed).filter(
    (hit: { file: string; value: string }) =>
      !hit.file.startsWith(UI_PACKAGE) ||
      !['shadow-(--shadow-key)', 'shadow-(--shadow-well)'].includes(hit.value),
  )
}

/** An exception matching nothing is a claim about code that no longer exists. */
function staleEntries(entries: unknown, census: Census) {
  if (!Array.isArray(entries)) return []
  const seen = new Set()
  for (const hits of Object.values(census.hits))
    for (const hit of hits) seen.add(allowKey(hit.file, hit.value))
  return entries
    .filter(isAllowEntry)
    .filter((entry) => !seen.has(allowKey(entry.file, entry.class)))
    .map((entry) => `${entry.file} :: ${entry.class}: stale, no such hit remains`)
}

export function evaluate(census: Census, allowEntries: unknown = [], { checkStale = true } = {}) {
  const allowProblems = validateAllowEntries(allowEntries)
  if (checkStale) allowProblems.push(...staleEntries(allowEntries, census))
  const allow = allowIndex(allowEntries)
  const gate = (measure: string, hits: CensusHit[]) => unallowed(scoped(measure, hits), allow)
  const offenders = {
    radius: gate('radius', offScaleRadius(census)),
    bareRadius: gate('bareRadius', bareRadiusHits(census)),
    nullRadius: gate('nullRadius', nullRadiusHits(census)),
    buttonRadius: gate('buttonRadius', census.hits.buttonRadius),
    compactVariant: gate('compactVariant', census.hits.compactVariant),
    barHeights: gate('barHeights', offTarget(census.hits.barHeights, TARGETS.barHeights.allowed)),
    hairlines: gate('hairlines', census.hits.hairlines),
    arbitraryText: gate('arbitraryText', census.hits.arbitraryText),
    shadow: gate('shadow', offScaleShadows(census)),
    rawControls: gate('rawControls', census.hits.rawControls),
    hoverFills: gate('hoverFills', rowFillOpacityHits(census)),
    iconSize: gate('iconSize', offTarget(census.hits.iconSize, TARGETS.iconSize.allowed)),
    textAlpha: gate('textAlpha', census.hits.textAlpha),
    iconOnlyHint: gate('iconOnlyHint', census.hits.iconOnlyHint),
    paletteLeaks: gate('paletteLeaks', census.hits.paletteLeaks),
    statusDots: gate('statusDots', census.hits.statusDots),
    scrollIdiom: gate('scrollIdiom', census.hits.scrollIdiom),
    uncontainedScroller: gate('uncontainedScroller', census.hits.uncontainedScroller),
    kbdSpelling: gate('kbdSpelling', census.hits.kbdSpelling),
    truncationRecovery: gate('truncationRecovery', census.hits.truncationRecovery),
  }
  const failures = Object.entries(offenders)
    .filter(([, hits]) => hits.length > 0)
    .map(([measure, hits]) => ({ measure, title: targets[measure].title, count: hits.length }))
  return {
    offenders,
    failures,
    allowProblems,
    passed: failures.length === 0 && allowProblems.length === 0,
  }
}

function toJson(census: Census, result: ReturnType<typeof evaluate>, roots: Roots) {
  const measures: Record<string, Record<string, number>> = {}
  for (const measure of MEASURES)
    measures[measure] = Object.fromEntries(histogram(census.hits[measure]))
  return {
    roots,
    files: census.files,
    measures,
    totals: Object.fromEntries(
      ALL_MEASURES.map((measure) => [measure, hitsFor(census, measure).length]),
    ),
    violations: Object.fromEntries(
      Object.entries(result.offenders).map(([measure, hits]) => [measure, hits]),
    ),
    failures: result.failures,
    allowProblems: result.allowProblems,
    parseErrors: census.parseErrors,
    passed: result.passed,
  }
}

function formatCounts(census: Census) {
  const rows: [string, number][] = ALL_MEASURES.map((measure) => [
    targets[measure].title,
    hitsFor(census, measure).length,
  ])
  const width = Math.max(...rows.map(([title]) => title.length))
  return [
    'totals',
    ...rows.map(([title, count]) => `  ${title.padEnd(width)}  ${String(count).padStart(6)}`),
  ].join('\n')
}

function formatRoots(roots: Roots) {
  return roots.map(({ root, files }) => `${root} ${files}`).join(', ')
}

function formatReport(census: Census, result: ReturnType<typeof evaluate>, roots: Roots) {
  const listed = ALL_MEASURES.filter((measure) => targets[measure].listed)
  return [
    `Web design census — ${census.files} .ts/.tsx files, tests excluded: ${formatRoots(roots)}`,
    '',
    formatCounts(census),
    '',
    ...MEASURES.filter((measure) => targets[measure].histogram).map(
      (measure) => `${formatHistogram(targets[measure].title, census.hits[measure])}\n`,
    ),
    ...listed.map((measure) => `${formatList(targets[measure].title, hitsFor(census, measure))}\n`),
    formatGate(result),
    '',
  ].join('\n')
}

function hitsFor(census: Census, measure: string) {
  const derived = DERIVED[measure]
  return derived === undefined ? census.hits[measure] : derived(census)
}

runCensusIfMain(import.meta.url, {
  repository: REPOSITORY,
  defaultRoots: DEFAULT_ROOTS,
  defaultAllow: DEFAULT_ALLOW,
  censusTree,
  mergeCensus,
  readAllowList,
  evaluate,
  toJson,
  formatReport,
})
