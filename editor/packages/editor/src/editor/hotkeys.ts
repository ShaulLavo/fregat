import {
  createBrowserDispatcher,
  detectPlatform,
  type BrowserDispatcher,
  type CommandHandler,
  type FocusNode,
  type KeyContextInit,
} from '@fregat/hotkeys'
import type { EditorAnyCommandId } from './commandCatalog'
import type { EditorCommandContext } from './commands'
import { editorKeymapBindings, type EditorKeymapOptions } from '../keymap/presets'

export type EditorKeymapContext = Readonly<Record<string, boolean>> & {
  readonly writable: boolean
  readonly hasSelection: boolean
  readonly tabFocusMode: boolean
  readonly inlineSuggestionVisible: boolean
}

export type EditorKeymapMetadata = {
  readonly mode?: 'full' | 'single_line' | 'diff'
  readonly extension?: string
}

export type EditorHotkeysHost = {
  readonly dispatcher: BrowserDispatcher
  readonly node: FocusNode<KeyboardEvent>
}

export type EditorKeymapNodeOptions = {
  readonly element: Element
  readonly context: string | (() => KeyContextInit)
  readonly commands: Readonly<Record<string, CommandHandler<KeyboardEvent>>>
}

export class EditorHotkeys {
  readonly host: EditorHotkeysHost
  private readonly ownDispatcher: boolean
  private readonly detach: () => void
  private readonly handlers = new Map<EditorAnyCommandId, () => void>()
  private signature = ''

  constructor(
    private readonly options: {
      readonly target: HTMLElement
      readonly hotkeys?: BrowserDispatcher
      readonly parent?: FocusNode<KeyboardEvent>
      readonly keymap?: EditorKeymapOptions
      readonly readContext: () => KeyContextInit
      readonly commands: readonly EditorAnyCommandId[]
      readonly dispatch: (command: EditorAnyCommandId, context: EditorCommandContext) => boolean
    },
  ) {
    const dispatcher =
      options.hotkeys ?? createBrowserDispatcher({ root: options.target.ownerDocument })
    this.ownDispatcher = !options.hotkeys
    const node = dispatcher.createNode({ parent: options.parent, readContext: options.readContext })
    this.host = { dispatcher, node }
    this.detach = dispatcher.attachElement(node, options.target)
    this.updateCommands(options.commands)
    this.setKeymap(options.keymap)
  }

  updateCommands(commands: readonly EditorAnyCommandId[]): void {
    const live = new Set(commands)
    for (const [command, remove] of this.handlers) {
      if (live.has(command)) continue
      remove()
      this.handlers.delete(command)
    }
    for (const command of commands) {
      if (this.handlers.has(command)) continue
      this.handlers.set(
        command,
        this.host.node.handle(command, ({ source }) =>
          this.options.dispatch(command, source ? { event: source } : {}),
        ),
      )
    }
  }

  setKeymap(options: EditorKeymapOptions | undefined): boolean {
    const signature = JSON.stringify(options ?? null)
    if (signature === this.signature) return false
    this.signature = signature
    if (this.ownDispatcher)
      this.host.dispatcher.setKeymap(editorKeymapBindings(options, detectPlatform()))
    return true
  }

  registerNode(options: EditorKeymapNodeOptions): { dispose: () => void } {
    const node = this.host.dispatcher.createNode({
      parent: this.host.node,
      ...(typeof options.context === 'string'
        ? { context: options.context }
        : { readContext: options.context }),
      commands: options.commands,
    })
    const detach = this.host.dispatcher.attachElement(node, options.element)
    return {
      dispose: () => {
        detach()
        node.remove()
      },
    }
  }

  dispose(): void {
    this.detach()
    this.host.node.remove()
    for (const remove of this.handlers.values()) remove()
    this.handlers.clear()
    if (this.ownDispatcher) this.host.dispatcher.dispose()
  }
}

/** Gives an independently mounted Editor widget its base bindings and an Editor parent. */
export function createEditorWidgetKeymap(element: HTMLElement) {
  const hotkeys = new EditorHotkeys({
    target: element,
    readContext: () => ({ identifiers: ['Editor'] }),
    commands: [],
    keymap: { packs: [] },
    dispatch: () => false,
  })
  return {
    registerKeymapNode: (options: EditorKeymapNodeOptions) => hotkeys.registerNode(options),
    dispose: () => hotkeys.dispose(),
  }
}
