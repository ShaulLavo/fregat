import { afterEach, expect, test } from 'vitest'
import { createBrowserDispatcher } from '../../src'
import type { BrowserDispatcher } from '../../src'

let dispatcher: BrowserDispatcher | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  document.body.replaceChildren()
})

function key(target: Element, value: string, isComposing = false) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    code: value,
    isComposing,
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  target.dispatchEvent(event)
  return event
}

test('idle capture resolves a command before a descendant consumes the key', () => {
  const composer = document.createElement('div')
  document.body.append(composer)
  const calls: string[] = []
  composer.addEventListener('keydown', (event) => {
    calls.push('native')
    event.preventDefault()
    event.stopPropagation()
  })
  dispatcher = createBrowserDispatcher({
    capture: true,
    platform: 'linux',
    keymap: [{ keys: 'Enter', command: 'submit', context: 'Composer' }],
  })
  dispatcher.attachElement(
    dispatcher.createNode({
      context: 'Composer',
      commands: { submit: () => void calls.push('submit') },
    }),
    composer,
  )
  const event = key(composer, 'Enter')
  expect(event.defaultPrevented).toBe(true)
  expect(dispatcher.claimKeybinding(event)).toBe(true)
  expect(calls).toEqual(['submit'])
  dispatcher.dispose()
  key(composer, 'Enter')
  expect(calls).toEqual(['submit', 'native'])
})

test('idle capture leaves declined commands, navigation and composition with native input', () => {
  const composer = document.createElement('div')
  document.body.append(composer)
  const calls: string[] = []
  const native: string[] = []
  composer.addEventListener('keydown', (event) => {
    expect(event.defaultPrevented).toBe(false)
    native.push(event.key)
    event.preventDefault()
    event.stopPropagation()
  })
  dispatcher = createBrowserDispatcher({
    capture: true,
    platform: 'linux',
    keymap: [{ keys: 'Enter', command: 'submit', context: 'Composer' }],
  })
  dispatcher.attachElement(
    dispatcher.createNode({
      context: 'Composer',
      commands: {
        submit: () => {
          calls.push('declined')
          return false
        },
      },
    }),
    composer,
  )
  const declined = key(composer, 'Enter')
  expect(dispatcher.claimKeybinding(declined)).toBe(false)
  const navigation = key(composer, 'ArrowLeft')
  expect(dispatcher.claimKeybinding(navigation)).toBe(false)
  const composition = key(composer, 'Enter', true)
  expect(dispatcher.claimKeybinding(composition)).toBe(false)
  expect(calls).toEqual(['declined'])
  expect(native).toEqual(['Enter', 'ArrowLeft', 'Enter'])
})

test('the default idle listener preserves bubbling input ownership', () => {
  const composer = document.createElement('div')
  document.body.append(composer)
  const calls: string[] = []
  composer.addEventListener('keydown', (event) => {
    calls.push('native')
    event.preventDefault()
    event.stopPropagation()
  })
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'Enter', command: 'submit', context: 'Composer' }],
  })
  dispatcher.attachElement(
    dispatcher.createNode({
      context: 'Composer',
      commands: { submit: () => void calls.push('submit') },
    }),
    composer,
  )
  key(composer, 'Enter')
  expect(calls).toEqual(['native'])
})
