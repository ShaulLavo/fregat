import { afterEach, expect, it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { createTooltipController } from '../src/tooltip'
import { Editor } from '@singapore-editor/core/editor'

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

function comparisonHover() {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:52px;top:180px;width:656px;height:420px'
  document.body.append(host)
  const editor = new Editor(host, { defaultText: 'const value = 0;', theme: { type: 'dark' } })
  const tooltip = createTooltipController({
    document,
    themeSource: host.querySelector<HTMLElement>('.editor')!,
    reentryElement: host,
    classNamespace: 'actions',
  })
  dispose = () => {
    tooltip.dispose()
    editor.dispose()
  }
  const part = {
    presentation: 'controls' as const,
    markdown:
      '### Base\n\n```\nconst value = 0;\n```\n\n### Theirs\n\n```\nconst value = 2;\n```\n\n### Yours\n\n```\nconst value = 1;\n```',
    notes: [{ text: 'Review edits by Alice and Bob.' }],
    actions: ['Keep both', 'Keep yours', 'Keep theirs', 'Jump to edit'].map((label) => ({
      label,
      run() {},
    })),
  }
  tooltip.show({
    anchor: new DOMRect(64, 200, 40, 17),
    theme: null,
    hoverText: null,
    parts: [part],
  })
  return document.querySelector<HTMLElement>('[role="dialog"]')!
}

it('places a controls hover beside the unit with a surface margin', () => {
  const hover = comparisonHover()
  const bounds = hover.getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(52)
  expect(bounds.top).toBeGreaterThanOrEqual(217)
  expect(bounds.right).toBeLessThanOrEqual(innerWidth - 12)
})

it('keeps all controls visible in a compact footer without scrolling', () => {
  const hover = comparisonHover()
  const body = hover.querySelector<HTMLElement>('.editor-actions-hover-body')!
  const actions = [...hover.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.textContent?.startsWith('Keep') || button.textContent === 'Jump to edit',
  )
  expect(actions).toHaveLength(4)
  expect(body.querySelectorAll('.editor-actions-hover-action')).toHaveLength(0)
  expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight)
  const bounds = hover.getBoundingClientRect()
  for (const button of actions) {
    const rect = button.getBoundingClientRect()
    expect(rect.top).toBeGreaterThanOrEqual(bounds.top)
    expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom)
    expect(rect.right).toBeLessThanOrEqual(bounds.right)
    expect(rect.bottom).toBeLessThanOrEqual(innerHeight - 12)
  }
})

it('keeps comparison content tone-only when the host outlines keyboard focus', async () => {
  const style = document.createElement('style')
  style.textContent = ':focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }'
  document.body.append(style)
  const hover = comparisonHover()
  const content = hover.querySelector<HTMLElement>('[role="document"]')!
  await commands.noteActionKey('Tab')
  content.focus()
  expect(content.matches(':focus-visible')).toBe(true)
  expect(getComputedStyle(content).outlineStyle).toBe('none')
  for (const region of hover.querySelectorAll<HTMLElement>('[role="document"]'))
    expect(getComputedStyle(region).borderTopStyle).toBe('none')
  const button = [...hover.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent === 'Keep both',
  )!
  button.focus()
  expect(getComputedStyle(button).outlineStyle).toBe('solid')
})

it('presents hover controls as buttons with keyboard focus and press states', async () => {
  const hover = comparisonHover()
  const button = [...hover.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent === 'Keep both',
  )!
  expect(getComputedStyle(button).textDecorationLine).toBe('none')
  expect(getComputedStyle(button).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  await commands.noteActionKey('Tab')
  button.focus()
  expect(document.activeElement).toBe(button)
  expect(getComputedStyle(button).outlineStyle).toBe('solid')
})
