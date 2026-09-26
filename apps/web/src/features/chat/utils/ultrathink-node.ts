import { registerLexicalTextEntity } from '@lexical/text'
import {
  $applyNodeReplacement,
  $getRoot,
  mergeRegister,
  TextNode,
  type EditorConfig,
  type LexicalEditor,
  type SerializedTextNode,
} from 'lexical'

import { ultrathinkMatch } from '@/features/chat/utils/effort-tier'

/**
 * The word "ultrathink" as its own text node, so it is a real span that can wear the
 * picker's rainbow; a Highlight can only colour whole letters. Its text is unchanged,
 * so the prompt the editor reports is the same.
 */
export class ChatInputUltrathinkNode extends TextNode {
  static override getType() {
    return 'chat-input-ultrathink'
  }

  static override clone(node: ChatInputUltrathinkNode) {
    return new ChatInputUltrathinkNode(node.__text, node.__key)
  }

  static override importJSON(serialized: SerializedTextNode) {
    return $createChatInputUltrathinkNode(serialized.text).updateFromJSON(serialized)
  }

  override createDOM(config: EditorConfig) {
    const dom = super.createDOM(config)
    dom.classList.add('rainbow-text', 'rainbow-live')

    return dom
  }

  // Typing against the word starts a new node, and the entity transform decides again.
  override canInsertTextBefore() {
    return false
  }

  override canInsertTextAfter() {
    return false
  }

  override isTextEntity(): true {
    return true
  }
}

export function $createChatInputUltrathinkNode(text: string) {
  return $applyNodeReplacement(new ChatInputUltrathinkNode(text))
}

/** Turns every whole-word "ultrathink" into the node; with `enabled` off, painted ones revert. */
export function registerUltrathinkEntity(editor: LexicalEditor, enabled: boolean) {
  const unregister = mergeRegister(
    ...registerLexicalTextEntity(
      editor,
      (text) => (enabled ? ultrathinkMatch(text) : null),
      ChatInputUltrathinkNode,
      (node) => $createChatInputUltrathinkNode(node.getTextContent()),
    ),
  )
  // Transforms run on dirty nodes only, so a model switch re-reads the text already there.
  editor.update(
    () => {
      if (!ultrathinkMatch($getRoot().getTextContent())) return
      for (const node of $getRoot().getAllTextNodes()) node.markDirty()
    },
    { tag: 'history-merge' },
  )

  return unregister
}
