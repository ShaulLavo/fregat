import {
  createKeyContext,
  parseContextPredicate,
  predicateDepth,
  type ContextPredicate,
  type KeyContext,
} from '@fregat/hotkeys'
import { isBindableChord, normalizedChord } from '@workspace/client-core/commands/chord'
import { expect, test } from '../../../test/fixtures'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import { zed } from '@/keymap/presets/inventory'
import oursFregat from '@/keymap/presets/ours-fregat.json'
import patches from '@/keymap/presets/ours-patches.json'
import vscodeApp from '@/keymap/presets/vscode-app.json'
import type { PlatformKeyBinding } from '@/keymap/types'

const platforms = ['linux', 'mac', 'windows'] as const
type Platform = (typeof platforms)[number]

test.each(platforms)('every application command has a default key on %s', (platform) => {
  const bound = new Set<string | null>(
    defaultPlatformKeyBindings(platform, 'ours').map(({ command }) => command),
  )
  const commands = vscodeApp.flatMap((row) =>
    row.platforms && !row.platforms.includes(platform) ? [] : [row.command],
  )
  expect(commands.filter((command) => !bound.has(command))).toEqual([])
})

test('every key move names an application row and a reason', () => {
  for (const entry of oursFregat) {
    const rows = vscodeApp.filter((row) => row.command === entry.command && row.keys === entry.keys)
    expect(rows.length, `${entry.command} ${entry.keys}`).toBeGreaterThan(0)
    expect(entry.reason.length).toBeGreaterThan(0)
  }
})

test.each(platforms)('no default application key shadows a Zed key on %s', (platform) => {
  const collisions = addedBindings(platform).flatMap((binding) =>
    zedCollisions(binding, platform).map(
      (row) =>
        `${binding.keys} ${binding.command} [${binding.context}] ↔ ${row.upstreamCommand} [${row.context}]`,
    ),
  )
  expect(collisions).toEqual([])
})

test('the collision check sees Zed keys in nested contexts', () => {
  const binding = (keys: string, context: string) =>
    ({ keys: normalizedChord(keys, 'linux'), context }) as PlatformKeyBinding
  expect(zedCollisions(binding('Mod+Backspace', 'Sidebar > Git'), 'linux')).not.toEqual([])
  expect(zedCollisions(binding('Mod+Alt+N', 'Workspace'), 'linux')).not.toEqual([])
  expect(zedCollisions(binding('Mod+Alt+N', 'Workspace && !FileTree'), 'linux')).toEqual([])
  expect(zedCollisions(binding('Mod+.', 'Problems'), 'linux')).toEqual([])
})

/** `ours` rows that the Zed preset lacks, minus the recorded Zed-row patches. */
function addedBindings(platform: Platform): readonly PlatformKeyBinding[] {
  const identity = (binding: PlatformKeyBinding) =>
    `${binding.keys}\n${binding.command}\n${binding.context}`
  const zedKeys = new Set(defaultPlatformKeyBindings(platform, 'zed').map(identity))
  const patched = new Set(
    patches.map(({ identity: row, fields }) =>
      [normalizedChord(row.keys, platform), fields.command, fields.context].join('\n'),
    ),
  )
  return defaultPlatformKeyBindings(platform, 'ours').filter(
    (binding) => !zedKeys.has(identity(binding)) && !patched.has(identity(binding)),
  )
}

function zedCollisions(binding: PlatformKeyBinding, platform: Platform) {
  const source = platform === 'mac' ? 'mac' : 'linux'
  return zed.filter(
    (row) =>
      row.platform === source &&
      row.context !== null &&
      isBindableChord(row.keys) &&
      normalizedChord(row.keys, platform) === binding.keys &&
      contextsOverlap(binding.context ?? 'Workspace', row.context),
  )
}

/**
 * Two predicates overlap when some focus stack activates both at any depth. Candidate stacks
 * are the smallest stacks under Workspace that satisfy either predicate's positive terms.
 */
function contextsOverlap(left: string, right: string): boolean {
  const a = parseContextPredicate(left)
  const b = parseContextPredicate(right)
  return stacks(a)
    .concat(stacks(b))
    .some((stack) => predicateDepth(a, stack) !== null && predicateDepth(b, stack) !== null)
}

type Frame = {
  readonly identifiers: readonly string[]
  readonly values: readonly [string, string][]
}

function stacks(predicate: ContextPredicate): readonly KeyContext[][] {
  return witnesses(predicate).map((frames) =>
    [createKeyContext({ identifiers: ['Workspace'] })].concat(
      frames.map((frame) => createKeyContext(frame)),
    ),
  )
}

function witnesses(predicate: ContextPredicate): readonly (readonly Frame[])[] {
  switch (predicate.kind) {
    case 'identifier':
      return [[{ identifiers: [predicate.name], values: [] }]]
    case 'equal':
      return [[{ identifiers: [], values: [[predicate.key, predicate.value]] }]]
    case 'not-equal':
    case 'not':
      return [[{ identifiers: [], values: [] }]]
    case 'or':
      return witnesses(predicate.left).concat(witnesses(predicate.right))
    case 'descendant':
      return witnesses(predicate.parent).flatMap((parent) =>
        witnesses(predicate.child).map((child) => parent.concat(child)),
      )
    case 'and':
      return witnesses(predicate.left).flatMap((left) =>
        witnesses(predicate.right).map((right) => mergeInnermost(left, right)),
      )
  }
}

function mergeInnermost(left: readonly Frame[], right: readonly Frame[]): readonly Frame[] {
  const [long, short] = left.length >= right.length ? [left, right] : [right, left]
  const inner = long.at(-1)!
  const other = short.at(-1)!
  return long.slice(0, -1).concat([
    {
      identifiers: inner.identifiers.concat(other.identifiers),
      values: inner.values.concat(other.values),
    },
  ])
}
