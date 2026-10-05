import {
  createBrowserDispatcher,
  createKeyContext,
  parseKeyContext,
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

type EditorKeymapGroup = {
  readonly node: FocusNode<KeyboardEvent>
  readonly contexts: Set<() => KeyContextInit>
  readonly detach: () => void
}

export class EditorHotkeys {
  readonly host: EditorHotkeysHost
  private readonly ownDispatcher: boolean
  private readonly detach: () => void
  private readonly handlers = new Map<EditorAnyCommandId, () => void>()
  private readonly groups = new Map<Element, EditorKeymapGroup>()
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
    const source = options.context
    const context = typeof source === 'string' ? parseKeyContext(source) : source
    const readContext = () => (typeof context === 'function' ? context() : context)
    let group = this.groups.get(options.element)
    if (!group) {
      const contexts = new Set<() => KeyContextInit>()
      const node = this.host.dispatcher.createNode({
        parent: this.host.node,
        readContext: () => combinedEditorKeymapContext(contexts),
      })
      group = {
        node,
        contexts,
        detach: this.host.dispatcher.attachElement(node, options.element),
      }
      this.groups.set(options.element, group)
    }
    group.contexts.add(readContext)
    const owned = group
    const removeHandlers = Object.entries(options.commands).map(([command, handler]) =>
      owned.node.handle(command, handler),
    )
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        for (const remove of removeHandlers) remove()
        owned.contexts.delete(readContext)
        if (owned.contexts.size) return
        owned.detach()
        owned.node.remove()
        if (this.groups.get(options.element) === owned) this.groups.delete(options.element)
      },
    }
  }

  dispose(): void {
    for (const group of this.groups.values()) {
      group.detach()
      group.node.remove()
    }
    this.groups.clear()
    this.detach()
    this.host.node.remove()
    for (const remove of this.handlers.values()) remove()
    this.handlers.clear()
    if (this.ownDispatcher) this.host.dispatcher.dispose()
  }
}

function combinedEditorKeymapContext(readers: ReadonlySet<() => KeyContextInit>): KeyContextInit {
  const contexts = Array.from(readers, (read) => createKeyContext(read()))
  return {
    identifiers: contexts.flatMap((context) => [...context.identifiers]),
    values: new Map(contexts.flatMap((context) => [...context.values])),
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
