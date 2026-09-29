import { afterEach, expect, it, vi } from 'vitest'
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

it('keeps typing and paste usable with an oversized visible line', async () => {
  const service = new SpellcheckService()
  services.push(service)
  const { editor, feature } = mountEditor([createSpellcheckPlugin({ service })])
  editor.setText('before ' + 'a'.repeat(20_000))
  editor.setSelection(0)
  editor.focus()
  const checks = vi.spyOn(service, 'check')
  await commands.proofPaste('a.@/'.repeat(5_000))
  await commands.proofType('hello ')
  expect(editor.materializeFullText()).toBe(
    'a.@/'.repeat(5_000) + 'hello before ' + 'a'.repeat(20_000),
  )
  expect(checks).not.toHaveBeenCalled()
  expect(feature().issueAt(0)).toBeNull()

  editor.setText('the list befor ')
  editor.setSelection(15)
  await until(() => feature().issueAt(10) !== null)
})

it('stops retrying a failed worker while real keyboard input remains usable', async () => {
  const factory = vi.fn(() => {
    throw new Error('worker setup failed')
  })
  const service = new SpellcheckService({ workerFactory: factory })
  services.push(service)
  const { editor, feature } = mountEditor([createSpellcheckPlugin({ service })])
  expect(() => editor.setText('the list befor ')).not.toThrow()
  await until(() => factory.mock.calls.length === 1)
  await Promise.resolve()
  editor.setSelection(15)
  editor.focus()
  await commands.proofType('hello ')
  expect(editor.materializeFullText()).toBe('the list befor hello ')
  expect(factory).toHaveBeenCalledOnce()
  expect(feature().issueAt(10)).toBeNull()
})
