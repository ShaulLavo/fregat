import type { EditorPasteHandler, EditorPasteTarget } from '@singapore-editor/core/extensions'
import { collectComposerMentions, serializeComposerMention } from '@workspace/contracts'

import { composerDropMentionPath } from '@/features/chat/utils/composer-drop'
import { pastedTextFolds } from '@/features/chat/utils/pasted-text'

export type ComposerPasteActions = {
  readonly rootPath: () => string
  readonly documentText: () => string
  /** Starts attaching files; the paste itself inserts nothing. */
  readonly attachFiles: (files: readonly File[]) => void
  /** Starts folding a large paste into an attachment. */
  readonly foldText: (text: string) => void
  /** Whether the paste-as-text chord asked for this paste inline; reading it clears it. */
  readonly takeInlineRequest: () => boolean
}

/**
 * Reads what lands in the composer: files become attachments, a dragged tree row becomes a mention,
 * a large paste folds into a file, and a pasted mention gets the blanks that let it become a chip.
 * Anything else takes the editor's plain-text path.
 */
export function createComposerPasteHandler(actions: ComposerPasteActions): EditorPasteHandler {
  return {
    mimeTypes: ['Files', 'text/plain'],
    handlePaste: (context) => {
      if (context.files.length > 0) {
        actions.attachFiles(context.files)
        return context.targets.map(() => '')
      }
      if (context.source === 'drop') {
        const path = composerDropMentionPath(context.dataTransfer, actions.rootPath())
        if (!path) return null

        return completeChipBoundaries(
          context.targets,
          `${serializeComposerMention(path)} `,
          actions,
        )
      }
      if (pastedTextFolds(context.text, actions.takeInlineRequest())) {
        actions.foldText(context.text)
        return context.targets.map(() => '')
      }
      if (collectComposerMentions(context.text).length === 0) return null

      return completeChipBoundaries(context.targets, context.text, actions)
    },
  }
}

function completeChipBoundaries(
  targets: readonly EditorPasteTarget[],
  text: string,
  actions: ComposerPasteActions,
) {
  const document = actions.documentText()
  const mentions = collectComposerMentions(text)
  const leads = mentions[0]?.start === 0
  const trails = mentions.at(-1)?.end === text.length

  return targets.map((target) => {
    const before = leads && touchesText(document[target.start - 1]) ? ' ' : ''
    const after = trails && !isBlank(document[target.end]) ? ' ' : ''
    return `${before}${text}${after}`
  })
}

/** A mention glued to the word before it is not a mention at all. */
function touchesText(character: string | undefined) {
  return character !== undefined && !isBlank(character)
}

function isBlank(character: string | undefined) {
  return character !== undefined && /\s/.test(character)
}
