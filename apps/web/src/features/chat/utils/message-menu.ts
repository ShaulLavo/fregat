import {
  ArrowCounterClockwiseIcon,
  CopyIcon,
  GitDiffIcon,
  MarkdownLogoIcon,
} from '@phosphor-icons/react'

import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'

/**
 * Streamdown puts its own copy and download buttons on code and mermaid
 * blocks. Right-clicking inside one should leave that affordance — and the
 * browser's own menu over the code text — alone rather than replace it with
 * the message menu.
 */
const STREAMDOWN_OWN_MENU_SELECTOR =
  '[data-streamdown="code-block"],[data-streamdown="mermaid-block"]'

export function allowsMessageContextMenu(target: EventTarget | null) {
  if (typeof Element === 'undefined') return true
  if (!(target instanceof Element)) return true

  return target.closest(STREAMDOWN_OWN_MENU_SELECTOR) === null
}

export type ChatMessageMenuContext = {
  /** True only for a user message that has a checkpoint recorded after it. */
  readonly canRevertCheckpoint: boolean
  /** True only for an assistant message whose turn produced a readable diff. */
  readonly canViewChangedFiles: boolean
  readonly copyMarkdown: () => void
  readonly copyText: () => void
  readonly hasText: boolean
  /** User text is never rendered as markdown, so it has no markdown to copy. */
  readonly isAssistant: boolean
  readonly revertPending: boolean
  readonly revertToCheckpoint: () => void
  readonly viewChangedFiles: () => void
}

export function chatMessageMenu(context: ChatMessageMenuContext): Menu {
  return [
    section('copy', [
      actionItem({
        disabled: !context.hasText,
        icon: CopyIcon,
        id: 'copy',
        label: 'Copy',
        run: context.copyText,
      }),
      context.isAssistant &&
        actionItem({
          disabled: !context.hasText,
          icon: MarkdownLogoIcon,
          id: 'copyMarkdown',
          label: 'Copy as Markdown',
          run: context.copyMarkdown,
        }),
    ]),
    // Both items are omitted rather than disabled when they do not apply: the
    // two live on opposite message roles, so a disabled twin would only ever
    // advertise an action this message can never perform.
    section('checkpoint', [
      context.canViewChangedFiles &&
        actionItem({
          icon: GitDiffIcon,
          id: 'viewChangedFiles',
          label: 'View Changed Files',
          run: context.viewChangedFiles,
        }),
      // Last in its section like every other destructive item, even though the
      // two never appear together — they live on opposite message roles.
      context.canRevertCheckpoint &&
        actionItem({
          destructive: true,
          disabled: context.revertPending,
          icon: ArrowCounterClockwiseIcon,
          id: 'revertCheckpoint',
          label: 'Revert to Checkpoint Before This',
          run: context.revertToCheckpoint,
        }),
    ]),
  ]
}
