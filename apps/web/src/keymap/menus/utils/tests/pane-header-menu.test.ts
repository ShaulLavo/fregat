import type { PaneHost, PaneHostView } from '@/providers/pane-host-context'
import type { MenuRadioGroupItem } from '@/keymap/menus/utils/model'
import { paneHeaderMenu } from '@/keymap/menus/utils/pane-header-menu'
import { expect, test } from '../../../../../test/fixtures'

function recordingHost(calls: string[]): PaneHost {
  const views = (['terminal', 'problems'] as const).map((value): PaneHostView<typeof value> => ({
    label: value,
    value,
    select: () => calls.push(`select ${value}`),
    toggle: () => calls.push(`toggle ${value}`),
  }))
  return {
    activeView: 'problems',
    hide: () => calls.push('hide'),
    kind: 'workbench-bottom',
    views,
    visible: true,
  }
}

function viewGroup(host: PaneHost): MenuRadioGroupItem {
  const item = paneHeaderMenu(host, 'Problems').find((entry) => entry.id === 'view')?.items[0]
  if (!item || item.kind !== 'radio-group') return expect.unreachable('expected a view group')
  return item
}

test('lists the host views and checks the active one', () => {
  const group = viewGroup(recordingHost([]))

  expect(group.options.map((option) => option.value)).toEqual(['terminal', 'problems'])
  expect(group.value).toBe('problems')
})

test('choosing a view selects it on the host', () => {
  const calls: string[] = []
  viewGroup(recordingHost(calls)).select?.('terminal')

  expect(calls).toEqual(['select terminal'])
})

test('a value the host does not list selects nothing', () => {
  const calls: string[] = []
  viewGroup(recordingHost(calls)).select?.('files')

  expect(calls).toEqual([])
})

test('every host offers Hide, named after the pane', () => {
  const calls: string[] = []
  const hide = paneHeaderMenu(recordingHost(calls), 'Problems').find((entry) => entry.id === 'pane')
    ?.items[0]
  if (!hide || hide.kind !== 'action') return expect.unreachable('expected a hide action')

  expect(hide.label).toBe('Hide Problems')
  hide.run()
  expect(calls).toEqual(['hide'])
})

test('outside every host there is no menu', () => {
  expect(paneHeaderMenu(null, 'Settings')).toEqual([])
})
