import { afterEach, expect, it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { createTooltipController } from '../src/tooltip'

declare module 'vitest/browser' {
  interface BrowserCommands {
    noteActionKey(key: string): Promise<void>
  }
}
let dispose: () => void = () => undefined

afterEach(() => {
  dispose()
  document.body.replaceChildren()
})

it('activates the correct note through Enter, Space and the pointer while retaining the hover', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:800px;height:600px'
  document.body.append(host)
  const tooltip = createTooltipController({
    document,
    themeSource: host,
    reentryElement: host,
    classNamespace: 'actions',
  })
  dispose = () => tooltip.dispose()
  const activated: string[] = []
  tooltip.show({
    anchor: new DOMRect(100, 100, 30, 20),
    theme: null,
    hoverText: null,
    parts: [
      {
        notes: [
          {
            text: 'First warning',
            actions: [
              {
                label: 'Inspect',
                run: () => {
                  activated.push('first')
                },
              },
            ],
          },
          {
            text: 'Second error',
            actions: [
              {
                label: 'Inspect',
                run: () => {
                  activated.push('second')
                },
              },
            ],
          },
        ],
      },
    ],
  })
  const first = page
    .getByRole('document', { name: 'First warning' })
    .getByRole('button', { name: 'Inspect', exact: true })
  const second = page
    .getByRole('document', { name: 'Second error' })
    .getByRole('button', { name: 'Inspect', exact: true })
  ;(second.element() as HTMLButtonElement).focus()
  await commands.noteActionKey('Enter')
  expect(activated).toEqual(['second'])
  ;(first.element() as HTMLButtonElement).focus()
  await commands.noteActionKey('Space')
  expect(activated).toEqual(['second', 'first'])
  await second.click()
  expect(activated).toEqual(['second', 'first', 'second'])
  await expect.element(first).toBeVisible()
})

it('retains keyboard focus during pending work and returns Escape to the editor', async () => {
  const host = document.createElement('button')
  host.textContent = 'Editor focus target'
  document.body.append(host)
  const tooltip = createTooltipController({
    document,
    themeSource: host,
    reentryElement: host,
    classNamespace: 'actions',
    onRequestEditorFocus: () => host.focus(),
  })
  dispose = () => tooltip.dispose()
  const notes = [
    {
      text: 'Warning',
      actions: [{ label: 'Inspect', run: () => new Promise<void>(() => undefined) }],
    },
  ]
  const options = {
    anchor: new DOMRect(100, 100, 30, 20),
    theme: null,
    hoverText: null,
    parts: [{ notes }],
  }
  tooltip.show({ ...options, focus: true })
  const action = page.getByRole('button', { name: 'Inspect', exact: true })
  ;(action.element() as HTMLButtonElement).focus()
  await commands.noteActionKey('Enter')
  expect(document.activeElement).toBe(action.element())
  tooltip.show({ ...options, parts: [{ notes }, { markdown: 'semantic hover' }] })
  expect(document.activeElement).toBe(action.element())
  await commands.noteActionKey('Escape')
  expect(document.activeElement).toBe(host)
})
