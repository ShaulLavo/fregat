import { serializeComposerMention } from '@workspace/contracts'
import {
  $applyNodeReplacement,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import type { ReactElement } from 'react'

import { ChatInputUltrathinkNode } from '@/features/chat/utils/ultrathink-node'

import { ChatInputMentionChip } from './chat-input-mention-chip'

type SerializedChatInputMentionNode = Spread<
  {
    path: string
    type: 'chat-input-mention'
    version: 1
  },
  SerializedLexicalNode
>

/**
 * A mention is one atomic thing to the person writing the prompt, so it is a
 * node rather than styled text: the caret steps over it and one backspace
 * removes all of it. Its text content is the grammar's serialization, so the
 * prompt the editor reports — for the draft, the trigger and submit — is
 * exactly the text this chip was built from.
 */
export class ChatInputMentionNode extends DecoratorNode<ReactElement> {
  __path: string

  static override getType() {
    return 'chat-input-mention'
  }

  static override clone(node: ChatInputMentionNode) {
    return new ChatInputMentionNode(node.__path, node.__key)
  }

  static override importJSON(serialized: SerializedChatInputMentionNode) {
    return $createChatInputMentionNode(serialized.path).updateFromJSON(serialized)
  }

  constructor(path: string, key?: NodeKey) {
    super(key)
    this.__path = path
  }

  override exportJSON(): SerializedChatInputMentionNode {
    return {
      ...super.exportJSON(),
      path: this.__path,
      type: 'chat-input-mention',
      version: 1,
    }
  }

  override createDOM() {
    const dom = document.createElement('span')
    dom.className = 'inline-flex align-[-0.125em] leading-none'

    return dom
  }

  override updateDOM(): false {
    return false
  }

  override getTextContent() {
    return serializeComposerMention(this.__path)
  }

  override isInline(): true {
    return true
  }

  override decorate() {
    return <ChatInputMentionChip path={this.__path} />
  }
}

export function $createChatInputMentionNode(path: string) {
  return $applyNodeReplacement(new ChatInputMentionNode(path))
}

export function $isChatInputMentionNode(
  node: LexicalNode | null | undefined,
): node is ChatInputMentionNode {
  return node instanceof ChatInputMentionNode
}

/** Every node the chat composer's editor has to be configured with. */
export const CHAT_INPUT_EDITOR_NODES = [ChatInputMentionNode, ChatInputUltrathinkNode]
