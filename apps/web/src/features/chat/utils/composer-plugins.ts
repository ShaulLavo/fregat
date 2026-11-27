import type { EditorPlugin } from '@singapore-editor/core/extensions'
import type { EditorTheme, InlineReplacementSpec } from '@singapore-editor/core/rendering'
import { activeComposerMention, collectComposerMentions } from '@workspace/contracts'

import { ultrathinkMatch } from '@/features/chat/utils/effort-tier'
import { basename } from '@/lib/path-formatters'

type ComposerMentionToken = ReturnType<typeof collectComposerMentions>[number]

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Matches the 11 prose surround pairs from `input-logic.ts` while auto-close stays disabled. */
export const COMPOSER_SURROUND_PAIRS = [
  { open: '"', close: '"' },
  { open: "'", close: "'" },
  { open: '(', close: ')' },
  { open: '*', close: '*' },
  { open: '<', close: '>' },
  { open: '[', close: ']' },
  { open: '_', close: '_' },
  { open: '`', close: '`' },
  { open: '{', close: '}' },
  { open: '«', close: '»' },
  { open: '“', close: '”' },
] as const

export const COMPOSER_EDITOR_THEME: EditorTheme = {
  backgroundColor: 'transparent',
  caretColor: 'var(--foreground)',
  foregroundColor: 'var(--foreground)',
  gutterBackgroundColor: 'transparent',
  gutterForegroundColor: 'transparent',
  inactiveSelectionColor: 'var(--editor-inactive-selection)',
  popupBackgroundColor: 'var(--popover-solid)',
  selectionColor: 'color-mix(in oklch, var(--info) 35%, transparent)',
}

function createFileCodeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('viewBox', '0 0 256 256')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('class', 'size-(--icon-size-sm) shrink-0 self-center')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute(
    'd',
    'M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z',
  )
  svg.append(path)
  return svg
}

function renderMentionChip(tokenPath: string) {
  return (container: HTMLElement) => {
    const chip = document.createElement('span')
    chip.className =
      'bg-muted text-foreground inline-flex max-w-full items-baseline gap-1 rounded-md px-1 align-baseline font-mono text-xs leading-tight select-none'
    chip.contentEditable = 'false'
    chip.dataset.chatInputMention = tokenPath
    chip.spellcheck = false
    chip.title = tokenPath
    const label = document.createElement('span')
    label.className = 'overflow-hidden text-ellipsis whitespace-nowrap'
    label.title = tokenPath
    label.textContent = basename(tokenPath)
    chip.append(createFileCodeSvg(), label)
    container.replaceChildren(chip)
    return {
      dispose() {
        container.replaceChildren()
      },
    }
  }
}

function mentionSpecForToken(token: ComposerMentionToken): InlineReplacementSpec {
  return {
    atomic: true,
    endIndex: token.end,
    id: `mention:${token.start}:${token.end}`,
    key: `mention:${token.path}:${token.start}`,
    kind: 'mention',
    render: renderMentionChip(token.path),
    reveal: 'never',
    startIndex: token.start,
    text: basename(token.path),
  }
}

function isCompletedChip(
  token: ComposerMentionToken,
  previousChips: readonly ComposerMentionToken[],
) {
  return previousChips.some(
    (chip) => chip.start === token.start && chip.end === token.end && chip.source === token.source,
  )
}

function selectMentionChips({
  activeStart,
  previousChips,
  textUnchanged,
  tokens,
}: {
  readonly activeStart: number | null
  readonly previousChips: readonly ComposerMentionToken[]
  readonly textUnchanged: boolean
  readonly tokens: readonly ComposerMentionToken[]
}) {
  return tokens.filter((token) => {
    if (isCompletedChip(token, previousChips)) return true
    if (textUnchanged) return false
    return token.start !== activeStart
  })
}

/**
 * Renders every completed `@path` / `@"path with spaces"` mention as an atomic inline chip
 * (`reveal: 'never'`, `atomic: true`) while leaving an active bare `@query` at the caret editable.
 */
export function createChatInputMentionPlugin(getActiveCursor?: () => number | null): EditorPlugin {
  return {
    name: 'fregat.chat-input-mentions',
    activate(context) {
      let previousText = ''
      let previousChips: readonly ComposerMentionToken[] = []
      return context.registerInlineReplacementProvider(
        ({ textSnapshot }) => {
          const text = textSnapshot.readRange(0, textSnapshot.length)
          const tokens = collectComposerMentions(text)
          if (tokens.length === 0) {
            previousText = text
            previousChips = []
            return []
          }
          const cursor = getActiveCursor?.() ?? null
          const activeStart =
            cursor === null ? null : (activeComposerMention(text, cursor)?.start ?? null)
          const chips = selectMentionChips({
            activeStart,
            previousChips,
            textUnchanged: text === previousText,
            tokens,
          })
          previousText = text
          previousChips = chips
          return chips.map(mentionSpecForToken)
        },
        { trigger: 'edit' },
      )
    },
  }
}

/**
 * Paints the first whole-word "ultrathink" with the live rainbow gradient while preserving
 * editable text underneath (`reveal: 'never'`, `atomic: false`).
 */
export function createChatInputUltrathinkPlugin(): EditorPlugin {
  return {
    name: 'fregat.chat-input-ultrathink',
    activate(context) {
      return context.registerInlineReplacementProvider(
        ({ textSnapshot }) => {
          const text = textSnapshot.readRange(0, textSnapshot.length)
          const match = ultrathinkMatch(text)
          if (!match) return []
          const word = text.slice(match.start, match.end)
          return [
            {
              atomic: false,
              className: 'rainbow-text rainbow-live',
              endIndex: match.end,
              id: `ultrathink:${match.start}:${match.end}`,
              key: `ultrathink:${match.start}`,
              kind: 'ultrathink',
              reveal: 'never',
              startIndex: match.start,
              text: word,
              wrap: 'text',
            },
          ]
        },
        { trigger: 'edit' },
      )
    },
  }
}
