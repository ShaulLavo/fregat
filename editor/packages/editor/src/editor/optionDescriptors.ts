import { normalizeEditorEditability } from './editorDocument'
import {
  normalizeGutterLeadingInset,
  normalizeRowGap,
  normalizeRowHeight,
  normalizeScrollMode,
} from '../virtualization/virtualizedTextViewHelpers'
import { normalizeHiddenCharactersMode } from '../virtualization/virtualizedTextViewHiddenCharacters'
import {
  type EditorSuspiciousCharactersOptions,
  normalizeSuspiciousCharactersOptions,
  sameSuspiciousCharactersOptions,
} from '../unicodeHighlight'
import type { Editor } from './Editor'
import type { EditorKeymapOptions } from '../keymap/presets'
import type { EditorSetSelectionOptions } from './selectionReveal'
import type {
  EditorEditability,
  EditorRangeDecoration,
  EditorScrollMode,
  EditorScrollPosition,
} from './types'
import type { EditorTheme } from '../theme'
import type { HiddenCharactersMode } from '../virtualization/virtualizedTextViewTypes'

/** Selection driven from outside the editor, in the shape `setSelection` consumes. */
export type EditorControlledSelection = EditorSetSelectionOptions & {
  readonly anchor: number
  readonly head?: number
}

type EditorControlledOptions = {
  readonly detectIndentation?: boolean
  readonly editability?: EditorEditability
  readonly folding?: boolean
  readonly fontFamily?: string
  readonly fontSize?: number
  readonly gutterLeadingInset?: number
  readonly hiddenCharacters?: HiddenCharactersMode
  readonly keymap?: EditorKeymapOptions
  readonly lineHeight?: number
  readonly rangeDecorations?: readonly EditorRangeDecoration[]
  readonly rowGap?: number
  readonly scrollMode?: EditorScrollMode
  readonly scrollPosition?: EditorScrollPosition | null
  readonly selection?: EditorControlledSelection | null
  readonly suspiciousCharacters?: EditorSuspiciousCharactersOptions
  readonly tabMovesFocus?: boolean
  readonly tabSize?: number
  readonly theme?: EditorTheme | null
  readonly wordWrap?: boolean
}

export type EditorControlledOptionName = keyof EditorControlledOptions

type EditorControlledOptionValue = EditorControlledOptions[EditorControlledOptionName]

type EditorOptionDefinition<K extends EditorControlledOptionName> = {
  readonly name: K
  // Read by nothing on the way to the editor: it stands next to the validator that has to
  // produce it, so the validator can be held to it.
  readonly defaultValue: EditorControlledOptions[K]
  // Whatever comes back reaches the editor unfiltered, so input the option cannot use has to
  // leave here as a value the option can live with rather than as a failure.
  validate(input: unknown): EditorControlledOptions[K]
  /**
   * Guards the setter call. Object identity is enough for the options whose setters already
   * compare contents before doing work; the ones a host rebuilds inline on every update compare
   * field by field, so an unchanged value never re-enters the editor and overrides the user.
   */
  equals(left: EditorControlledOptions[K], right: EditorControlledOptions[K]): boolean
  /**
   * `undefined` arrives here rather than being filtered out earlier, because its meaning is
   * per-option: where the setter is also the reset path it asks for the editor default, and
   * everywhere else it says this host does not control the option at all.
   *
   * Reports whether the value reached the editor, which is the only thing the change tracker can
   * safely remember: a value it turned away left the editor on whatever it had before.
   */
  applyTo(editor: Editor, value: EditorControlledOptions[K]): boolean
}

export type EditorOptionDescriptor<
  K extends EditorControlledOptionName = EditorControlledOptionName,
> = EditorOptionDefinition<K> & {
  // Handed out by position when the registry below is built, so it means nothing away from that
  // array — which is what lets change tracking keep its per-option state in a plain dense list.
  readonly id: number
}

export type EditorOptionSync = {
  apply(editor: Editor | null, descriptor: EditorOptionDescriptor, input: unknown): void
  reset(): void
}

type AppliedOption = {
  readonly value: EditorControlledOptionValue
}

/**
 * Every option a host binding keeps in sync with a live editor.
 *
 * Bindings apply options by iterating this array instead of naming options one at a time: a list
 * written out by hand inside a binding drifts from the next binding's list without anything
 * noticing, because nothing relates the two.
 */
export const EDITOR_OPTION_DESCRIPTORS: readonly EditorOptionDescriptor[] = [
  defineOption({
    name: 'detectIndentation',
    defaultValue: true,
    validate: (input) => (typeof input === 'boolean' ? input : undefined),
    equals: Object.is,
    applyTo: (editor, enabled) => {
      if (enabled === undefined) return false
      editor.setDetectIndentation(enabled)
      return true
    },
  }),
  defineOption({
    name: 'folding',
    defaultValue: true,
    validate: (input) => (typeof input === 'boolean' ? input : undefined),
    equals: Object.is,
    applyTo: (editor, enabled) => {
      if (enabled === undefined) return false
      editor.setFolding(enabled)
      return true
    },
  }),
  defineOption({
    name: 'editability',
    defaultValue: 'editable',
    validate: (input) =>
      input === undefined ? undefined : normalizeEditorEditability(input as EditorEditability),
    equals: Object.is,
    applyTo: (editor, editability) => {
      if (editability === undefined) return false

      editor.setEditability(editability)
      return true
    },
  }),
  // Undefined is a value here, not "not controlled": it hands the font back to the stylesheet, so
  // a host that stops passing one does not leave the editor on the last size it was given.
  defineOption({
    name: 'fontFamily',
    defaultValue: undefined,
    validate: (input) => (typeof input === 'string' ? input : undefined),
    equals: Object.is,
    applyTo: (editor, fontFamily) => {
      editor.setFontFamily(fontFamily)
      return true
    },
  }),
  defineOption({
    name: 'fontSize',
    defaultValue: undefined,
    validate: (input) =>
      typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : undefined,
    equals: Object.is,
    applyTo: (editor, fontSize) => {
      editor.setFontSize(fontSize)
      return true
    },
  }),
  // Undefined resets to no inset, so a host that stops passing one gets the flush gutter back.
  defineOption({
    name: 'gutterLeadingInset',
    defaultValue: 0,
    validate: (input) =>
      input === undefined ? undefined : normalizeGutterLeadingInset(input as number),
    equals: Object.is,
    applyTo: (editor, inset) => {
      editor.setGutterLeadingInset(inset ?? 0)
      return true
    },
  }),
  defineOption({
    name: 'hiddenCharacters',
    defaultValue: 'show-on-selection',
    validate: (input) =>
      input === undefined
        ? undefined
        : normalizeHiddenCharactersMode(input as HiddenCharactersMode),
    equals: Object.is,
    applyTo: (editor, hiddenCharacters) => {
      if (hiddenCharacters === undefined) return false

      editor.setHiddenCharacters(hiddenCharacters)
      return true
    },
  }),
  defineOption({
    name: 'keymap',
    defaultValue: undefined,
    validate: (input) => (isRecord(input) ? (input as EditorKeymapOptions) : undefined),
    equals: Object.is,
    applyTo: (editor, keymap) => {
      editor.setKeymap(keymap)
      return true
    },
  }),
  // No default of its own: a host that names no row height gets the one the editor measures from
  // the font it was given, which is a number nothing here could have written down.
  defineOption({
    name: 'lineHeight',
    defaultValue: undefined,
    validate: (input) => (input === undefined ? undefined : normalizeRowHeight(input as number)),
    equals: Object.is,
    applyTo: (editor, lineHeight) => {
      if (lineHeight === undefined) return false

      editor.setLineHeight(lineHeight)
      return true
    },
  }),
  defineOption({
    name: 'rangeDecorations',
    defaultValue: [],
    validate: (input) => {
      if (input === undefined) return undefined

      return Array.isArray(input) ? (input as readonly EditorRangeDecoration[]) : []
    },
    equals: Object.is,
    applyTo: (editor, rangeDecorations) => {
      if (rangeDecorations === undefined) return false

      editor.setRangeDecorations(rangeDecorations)
      return true
    },
  }),
  defineOption({
    name: 'rowGap',
    defaultValue: 0,
    validate: (input) => (input === undefined ? undefined : normalizeRowGap(input as number)),
    equals: Object.is,
    applyTo: (editor, rowGap) => {
      if (rowGap === undefined) return false

      editor.setRowGap(rowGap)
      return true
    },
  }),
  defineOption({
    name: 'scrollMode',
    defaultValue: 'virtualized',
    validate: (input) =>
      input === undefined ? undefined : normalizeScrollMode(input as EditorScrollMode),
    equals: Object.is,
    applyTo: (editor, scrollMode) => {
      editor.setScrollMode(scrollMode)
      return true
    },
  }),
  defineOption({
    name: 'selection',
    defaultValue: null,
    validate: (input) => validateSelection(input),
    equals: (left, right) => selectionsEqual(left, right),
    applyTo: (editor, selection) => {
      if (!selection) return false

      editor.setSelection(selection.anchor, selection.head, {
        affinity: selection.affinity,
        reveal: selection.reveal,
        revealBlock: selection.revealBlock,
        revealOffset: selection.revealOffset,
      })
      return true
    },
  }),
  // After the selection, whose reveal scrolls: a host driving both wants the position it asked
  // for, not the one the caret implied.
  defineOption({
    name: 'scrollPosition',
    defaultValue: null,
    validate: (input) => validateScrollPosition(input),
    equals: (left, right) => scrollPositionsEqual(left, right),
    applyTo: (editor, scrollPosition) => {
      if (!scrollPosition) return false

      editor.setScrollPosition(scrollPosition)
      return true
    },
  }),
  defineOption({
    name: 'suspiciousCharacters',
    defaultValue: normalizeSuspiciousCharactersOptions(undefined),
    validate: (input) =>
      isRecord(input)
        ? normalizeSuspiciousCharactersOptions(input as EditorSuspiciousCharactersOptions)
        : undefined,
    equals: sameSuspiciousCharactersOptions,
    applyTo: (editor, suspiciousCharacters) => {
      if (suspiciousCharacters === undefined) return false

      editor.setSuspiciousCharacters(suspiciousCharacters)
      return true
    },
  }),
  // Undefined resets to the default width rather than meaning "not controlled", for the same
  // reason as the font options.
  defineOption({
    name: 'tabSize',
    defaultValue: undefined,
    validate: (input) =>
      typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : undefined,
    equals: Object.is,
    applyTo: (editor, tabSize) => {
      editor.setTabSize(tabSize)
      return true
    },
  }),
  defineOption({
    name: 'tabMovesFocus',
    defaultValue: false,
    validate: (input) => (typeof input === 'boolean' ? input : undefined),
    equals: Object.is,
    applyTo: (editor, tabMovesFocus) => {
      if (tabMovesFocus === undefined) return false

      editor.setTabMovesFocus(tabMovesFocus)
      return true
    },
  }),
  defineOption({
    name: 'theme',
    defaultValue: null,
    validate: (input) => (isRecord(input) ? (input as EditorTheme) : null),
    equals: Object.is,
    applyTo: (editor, theme) => {
      editor.setTheme(theme)
      return true
    },
  }),
  defineOption({
    name: 'wordWrap',
    defaultValue: false,
    validate: (input) => (typeof input === 'boolean' ? input : undefined),
    equals: Object.is,
    applyTo: (editor, wordWrap) => {
      if (wordWrap === undefined) return false

      editor.setWordWrap(wordWrap)
      return true
    },
  }),
].map((definition, id): EditorOptionDescriptor => ({ ...definition, id }))

export function createEditorOptionSync(): EditorOptionSync {
  const applied: (AppliedOption | undefined)[] = []

  return {
    apply: (editor, descriptor, input) => {
      if (!editor) return

      const value = descriptor.validate(input)
      const previous = applied[descriptor.id]
      if (previous && descriptor.equals(previous.value, value)) return

      // Only what the editor took is worth remembering. A descriptor that turns a value away —
      // `undefined` from a host that has stopped controlling the option — leaves the editor on the
      // last value it did take, and recording the refused one instead would let an `equals` that
      // reads `undefined` as the default swallow the host's next request to turn the option back on.
      if (descriptor.applyTo(editor, value)) applied[descriptor.id] = { value }
    },
    // A new editor knows none of the values this tracker recorded for the previous one.
    reset: () => {
      applied.length = 0
    },
  }
}

function defineOption<K extends EditorControlledOptionName>(
  definition: EditorOptionDefinition<K>,
): EditorOptionDefinition<K> {
  return definition
}

function validateSelection(input: unknown): EditorControlledSelection | null {
  if (!isRecord(input)) return null

  const anchor = validateOffset(input.anchor)
  if (anchor === undefined) return null

  return {
    affinity: validateSelectionAffinity(input.affinity),
    anchor,
    head: validateOffset(input.head),
    reveal: typeof input.reveal === 'boolean' ? input.reveal : undefined,
    revealBlock: validateRevealBlock(input.revealBlock),
    revealOffset: validateOffset(input.revealOffset),
  }
}

function selectionsEqual(
  left: EditorControlledSelection | null | undefined,
  right: EditorControlledSelection | null | undefined,
): boolean {
  if (!left || !right) return left === right

  return (
    left.affinity === right.affinity &&
    left.anchor === right.anchor &&
    left.head === right.head &&
    left.reveal === right.reveal &&
    left.revealBlock === right.revealBlock &&
    left.revealOffset === right.revealOffset
  )
}

function validateRevealBlock(input: unknown): EditorControlledSelection['revealBlock'] {
  if (input === 'nearest' || input === 'center' || input === 'end') return input
  if (input === 'center-if-outside') return input
  return undefined
}

function validateSelectionAffinity(input: unknown): EditorControlledSelection['affinity'] {
  if (input === 'before' || input === 'after') return input
  return undefined
}

function validateScrollPosition(input: unknown): EditorScrollPosition | null {
  if (!isRecord(input)) return null

  const top = validateOffset(input.top)
  const left = validateOffset(input.left)
  if (top === undefined && left === undefined) return null

  return { top, left }
}

function scrollPositionsEqual(
  left: EditorScrollPosition | null | undefined,
  right: EditorScrollPosition | null | undefined,
): boolean {
  if (!left || !right) return left === right

  return left.top === right.top && left.left === right.left
}

function validateOffset(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null
}
