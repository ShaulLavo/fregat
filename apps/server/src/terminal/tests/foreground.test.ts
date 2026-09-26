import { expect, it } from 'vitest'
import { shellRunsCommand, type ProcessEntry } from '../foreground'

const SHELL = 100

function table(...children: readonly (readonly [number, number, string])[]) {
  const entries: ProcessEntry[] = [
    { pid: SHELL, parent: 1, command: 'zsh' },
    ...children.map(([pid, parent, command]) => ({ pid, parent, command })),
  ]
  return new Map(entries.map((entry) => [entry.pid, entry]))
}

it('counts a shell with no children as idle', () => {
  expect(shellRunsCommand(table(), SHELL)).toBe(false)
})

it('counts a background job as a command', () => {
  // `npm run dev &`: the shell holds the foreground, the job is still its child.
  expect(shellRunsCommand(table([200, SHELL, 'node']), SHELL)).toBe(true)
})

it('counts a suspended job as a command', () => {
  // Ctrl-Z on vim leaves a stopped child and the shell back at its prompt.
  expect(shellRunsCommand(table([201, SHELL, 'vim']), SHELL)).toBe(true)
})

it('ignores the forked copy of the shell an async prompt leaves waiting', () => {
  expect(shellRunsCommand(table([202, SHELL, 'zsh']), SHELL)).toBe(false)
})

it('counts a forked shell that runs something as a command', () => {
  expect(shellRunsCommand(table([203, SHELL, 'zsh'], [204, 203, 'make']), SHELL)).toBe(true)
})
