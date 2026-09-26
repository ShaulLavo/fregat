import { afterEach, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { createSpellcheckPlugin } from '../src/plugin'
import { SpellcheckService } from '../src/service'
import { disposeEditors, mountEditor, rowPixels, spellingInk, until } from './browserEditor'

const services: SpellcheckService[] = []
afterEach(() => {
  disposeEditors()
  for (const service of services.splice(0)) service.dispose()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

it('marks no word while it is being typed, and marks it once the caret leaves it', async () => {
  const service = new SpellcheckService()
  services.push(service)
  const { host, editor, feature } = mountEditor([createSpellcheckPlugin({ service })])
  editor.setText('the list ')
  editor.focus()
  editor.setSelection(9)
  expect(await service.check(['warm'])).toEqual([])

  for (const character of 'befor') {
    await commands.proofType(character)
    await settle()
    expect(spellingInk(await rowPixels(host.id))).toBe(0)
  }
  expect(editor.materializeFullText()).toBe('the list befor')

  await commands.proofType(' ')
  await until(() => feature().issueAt(10) !== null)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  expect(feature().issueAt(10)).toEqual({ start: 9, end: 14, word: 'befor' })
  expect(spellingInk(await rowPixels(host.id))).toBeGreaterThan(20)
})
