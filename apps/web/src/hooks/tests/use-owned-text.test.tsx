import { act, renderHook } from '@testing-library/react'

import { useOwnedText } from '@/hooks/use-owned-text'
import { expect, test } from '../../../test/fixtures'

function render(initial: string) {
  const commits: string[] = []
  const hook = renderHook((external: string) => useOwnedText(external, (v) => commits.push(v)), {
    initialProps: initial,
  })
  return { ...hook, commits, text: () => hook.result.current[0], change: hook.result.current[1] }
}

test('typing advances the field synchronously and the owner catching up leaves it alone', () => {
  const { change, commits, rerender, text } = render('')
  act(() => change('a'))
  act(() => change('ab'))
  expect(text()).toBe('ab')
  expect(commits).toEqual(['a', 'ab'])
  rerender('a')
  expect(text()).toBe('ab')
  rerender('ab')
  expect(text()).toBe('ab')
})

test('an owner value that was never typed replaces the field', () => {
  const { change, rerender, text } = render('')
  act(() => change('ab'))
  rerender('history entry')
  expect(text()).toBe('history entry')
  rerender('')
  expect(text()).toBe('')
})

test('a stale intermediate is forgotten once a newer commit has landed', () => {
  const { change, rerender, text } = render('')
  act(() => change('a'))
  act(() => change('ab'))
  rerender('ab')
  rerender('a')
  expect(text()).toBe('a')
})
