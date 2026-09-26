import { detectPlatform, type RawHotkey, type RawModifiers } from '@tanstack/hotkeys'
import { EDITOR_FOLD_LEVELS, type EditorCommandId } from '../editor/commands'
import { editorCommandDeclaration, type EditorCommandPack } from '../editor/commandCatalog'
import type { KeyChord } from './types'
import { type EditorKeyCondition, editorCommandMutates } from './conditions'
type EditorPlatform = ReturnType<typeof detectPlatform>
export type { EditorCommandPack } from '../editor/commandCatalog'

export type EditorKeymapLayerSource = 'core' | 'app'

export type EditorKeyBinding = {
  readonly chord: KeyChord
  readonly when?: readonly EditorKeyCondition[]
  readonly command: EditorCommandId
  readonly preventDefault?: boolean
  readonly stopPropagation?: boolean
}

export type EditorKeymapLayer = {
  readonly id: string
  readonly bindings: readonly EditorKeyBinding[]
  readonly source?: EditorKeymapLayerSource
}

export type EditorKeymapOptions = {
  readonly preset?: 'default' | 'vscode'
  readonly enabled?: boolean
  readonly defaultBindings?: boolean
  readonly layers?: readonly EditorKeymapLayer[]
}

export function editorKeyBindings(options: EditorKeymapOptions = {}): readonly EditorKeyBinding[] {
  return editorKeyBindingsFromLayers(editorKeymapLayers(options))
}

export function editorKeymapLayers(
  options: EditorKeymapOptions = {},
): readonly EditorKeymapLayer[] {
  const defaults =
    options.defaultBindings === false ? [] : presetEditorKeymapLayers(options.preset ?? 'default')

  return defaults.concat(options.layers ?? [])
}

export function editorKeyBindingsFromLayers(
  layers: readonly EditorKeymapLayer[],
  _platform: EditorPlatform = detectPlatform(),
): readonly EditorKeyBinding[] {
  // Later layers take precedence; conditional rows in every layer remain ordered fallbacks.
  return layers.toReversed().flatMap((layer) => layer.bindings)
}

export function defaultEditorKeyBindings(
  platform: EditorPlatform = detectPlatform(),
): readonly EditorKeyBinding[] {
  return editorKeyBindingsFromLayers(defaultEditorKeymapLayers(platform), platform)
}

export const defaultEditorCommandPacks = [
  'navigation',
  'selection',
  'find',
  'text-editing',
  'advanced-editing',
  'multi-cursor',
  'folding',
  'lsp-navigation',
  'lsp-editing',
  'inline-suggest',
  // Last, so it outranks every other layer: its keys are the arrows, Enter, Tab and Escape.
  'suggest',
] as const satisfies readonly EditorCommandPack[]

export const readonlySafeEditorCommandPacks = [
  'navigation',
  'selection',
  'find',
  // Folding writes nothing back to the document, so a reader of one keeps every one of these keys.
  'folding',
] as const satisfies readonly EditorCommandPack[]

export function defaultEditorKeymapLayers(
  platform: EditorPlatform = detectPlatform(),
): readonly EditorKeymapLayer[] {
  return editorKeymapLayersForCommandPacks(defaultEditorCommandPacks, platform)
}

export function editorKeymapLayersForCommandPacks(
  packs: readonly EditorCommandPack[],
  platform: EditorPlatform = detectPlatform(),
): readonly EditorKeymapLayer[] {
  return packs.map((pack) => editorKeymapLayerForCommandPack(pack, platform))
}

export function editorKeymapLayerForCommandPack(
  pack: EditorCommandPack,
  platform: EditorPlatform = detectPlatform(),
): EditorKeymapLayer {
  return {
    id: `core.${pack}`,
    source: 'core',
    bindings: editorKeyBindingsForCommandPack(pack, platform).map(withEditorConditions),
  }
}

export function editorKeymapLayersForBindings(
  bindings: readonly EditorKeyBinding[],
  packs: readonly EditorCommandPack[] = defaultEditorCommandPacks,
  options: {
    readonly idPrefix?: string
    readonly source?: EditorKeymapLayerSource
  } = {},
): readonly EditorKeymapLayer[] {
  const idPrefix = options.idPrefix ?? 'custom'
  const source = options.source ?? 'app'

  return packs.flatMap((pack) => {
    const packBindings = bindings.filter(
      (binding) => editorCommandPackForCommand(binding.command) === pack,
    )
    if (packBindings.length === 0) return []

    return [{ id: `${idPrefix}.${pack}`, source, bindings: packBindings }]
  })
}

export function filterEditorKeymapLayersByCommandPacks(
  layers: readonly EditorKeymapLayer[],
  packs: readonly EditorCommandPack[],
): readonly EditorKeymapLayer[] {
  const enabledPacks = new Set(packs)

  return layers.flatMap((layer) => {
    const bindings = layer.bindings.filter((binding) =>
      editorCommandInPacks(binding.command, enabledPacks),
    )
    if (bindings.length === 0) return []

    return [{ ...layer, bindings }]
  })
}

export function editorCommandPackForCommand(command: EditorCommandId): EditorCommandPack | null {
  const category = editorCommandDeclaration(command).category
  return category === 'merge-conflict' ? null : category
}

function editorKeyBindingsForCommandPack(
  pack: EditorCommandPack,
  platform: EditorPlatform,
): readonly EditorKeyBinding[] {
  if (pack === 'navigation') return navigationBindings(platform)
  if (pack === 'selection') return selectionBindings(platform)
  if (pack === 'find') return findBindings(platform)
  if (pack === 'text-editing') return textEditingBindings(platform)
  if (pack === 'advanced-editing') return advancedEditingBindings(platform)
  if (pack === 'multi-cursor') return multiCursorEditingBindings(platform)
  if (pack === 'folding') return foldingBindings(platform)
  if (pack === 'lsp-navigation') return lspNavigationBindings()
  if (pack === 'lsp-editing') return lspEditingBindings(platform)
  if (pack === 'inline-suggest') return inlineSuggestBindings(platform)
  if (pack === 'suggest') return suggestBindings()

  return []
}

function editorCommandInPacks(
  command: EditorCommandId,
  packs: ReadonlySet<EditorCommandPack>,
): boolean {
  const pack = editorCommandPackForCommand(command)
  if (!pack) return false

  return packs.has(pack)
}

/**
 * The completion list before the signature hint, and both before whatever else owns the key: one
 * Escape closes the list, the next the hint. A command that finds nothing to do declines, so Enter
 * with no item accepted still types a newline.
 */
function suggestBindings(): readonly EditorKeyBinding[] {
  const list = ['suggestWidgetVisible']
  const hints = ['parameterHintsVisible', 'parameterHintsMultipleSignatures']
  return [
    { chord: [key('Space', { ctrl: true })], command: 'editor.action.triggerSuggest' },
    { chord: [key('ArrowDown')], command: 'selectNextSuggestion', when: list },
    { chord: [key('ArrowUp')], command: 'selectPrevSuggestion', when: list },
    { chord: [key('PageDown')], command: 'selectNextPageSuggestion', when: list },
    { chord: [key('PageUp')], command: 'selectPrevPageSuggestion', when: list },
    { chord: [key('Enter')], command: 'acceptSelectedSuggestion', when: list },
    { chord: [key('Tab')], command: 'acceptSelectedSuggestion', when: list },
    // VS Code's alternative acceptance; this list has one way to accept, and Shift+Tab must not
    // outdent the line under an open list.
    { chord: [key('Enter', { shift: true })], command: 'acceptSelectedSuggestion', when: list },
    { chord: [key('Tab', { shift: true })], command: 'acceptSelectedSuggestion', when: list },
    { chord: [key('Escape')], command: 'hideSuggestWidget', when: list },
    { chord: [key('Escape')], command: 'closeParameterHints', when: ['parameterHintsVisible'] },
    { chord: [key('ArrowDown')], command: 'showNextParameterHint', when: hints },
    { chord: [key('ArrowUp')], command: 'showPrevParameterHint', when: hints },
  ]
}

function navigationBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  return horizontalNavigationBindings(platform).concat(verticalNavigationBindings(platform))
}

const key = (keyName: string, modifiers: RawModifiers = {}): RawHotkey => ({
  key: keyName,
  ...modifiers,
})

const WORD_PART_MODIFIER: RawModifiers = { alt: true, ctrl: true }

function textEditingBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  const platformBindings: readonly EditorKeyBinding[] =
    platform === 'mac' ? [] : [{ chord: [key('Y', { ctrl: true })], command: 'redo' }]

  return [
    { chord: [key('Backspace')], command: 'deleteBackward' },
    { chord: [key('Delete')], command: 'deleteForward' },
    { chord: [key('Tab')], command: 'indentSelection' },
    { chord: [key('Tab', { shift: true })], command: 'outdentSelection' },
    ...tabFocusBindings(platform),
    {
      chord: [platform === 'mac' ? key('F', { mod: true, alt: true }) : key('H', { mod: true })],
      command: 'findReplace',
    },
    { chord: [key('Enter', { mod: true, alt: true })], command: 'replaceAll' },
    { chord: [key('Z', { mod: true })], command: 'undo' },
    { chord: [key('Z', { mod: true, shift: true })], command: 'redo' },
    {
      chord: [platform === 'mac' ? key('-', { ctrl: true }) : key('ArrowLeft', { alt: true })],
      command: 'jumpBack',
      preventDefault: true,
    },
    {
      chord: [
        platform === 'mac'
          ? key('-', { ctrl: true, shift: true })
          : key('ArrowRight', { alt: true }),
      ],
      command: 'jumpForward',
      preventDefault: true,
    },
    { chord: [key('U', { mod: true })], command: 'cursorUndo' },
    { chord: [key('U', { mod: true, shift: true })], command: 'cursorRedo' },
    ...platformBindings,
  ]
}

function tabFocusBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  const toggle = platform === 'mac' ? { ctrl: true, shift: true } : { ctrl: true }

  return [{ chord: [key('M', toggle)], command: 'editor.action.toggleTabFocusMode' }]
}

function findBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  return [
    { chord: [key('Escape')], command: 'closeFind' },
    { chord: [key('Escape')], command: 'clearSecondarySelections', when: ['!findVisible'] },
    { chord: [key('F', { mod: true })], command: 'find' },
    { chord: [platform === 'mac' ? key('G', { mod: true }) : key('F3')], command: 'findNext' },
    {
      chord: [
        platform === 'mac' ? key('G', { mod: true, shift: true }) : key('F3', { shift: true }),
      ],
      command: 'findPrevious',
    },
    { chord: [key('C', { alt: true })], command: 'toggleFindCaseSensitive' },
    { chord: [key('W', { alt: true })], command: 'toggleFindWholeWord' },
    { chord: [key('R', { alt: true })], command: 'toggleFindRegex' },
    { chord: [key('L', { alt: true })], command: 'toggleFindInSelection' },
    { chord: [key('P', { alt: true })], command: 'togglePreserveCase' },
  ]
}

function advancedEditingBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  const copyLineModifier =
    platform === 'linux' ? { mod: true, alt: true, shift: true } : { alt: true, shift: true }
  const blockCommentModifier =
    platform === 'linux' ? { mod: true, shift: true } : { alt: true, shift: true }
  const wordDeleteModifier = platform === 'mac' ? { alt: true } : { ctrl: true }
  return [
    { chord: [key('Backspace', wordDeleteModifier)], command: 'deleteWordLeft' },
    { chord: [key('Delete', wordDeleteModifier)], command: 'deleteWordRight' },
    { chord: [key('Backspace', WORD_PART_MODIFIER)], command: 'deleteWordPartLeft' },
    { chord: [key('Delete', WORD_PART_MODIFIER)], command: 'deleteWordPartRight' },
    { chord: [key('K', { mod: true, shift: true })], command: 'editor.action.deleteLines' },
    { chord: [key('ArrowUp', copyLineModifier)], command: 'editor.action.copyLinesUpAction' },
    { chord: [key('ArrowDown', copyLineModifier)], command: 'editor.action.copyLinesDownAction' },
    { chord: [key('ArrowUp', { alt: true })], command: 'editor.action.moveLinesUpAction' },
    { chord: [key('ArrowDown', { alt: true })], command: 'editor.action.moveLinesDownAction' },
    {
      chord: [key('Enter', { mod: true, shift: true })],
      command: 'editor.action.insertLineBefore',
    },
    { chord: [key('Enter', { mod: true })], command: 'editor.action.insertLineAfter' },
    { chord: [key('/', { mod: true })], command: 'editor.action.commentLine' },
    { chord: [key('A', blockCommentModifier)], command: 'editor.action.blockComment' },
    { chord: [key(']', { mod: true })], command: 'editor.action.indentLines' },
    { chord: [key('[', { mod: true })], command: 'editor.action.outdentLines' },
    ...reindentBindings(),
  ]
}

function reindentBindings(): readonly EditorKeyBinding[] {
  return [
    {
      chord: [key('I', { alt: true, shift: true })],
      command: 'editor.action.reindentselectedlines',
    },
    {
      chord: [key('I', { mod: true, alt: true, shift: true })],
      command: 'editor.action.reindentlines',
    },
  ]
}

function multiCursorEditingBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  return [
    { chord: [key('D', { mod: true })], command: 'addNextOccurrence' },
    { chord: [key('Enter', { alt: true })], command: 'selectAllMatches' },
    ...multiCursorBindings(platform),
  ]
}

function lspNavigationBindings(): readonly EditorKeyBinding[] {
  return [{ chord: [key('F12')], command: 'goToDefinition' }]
}

function lspEditingBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  const autoFix = platform === 'mac' ? { mod: true, alt: true } : { alt: true, shift: true }

  return [
    { chord: [key('.', autoFix)], command: 'editor.action.autoFix' },
    { chord: [key('F2')], command: 'editor.action.rename' },
    { chord: [key('F', { alt: true, shift: true })], command: 'editor.action.formatDocument' },
    { chord: [key('F', { mod: true, shift: true })], command: 'editor.action.formatDocument' },
  ]
}

function inlineSuggestBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  if (platform !== 'mac') return []

  return [
    {
      chord: [key('ArrowRight', { mod: true, alt: true })],
      command: 'editor.action.inlineSuggest.acceptNextWord',
    },
  ]
}

function foldingBindings(_platform: EditorPlatform): readonly EditorKeyBinding[] {
  const prefix = key('K', { mod: true })
  const pair = (name: string): KeyChord => [prefix, key(name, { mod: true })]
  return [
    { chord: pair('['), command: 'editor.fold' },
    { chord: pair(']'), command: 'editor.unfold' },
    { chord: [prefix, key('[', { mod: true, shift: true })], command: 'editor.foldRecursively' },
    { chord: [prefix, key(']', { mod: true, shift: true })], command: 'editor.unfoldRecursively' },
    { chord: pair('0'), command: 'editor.foldAll' },
    { chord: pair('J'), command: 'editor.unfoldAll' },
    ...EDITOR_FOLD_LEVELS.map((level): EditorKeyBinding => ({
      chord: pair(String(level)),
      command: `editor.foldLevel${level}`,
    })),
    { chord: pair(','), command: 'editor.createFoldingRangeFromSelection' },
    {
      chord: [prefix, key(',', { mod: true, shift: true })],
      command: 'editor.removeManualFoldingRanges',
    },
  ]
}

function multiCursorBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  if (platform === 'linux') {
    return [
      {
        chord: [key('ArrowUp', { alt: true, shift: true })],
        command: 'editor.action.insertCursorAbove',
      },
      {
        chord: [key('ArrowDown', { alt: true, shift: true })],
        command: 'editor.action.insertCursorBelow',
      },
      {
        chord: [key('ArrowUp', { mod: true, shift: true })],
        command: 'editor.action.insertCursorAbove',
      },
      {
        chord: [key('ArrowDown', { mod: true, shift: true })],
        command: 'editor.action.insertCursorBelow',
      },
      { chord: [key('L', { mod: true, shift: true })], command: 'editor.action.selectHighlights' },
      { chord: [key('F2', { mod: true })], command: 'editor.action.changeAll' },
    ]
  }

  return [
    {
      chord: [key('ArrowUp', { mod: true, alt: true })],
      command: 'editor.action.insertCursorAbove',
    },
    {
      chord: [key('ArrowDown', { mod: true, alt: true })],
      command: 'editor.action.insertCursorBelow',
    },
    { chord: [key('L', { mod: true, shift: true })], command: 'editor.action.selectHighlights' },
    { chord: [key('F2', { mod: true })], command: 'editor.action.changeAll' },
  ]
}

function horizontalNavigationBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  return [
    { chord: [key('ArrowLeft')], command: 'cursorLeft' },
    { chord: [key('ArrowRight')], command: 'cursorRight' },
    ...wordNavigationBindings(platform),
    ...lineBoundaryBindings(platform),
  ]
}

function verticalNavigationBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  return [
    { chord: [key('ArrowUp')], command: 'cursorUp' },
    { chord: [key('ArrowDown')], command: 'cursorDown' },
    { chord: [key('PageUp')], command: 'cursorPageUp' },
    { chord: [key('PageDown')], command: 'cursorPageDown' },
    ...documentBoundaryBindings(platform),
  ]
}

function selectionBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  return [
    { chord: [key('A', { mod: true })], command: 'selectAll' },
    ...smartSelectBindings(platform),
    ...horizontalSelectionBindings(platform),
    ...verticalSelectionBindings(platform),
    ...columnSelectionBindings(platform),
  ]
}

function columnSelectionBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  const box = { mod: true, alt: true, shift: true }
  const horizontal = (arrow: string): KeyChord =>
    platform === 'mac' ? [key(arrow, box)] : [key('K', { mod: true }), key(arrow, { alt: true })]
  const vertical = platform === 'linux' ? { mod: true } : box

  return [
    {
      chord: horizontal('ArrowLeft'),
      command: 'cursorColumnSelectLeft',
    },
    {
      chord: horizontal('ArrowRight'),
      command: 'cursorColumnSelectRight',
    },
    { chord: [key('ArrowUp', vertical)], command: 'cursorColumnSelectUp' },
    { chord: [key('ArrowDown', vertical)], command: 'cursorColumnSelectDown' },
    { chord: [key('PageUp', box)], command: 'cursorColumnSelectPageUp' },
    { chord: [key('PageDown', box)], command: 'cursorColumnSelectPageDown' },
  ]
}

function smartSelectBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  // Alt+Shift is the free pair everywhere except mac, where alt is already the word modifier and
  // taking it would shadow word selection.
  const modifier =
    platform === 'mac' ? { mod: true, ctrl: true, shift: true } : { alt: true, shift: true }

  return [
    { chord: [key('ArrowRight', modifier)], command: 'editor.action.smartSelect.expand' },
    { chord: [key('ArrowLeft', modifier)], command: 'editor.action.smartSelect.shrink' },
  ]
}

function horizontalSelectionBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  return [
    { chord: [key('ArrowLeft', { shift: true })], command: 'selectLeft' },
    { chord: [key('ArrowRight', { shift: true })], command: 'selectRight' },
    ...wordSelectionBindings(platform),
    ...lineBoundarySelectionBindings(platform),
  ]
}

function verticalSelectionBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  return [
    { chord: [key('ArrowUp', { shift: true })], command: 'selectUp' },
    { chord: [key('ArrowDown', { shift: true })], command: 'selectDown' },
    { chord: [key('PageUp', { shift: true })], command: 'selectPageUp' },
    { chord: [key('PageDown', { shift: true })], command: 'selectPageDown' },
    ...documentBoundarySelectionBindings(platform),
  ]
}

function wordNavigationBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  const modifier = platform === 'mac' ? { alt: true } : { ctrl: true }
  return [
    { chord: [key('ArrowLeft', modifier)], command: 'cursorWordLeft' },
    { chord: [key('ArrowRight', modifier)], command: 'cursorWordRight' },
    { chord: [key('ArrowLeft', WORD_PART_MODIFIER)], command: 'cursorWordPartLeft' },
    { chord: [key('ArrowRight', WORD_PART_MODIFIER)], command: 'cursorWordPartRight' },
  ]
}

function wordSelectionBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  const modifier = platform === 'mac' ? { alt: true } : { ctrl: true }
  return [
    { chord: [key('ArrowLeft', { ...modifier, shift: true })], command: 'selectWordLeft' },
    { chord: [key('ArrowRight', { ...modifier, shift: true })], command: 'selectWordRight' },
    {
      chord: [key('ArrowLeft', { ...WORD_PART_MODIFIER, shift: true })],
      command: 'cursorWordPartLeftSelect',
    },
    {
      chord: [key('ArrowRight', { ...WORD_PART_MODIFIER, shift: true })],
      command: 'cursorWordPartRightSelect',
    },
  ]
}

function lineBoundaryBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  const macBindings: readonly EditorKeyBinding[] =
    platform === 'mac'
      ? [
          { chord: [key('ArrowLeft', { meta: true })], command: 'cursorLineStart' },
          { chord: [key('ArrowRight', { meta: true })], command: 'cursorLineEnd' },
        ]
      : []

  return [
    { chord: [key('Home')], command: 'cursorLineStart' },
    { chord: [key('End')], command: 'cursorLineEnd' },
    ...macBindings,
  ]
}

function lineBoundarySelectionBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  const macBindings: readonly EditorKeyBinding[] =
    platform === 'mac'
      ? [
          { chord: [key('ArrowLeft', { meta: true, shift: true })], command: 'selectLineStart' },
          { chord: [key('ArrowRight', { meta: true, shift: true })], command: 'selectLineEnd' },
        ]
      : []

  return [
    { chord: [key('Home', { shift: true })], command: 'selectLineStart' },
    { chord: [key('End', { shift: true })], command: 'selectLineEnd' },
    ...macBindings,
  ]
}

function documentBoundaryBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  if (platform === 'mac') {
    return [
      { chord: [key('ArrowUp', { meta: true })], command: 'cursorDocumentStart' },
      { chord: [key('ArrowDown', { meta: true })], command: 'cursorDocumentEnd' },
    ]
  }

  return [
    { chord: [key('Home', { ctrl: true })], command: 'cursorDocumentStart' },
    { chord: [key('End', { ctrl: true })], command: 'cursorDocumentEnd' },
  ]
}

function documentBoundarySelectionBindings(platform: EditorPlatform): readonly EditorKeyBinding[] {
  if (platform === 'mac') {
    return [
      { chord: [key('ArrowUp', { meta: true, shift: true })], command: 'selectDocumentStart' },
      { chord: [key('ArrowDown', { meta: true, shift: true })], command: 'selectDocumentEnd' },
    ]
  }

  return [
    { chord: [key('Home', { ctrl: true, shift: true })], command: 'selectDocumentStart' },
    { chord: [key('End', { ctrl: true, shift: true })], command: 'selectDocumentEnd' },
  ]
}

function withEditorConditions(binding: EditorKeyBinding): EditorKeyBinding {
  const when: EditorKeyCondition[] = [...(binding.when ?? [])]
  if (editorCommandMutates(binding.command)) when.push('writable')
  if (binding.command === 'indentSelection' || binding.command === 'outdentSelection')
    when.push('!tabFocusMode')
  if (
    binding.command === 'closeFind' ||
    binding.command.startsWith('toggleFind') ||
    binding.command === 'togglePreserveCase'
  )
    when.push('findVisible')
  if (binding.command.startsWith('editor.action.inlineSuggest.'))
    when.push('inlineSuggestionVisible')
  if (binding.command === 'editor.createFoldingRangeFromSelection') when.push('hasSelection')
  return when.length ? { ...binding, when } : binding
}
export function presetEditorKeymapLayers(
  preset: 'default' | 'vscode',
  platform: EditorPlatform = detectPlatform(),
): readonly EditorKeymapLayer[] {
  if (preset === 'default') return defaultEditorKeymapLayers(platform)
  return editorKeymapLayersForBindings(
    vscodeEditorKeyBindings(platform),
    defaultEditorCommandPacks,
    { idPrefix: 'vscode', source: 'core' },
  )
}
export function vscodeEditorKeyBindings(
  platform: EditorPlatform = detectPlatform(),
): readonly EditorKeyBinding[] {
  const bracket = platform === 'mac' ? { mod: true, alt: true } : { mod: true, shift: true }
  const prefix = key('K', { mod: true })
  const overrides: readonly EditorKeyBinding[] = [
    { chord: [key('[', bracket)], command: 'editor.fold' },
    { chord: [key(']', bracket)], command: 'editor.unfold' },
    { chord: [prefix, key('[', { mod: true })], command: 'editor.foldRecursively' },
    { chord: [prefix, key(']', { mod: true })], command: 'editor.unfoldRecursively' },
    { chord: [prefix, key('.', { mod: true })], command: 'editor.removeManualFoldingRanges' },
    { chord: [prefix, key('I', { mod: true })], command: 'editor.action.showHover' },
    { chord: [prefix, key('C', { mod: true })], command: 'editor.action.commentLine' },
    { chord: [key('F12', { shift: true })], command: 'editor.action.goToReferences' },
    { chord: [key('F12', { alt: true })], command: 'editor.action.peekDefinition' },
    { chord: [key('F12', { mod: true })], command: 'editor.action.goToImplementation' },
    { chord: [prefix, key('F12')], command: 'editor.action.revealDefinitionAside' },
    { chord: [key('F', { alt: true, shift: true })], command: 'editor.action.formatDocument' },
    { chord: [key('F8')], command: 'editor.action.marker.next' },
    { chord: [key('F8', { shift: true })], command: 'editor.action.marker.prev' },
    { chord: [key('\\', { mod: true, shift: true })], command: 'editor.action.jumpToBracket' },
    { chord: [key('Z', { alt: true })], command: 'editor.action.toggleWordWrap' },
    { chord: [prefix, key('X', { mod: true })], command: 'editor.action.trimTrailingWhitespace' },
    { chord: [key('Tab')], command: 'editor.action.inlineSuggest.commit', when: ['!tabFocusMode'] },
  ]
  const replaced = new Set(overrides.map((binding) => binding.command))
  // The line-comment single stroke remains an alias of its chord.
  replaced.delete('editor.action.commentLine')
  const defaults = defaultEditorKeyBindings(platform).filter(
    (binding) => !replaced.has(binding.command),
  )
  // The suggest pack outranks the overrides as it outranks every default layer.
  const suggests = (binding: EditorKeyBinding) =>
    editorCommandPackForCommand(binding.command) === 'suggest'
  return [
    ...defaults.filter(suggests),
    ...overrides.map(withEditorConditions),
    ...defaults.filter((binding) => !suggests(binding)),
  ]
}
