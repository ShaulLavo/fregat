import {
  createBrowserDispatcher,
  detectPlatform,
  parseHotkey,
  type BrowserDispatcher,
  type CompiledBinding,
  type FocusNode,
  type PendingChordLabel,
} from '@fregat/hotkeys'
import type { PlatformCommandBus } from '@/keymap/providers/command-context'
import type { CommandInvocation } from '@/keymap/state/command-bus'
import { createKeymapNodeRegistry } from '@/keymap/state/node-registry'
import { nodeCommandIds } from '@/keymap/node-commands'
import { CHORD_TIMEOUT_MS } from '@workspace/client-core/commands/chord'
import { editorPlatformCommandId } from '@/keymap/editor-keymap'
import { platformCommand, platformCommands } from '@/keymap/table'
import type { PlatformKeyBinding } from '@/keymap/types'
import { eventTargetsTextEntry } from '@/keymap/utils/keyboard-event'
import type { FocusArea, FocusService } from '@/lib/focus/state/service'
import type { FocusTargetToken } from '@/lib/focus/state/service'

export type WindowKeymap = {
  readonly hotkeys: BrowserDispatcher
  readonly parentFor: (area: FocusArea) => FocusNode<KeyboardEvent>
  readonly registerNode: ReturnType<typeof createKeymapNodeRegistry>['register']
  readonly dispatchCommand: (command: string, invocation: CommandInvocation) => boolean
  readonly updateBindings: (bindings: readonly PlatformKeyBinding[]) => void
  readonly dispose: () => void
}

export function createWindowKeymap(options: {
  readonly bindings: readonly PlatformKeyBinding[]
  readonly bus: Pick<PlatformCommandBus, 'capture'>
  readonly focus: FocusService
  readonly onPendingChange: (pending: PendingChordLabel | null) => void
}): WindowKeymap {
  let bindings = options.bindings
  let captured: ReturnType<PlatformCommandBus['capture']> | null = null
  let detachOwner: (() => void) | undefined
  let owner = options.focus.getSnapshot().currentOwner?.token ?? null
  const platform = detectPlatform()
  const hotkeys = createBrowserDispatcher({
    keymap: bindings.map(({ entry }) => entry),
    platform,
    timeoutMs: CHORD_TIMEOUT_MS,
    capture: true,
    beforeKey(event) {
      if (event.type !== 'keydown') return
      captured = options.bus.capture({ event, source: { kind: 'keybinding' } })
      nodeRegistry.sync()
      attachOwner()
    },
    isAvailable,
    onPendingChange: options.onPendingChange,
  })
  const nodeRegistry = createKeymapNodeRegistry(hotkeys)
  const workspace = hotkeys.createNode({
    readContext: () => {
      const snapshot = captured?.inspect('workspace.toggleWallpaper').snapshot
      const identifiers = ['Workspace']
      if (snapshot) {
        for (const [name, value] of Object.entries(snapshot))
          if (value === true) identifiers.push(name)
        if (snapshot.activeTabId) identifiers.push('tabOpen')
        if (snapshot.activeDocumentSavable) identifiers.push('saveableTab')
      }
      return { identifiers }
    },
  })
  const sidebar = hotkeys.createNode({ parent: workspace, context: 'Sidebar' })
  const parents: Readonly<Record<FocusArea, FocusNode<KeyboardEvent>>> = {
    global: workspace,
    editor: workspace,
    terminal: workspace,
    chat: hotkeys.createNode({ parent: workspace, context: 'Chat' }),
    settings: hotkeys.createNode({ parent: workspace, context: 'Settings' }),
    'command-palette': hotkeys.createNode({ parent: workspace, context: 'CommandPalette' }),
    dialog: hotkeys.createNode({ parent: workspace, context: 'Dialog' }),
    'file-tree': hotkeys.createNode({ parent: sidebar, context: 'FileTree' }),
    git: hotkeys.createNode({ parent: sidebar, context: 'Git' }),
    search: hotkeys.createNode({ parent: sidebar, context: 'Search' }),
    logs: hotkeys.createNode({ parent: workspace, context: 'Logs' }),
    problems: hotkeys.createNode({ parent: workspace, context: 'Problems' }),
  }
  const detachRoot = hotkeys.attachElement(workspace, document.documentElement)
  for (const command of platformCommands) {
    workspace.handle(command.id, ({ source }) => {
      if (nodeCommandIds.has(command.id)) return false
      const invocation =
        captured ?? options.bus.capture({ event: source, source: { kind: 'keybinding' } })
      return invocation.dispatch(command.id).claimed
    })
  }
  function attachOwner() {
    detachOwner?.()
    detachOwner = undefined
    const current = options.focus.getSnapshot().currentOwner
    if (!current || current.capabilities.editor || current.area === 'terminal') return
    const target = options.focus.getTarget(current.token)
    if (!target) return
    const node = parents[current.area]
    detachOwner = hotkeys.attachElement(node, target.element)
  }
  function isAvailable(binding: CompiledBinding, event: KeyboardEvent) {
    const physical = /^(?:Key|Digit)(.)$/u.exec(event.code)?.[1]
    if (
      event.getModifierState('AltGraph') &&
      Array.from(event.key).length === 1 &&
      physical?.toLowerCase() !== event.key.toLowerCase()
    )
      return false
    if (
      event
        .composedPath()
        .some(
          (target) => target instanceof Element && target.hasAttribute('data-keybinding-recorder'),
        )
    )
      return false
    const configured = bindings[binding.index]
    const raw = binding.command
    if (raw === null) return true
    const catalog = platformCommand(raw) ?? platformCommand(editorPlatformCommandId(raw))
    const invocation = captured ?? options.bus.capture({ event, source: { kind: 'keybinding' } })
    const editorTarget = invocation.inspect('editor.selectAll').target
    const input = editorTarget?.kind === 'editor' ? editorTarget.inputElement : null
    const stack = hotkeys.contextStack()
    const editorWidget = stack.some((context) => context.identifiers.has('EditorWidget'))
    const textEntry = eventTargetsTextEntry(event, input)
    if (catalog?.target === 'editor' && textEntry && !editorWidget) return false
    if (
      textEntry &&
      !(catalog?.target === 'editor' && editorWidget) &&
      !firesWhileTyping(configured, platform)
    )
      return false
    if (!catalog || nodeCommandIds.has(catalog.id)) return true
    return invocation.inspect(catalog.id).status === 'ready'
  }
  const unsubscribe = options.focus.subscribe(() => {
    const next = options.focus.getSnapshot().currentOwner?.token ?? null
    if (next !== owner) hotkeys.cancel()
    owner = next
    nodeRegistry.sync()
    attachOwner()
  })
  attachOwner()
  return {
    hotkeys,
    parentFor: (area) => parents[area],
    registerNode: nodeRegistry.register,
    dispatchCommand(command, invocation) {
      nodeRegistry.sync()
      const snapshot = options.focus.getSnapshot()
      const origin = invocation.origin as FocusTargetToken | null | undefined
      const originTarget = origin ? options.focus.getTarget(origin) : null
      if (origin && !originTarget) return false
      const event = invocation.event instanceof Event ? invocation.event : null
      const target =
        originTarget?.element ??
        event?.composedPath().find((entry): entry is Element => entry instanceof Element) ??
        (snapshot.lastCommandTarget
          ? options.focus.getTarget(snapshot.lastCommandTarget.token)?.element
          : null) ??
        document.activeElement
      if (!target) return false
      const node = hotkeys.nodeForElement(target)
      if (!node) return false
      const previousCapture = captured
      captured = options.bus.capture(invocation)
      try {
        return hotkeys.dispatchCommandFrom(node, command)
      } finally {
        captured = previousCapture
      }
    },
    updateBindings(next) {
      if (next === bindings) return
      bindings = next
      hotkeys.setKeymap(next.map(({ entry }) => entry))
    },
    dispose() {
      unsubscribe()
      detachOwner?.()
      detachRoot()
      nodeRegistry.dispose()
      hotkeys.dispose()
    },
  }
}

function firesWhileTyping(
  binding: PlatformKeyBinding | undefined,
  platform: ReturnType<typeof detectPlatform>,
): boolean {
  if (!binding) return false
  if (binding.firesWhileTyping !== undefined) return binding.firesWhileTyping
  const stroke = parseHotkey(binding.keys.split(' ')[0]!, platform)
  if (
    !stroke.ctrl &&
    !stroke.meta &&
    !stroke.alt &&
    !stroke.shift &&
    /^F(?:[1-9]|1[0-2])$/.test(stroke.key ?? '')
  )
    return true
  return !binding.yieldsToTextEntry && (stroke.ctrl || stroke.meta || stroke.key === 'Escape')
}
