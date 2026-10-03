import {
  createKeyContext,
  parseKeyContext,
  type BrowserDispatcher,
  type CommandHandler,
  type FocusNode,
  type FocusNodeContext,
} from '@fregat/hotkeys'

type NodeRegistration = {
  readonly parent: () => FocusNode<KeyboardEvent>
  readonly element: () => Element | null
  readonly context: () => FocusNodeContext
  readonly commands: Readonly<Record<string, CommandHandler<KeyboardEvent>>>
}
type Group = {
  readonly node: FocusNode<KeyboardEvent>
  readonly registrations: Set<NodeRegistration>
  readonly detach: () => void
}
type Attached = {
  readonly element: Element
  readonly parent: FocusNode<KeyboardEvent>
  readonly group: Group
  readonly detachHandlers: readonly (() => void)[]
}

export function createKeymapNodeRegistry(hotkeys: BrowserDispatcher) {
  const groups = new Map<Element, Map<FocusNode<KeyboardEvent>, Group>>()
  const registrations = new Map<NodeRegistration, Attached | null>()
  function attach(
    registration: NodeRegistration,
    element: Element,
    parent: FocusNode<KeyboardEvent>,
  ) {
    const parents = groups.get(element) ?? new Map<FocusNode<KeyboardEvent>, Group>()
    groups.set(element, parents)
    let group = parents.get(parent)
    if (!group) {
      const readers = new Set<NodeRegistration>()
      const node = hotkeys.createNode({ parent, readContext: () => combinedContext(readers) })
      group = { node, registrations: readers, detach: hotkeys.attachElement(node, element) }
      parents.set(parent, group)
    }
    group.registrations.add(registration)
    const node = group.node
    const detachHandlers = Object.entries(registration.commands).map(([id, handler]) =>
      node.handle(id, handler),
    )
    return { element, parent, group, detachHandlers }
  }
  function detach(registration: NodeRegistration, attached: Attached) {
    attached.detachHandlers.forEach((remove) => remove())
    attached.group.registrations.delete(registration)
    if (attached.group.registrations.size) return
    attached.group.detach()
    attached.group.node.remove()
    const parents = groups.get(attached.element)
    parents?.delete(attached.parent)
    if (!parents?.size) groups.delete(attached.element)
  }
  function sync() {
    for (const [registration, previous] of registrations) {
      const element = registration.element()
      const parent = registration.parent()
      if (previous?.element === element && previous.parent === parent) continue
      if (previous) detach(registration, previous)
      registrations.set(registration, element ? attach(registration, element, parent) : null)
    }
  }
  return {
    register(registration: NodeRegistration) {
      registrations.set(registration, null)
      sync()
      return () => {
        const attached = registrations.get(registration)
        if (attached) detach(registration, attached)
        registrations.delete(registration)
      }
    },
    sync,
    dispose() {
      for (const [registration, attached] of registrations)
        if (attached) detach(registration, attached)
      registrations.clear()
    },
  }
}

function combinedContext(registrations: ReadonlySet<NodeRegistration>) {
  const identifiers: string[] = []
  const values = new Map<string, string>()
  for (const registration of registrations) {
    const source = registration.context()
    const context = typeof source === 'string' ? parseKeyContext(source) : createKeyContext(source)
    identifiers.push(...context.identifiers)
    for (const [key, value] of context.values) values.set(key, value)
  }
  return createKeyContext({ identifiers, values })
}
