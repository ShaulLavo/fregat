import { afterEach, expect, test, vi } from 'vitest'
import { MachinePrompts } from '../prompts'

afterEach(() => vi.useRealTimers())

test('a queued prompt receives its full timeout when it becomes visible', async () => {
  vi.useFakeTimers()
  const prompts = new MachinePrompts(() => {})
  const first = prompts.request('tab-one', {
    name: 'first',
    kind: 'secret',
    prompt: 'First password:',
  })
  const second = prompts.request('tab-one', {
    name: 'second',
    kind: 'secret',
    prompt: 'Second password:',
  })
  await vi.advanceTimersByTimeAsync(119_000)
  prompts.respond('tab-one', 'first', prompts.current('tab-one')!.id, 'first answer')
  expect(await first).toBe('first answer')
  await vi.advanceTimersByTimeAsync(119_000)
  expect(prompts.current('tab-one')?.name).toBe('second')
  prompts.respond('tab-one', 'second', prompts.current('tab-one')!.id, 'second answer')
  expect(await second).toBe('second answer')
  prompts.close()
})

test('a departing tab transfers its prompt to another owner and loses permission to answer', async () => {
  const prompts = new MachinePrompts(() => {})
  const answer = prompts.request('tab-one', {
    name: 'fixture',
    kind: 'secret',
    prompt: 'Password:',
  })
  const id = prompts.current('tab-one')!.id
  prompts.reassign('fixture', 'tab-one', 'tab-two')
  expect(prompts.current('tab-one')).toBeNull()
  expect(prompts.current('tab-two')?.id).toBe(id)
  expect(() => prompts.respond('tab-one', 'fixture', id, 'stale')).toThrow()
  prompts.respond('tab-two', 'fixture', id, 'accepted')
  expect(await answer).toBe('accepted')
  prompts.close()
})

test('canceling one machine preserves other queued prompts and close cancels the rest', async () => {
  const prompts = new MachinePrompts(() => {})
  const cancelled = prompts.request('tab-one', { name: 'first', kind: 'secret', prompt: 'First:' })
  const retained = prompts.request('tab-one', { name: 'second', kind: 'secret', prompt: 'Second:' })
  prompts.cancelMachine('first')
  expect(await cancelled).toBeNull()
  expect(prompts.current('tab-one')?.name).toBe('second')
  prompts.close()
  expect(await retained).toBeNull()
  expect(
    await prompts.request('tab-one', { name: 'third', kind: 'secret', prompt: 'Third:' }),
  ).toBeNull()
})
