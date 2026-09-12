import { binding } from '../../../../../test/factories/key-binding'
import { actionItem, commandItem, section } from '@/keymap/menus/utils/model'
import { resolveMenu, type MenuResolveContext } from '@/keymap/menus/utils/resolve'
import type { PlatformCommandId } from '@/keymap/types'
import { expect, test } from '../../../../../test/fixtures'

test('fills label and shortcut for a command item from the registry', () => {
  const [group] = resolveMenu([section('save', [commandItem('workspace.saveFile')])], context())
  const [item] = group.items

  expect(item.kind).toBe('run')
  expect(item).toMatchObject({ key: 'workspace.saveFile', label: 'Save' })
  expect(item.kind === 'run' && item.trailing).toContain('S')
})

test('an explicit label overrides the registry title', () => {
  const menu = [section('close', [commandItem('workspace.closeCurrentTab', { label: 'Close' })])]
  const [group] = resolveMenu(menu, context())

  expect(group.items[0]).toMatchObject({ label: 'Close' })
})

test('dispatching a command item routes through the registry dispatch', () => {
  const dispatched: PlatformCommandId[] = []
  const menu = [section('save', [commandItem('workspace.saveFile')])]
  const [group] = resolveMenu(
    menu,
    context({
      dispatch: (id) => {
        dispatched.push(id)
      },
    }),
  )

  const item = group.items[0]
  expect(item.kind).toBe('run')
  if (item.kind !== 'run') return
  expect(item.run()?.claimed).toBe(true)

  expect(dispatched).toEqual(['workspace.saveFile'])
})

test('a command the registry reports unavailable resolves disabled with its exact reason', () => {
  const menu = [section('save', [commandItem('workspace.saveFile')])]
  const [group] = resolveMenu(menu, context({ disabled: true }))

  expect(group.items[0]).toMatchObject({
    disabled: true,
    trailing: 'Command is unavailable.',
  })
})

test('a command-backed radio option inspects and dispatches through the same context', () => {
  const dispatched: PlatformCommandId[] = []
  const menu = [
    section('theme', [
      {
        id: 'theme',
        kind: 'radio-group' as const,
        options: [
          {
            command: 'workspace.setDarkTheme' as const,
            label: 'Dark',
            value: 'workspace.setDarkTheme',
          },
        ],
        value: 'workspace.setLightTheme',
      },
    ]),
  ]
  const [group] = resolveMenu(
    menu,
    context({
      dispatch: (id) => {
        dispatched.push(id)
      },
    }),
  )
  const item = group.items[0]
  expect(item.kind).toBe('radio-group')
  if (item.kind !== 'radio-group') return

  expect(item.select('workspace.setDarkTheme')?.claimed).toBe(true)
  expect(dispatched).toEqual(['workspace.setDarkTheme'])
})

test('an unavailable item is disabled and states why in the trailing slot', () => {
  const menu = [
    section('split', [
      actionItem({ id: 'splitRight', label: 'Split Right', run: noop, unavailable: 'soon' }),
    ]),
  ]
  const [group] = resolveMenu(menu, context())

  expect(group.items[0]).toMatchObject({ disabled: true, label: 'Split Right', trailing: 'soon' })
})

test('a local action return value is not mistaken for a command ticket', () => {
  const accidentalTicket = handledTicket()
  const menu = [
    section('local', [
      actionItem({ id: 'local', label: 'Local action', run: () => accidentalTicket }),
    ]),
  ]
  const item = resolveMenu(menu, context())[0].items[0]

  expect(item.kind).toBe('run')
  if (item.kind !== 'run') return
  expect(item.run()).toBeUndefined()
})

test('drops sections that filter down to nothing so no separator is left behind', () => {
  const menu = [
    section('open', [actionItem({ id: 'open', label: 'Open', run: noop })]),
    section('git', [false, null]),
    section('copy', [actionItem({ id: 'copy', label: 'Copy Path', run: noop })]),
  ]

  expect(resolveMenu(menu, context()).map((group) => group.id)).toEqual(['open', 'copy'])
})

test('resolves submenu sections recursively', () => {
  const menu = [
    section('root', [
      {
        id: 'more',
        kind: 'submenu' as const,
        label: 'More',
        sections: [section('inner', [commandItem('workspace.saveFile')]), section('empty', [null])],
      },
    ]),
  ]
  const item = resolveMenu(menu, context())[0].items[0]

  expect(item.kind).toBe('submenu')
  if (item.kind !== 'submenu') return
  expect(item.sections.map((group) => group.id)).toEqual(['inner'])
  expect(item.sections[0].items[0]).toMatchObject({ label: 'Save' })
})

function noop() {}

function context(
  overrides: {
    readonly dispatch?: (command: PlatformCommandId) => void
    readonly disabled?: boolean
  } = {},
): MenuResolveContext {
  return {
    bindings: [binding('Mod+S', { command: 'workspace.saveFile' })],
    dispatch: (command) => {
      overrides.dispatch?.(command)
      return handledTicket()
    },
    inspect: () =>
      overrides.disabled
        ? { reason: 'Command is unavailable.', status: 'disabled' }
        : { status: 'ready' },
  }
}

function handledTicket() {
  return {
    claimed: true,
    completion: Promise.resolve({ status: 'handled' as const }),
  }
}
