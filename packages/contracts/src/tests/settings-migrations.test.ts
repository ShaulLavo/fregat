import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { SETTINGS_REGISTRY, SETTING_IDS } from '../settings/keys'
import {
  migrateSetting,
  migrationProblems,
  SETTING_MIGRATIONS,
  type SettingMigration,
} from '../settings/migrations'
import { resolveSettings } from '../settings/resolve'
import released from './settings-keys-released.json' with { type: 'json' }

const RELEASED_IDS: readonly string[] = released.ids

/**
 * The gate.
 *
 * Everything else in this file describes how migration behaves; this describes
 * why the table cannot be forgotten. Renaming a key is a breaking change to a
 * file we do not own, and the damage is silent — the value is dropped and the
 * new default takes over, so the app does the opposite of what the user asked.
 * Five ids had already gone this way before anyone noticed one of them.
 */
describe('released setting ids', () => {
  const retired = new Set(SETTING_MIGRATIONS.map((migration) => migration.from))
  const live = new Set<string>(SETTING_IDS)

  it.each(RELEASED_IDS)('%s is still live or has a migration', (id) => {
    expect(live.has(id) || retired.has(id)).toBe(true)
  })

  it('lists every key the registry ships', () => {
    // The other half of the gate: a key added to the registry without being
    // recorded here would be free to vanish later without tripping anything.
    expect(SETTING_IDS.filter((id) => !RELEASED_IDS.includes(id))).toEqual([])
  })

  it('lists every key a migration retires', () => {
    // Retiring an id that was never released means the record has a hole in it:
    // the id shipped, or the migration is describing something that never did.
    expect([...retired].filter((id) => !RELEASED_IDS.includes(id))).toEqual([])
  })

  it('never drops an id from the record', () => {
    // Deleting a line from the JSON is the one edit that silently disarms this
    // whole file, and it is exactly what a failing run tempts you to do.
    //
    // Stated as an equality against the two live sources rather than against a
    // hand-written count: live ids and retired ids are disjoint (a migration
    // whose `from` is still registered is a `migrationProblems` failure) and the
    // tests above make the record a superset of both, so the sizes must match
    // exactly. A literal would have to be edited on every added key, which makes
    // it a number nobody trusts and everybody bumps.
    expect(RELEASED_IDS.length).toBe(live.size + retired.size)
  })
})

describe('migration table', () => {
  it('has no problems', () => {
    expect(migrationProblems(SETTINGS_REGISTRY)).toEqual([])
  })

  it('rejects a rename whose transform the new key will not accept', () => {
    const broken: SettingMigration[] = [
      {
        kind: 'renamed',
        from: 'workbench.gone',
        to: 'workbench.surface.opacity',
        reason: 'test',
        migrate: () => 'not a number',
        samples: [1],
      },
    ]

    expect(migrationProblems(SETTINGS_REGISTRY, broken)).toMatchObject([
      { from: 'workbench.gone', reason: expect.stringContaining('rejects') },
    ])
  })

  it('rejects a rename pointing at a key that does not exist', () => {
    const broken: SettingMigration[] = [
      { kind: 'renamed', from: 'a.b', to: 'c.d' as never, reason: 'test', samples: [1] },
    ]

    expect(migrationProblems(SETTINGS_REGISTRY, broken)).toMatchObject([
      { from: 'a.b', reason: expect.stringContaining('unregistered') },
    ])
  })

  it('rejects retiring a key that is still registered', () => {
    const broken: SettingMigration[] = [
      { kind: 'removed', from: 'editor.fontFamily', reason: 'test' },
    ]

    expect(migrationProblems(SETTINGS_REGISTRY, broken)).toMatchObject([
      { from: 'editor.fontFamily', reason: expect.stringContaining('still a registered key') },
    ])
  })

  it('rejects a cycle', () => {
    const cyclic: SettingMigration[] = [
      { kind: 'renamed', from: 'x.one', to: 'x.two' as never, reason: 't', samples: [] },
      { kind: 'renamed', from: 'x.two', to: 'x.one' as never, reason: 't', samples: [] },
    ]

    expect(
      migrationProblems(SETTINGS_REGISTRY, cyclic).some((p) => p.reason.includes('cycle')),
    ).toBe(true)
  })

  it('follows a chain of renames in one read', () => {
    const chain = new Map<string, SettingMigration>([
      [
        'a.one',
        {
          kind: 'renamed',
          from: 'a.one',
          to: 'a.two' as never,
          reason: 't',
          samples: [],
          migrate: (n) => (n as number) + 1,
        },
      ],
      [
        'a.two',
        {
          kind: 'renamed',
          from: 'a.two',
          to: 'editor.fontSize' as never,
          reason: 't',
          samples: [],
          migrate: (n) => (n as number) * 10,
        },
      ],
    ])

    expect(migrateSetting('a.one', 1, chain)).toMatchObject({
      kind: 'renamed',
      id: 'editor.fontSize',
      value: 20,
    })
  })
})

/**
 * The regression this was built for: the value has to come out the other side
 * meaning what the user meant, not merely stop producing an error.
 */
describe('resolving a settings file written by an older build', () => {
  it('keeps a wallpaper the user turned off turned off', () => {
    const resolution = resolveSettings([
      { id: 'user', raw: { 'workbench.wallpaper.enabled': false } },
    ])

    expect(resolution.values['workbench.wallpaper']).toEqual({
      light: { kind: 'none' },
      dark: { kind: 'none' },
    })
  })

  it('reports the move as migrated rather than as an unknown key', () => {
    const resolution = resolveSettings([
      { id: 'user', raw: { 'workbench.wallpaper.enabled': false } },
    ])

    expect(resolution.diagnostics).toMatchObject([
      { kind: 'migrated', id: 'workbench.wallpaper.enabled', layer: 'user' },
    ])
  })

  it('lets an explicit new value win over the old key', () => {
    const resolution = resolveSettings([
      {
        id: 'user',
        raw: {
          'workbench.wallpaper.enabled': false,
          'workbench.wallpaper': { light: { kind: 'desktop' }, dark: { kind: 'desktop' } },
        },
      },
    ])

    expect(resolution.values['workbench.wallpaper']).toEqual({
      light: { kind: 'desktop' },
      dark: { kind: 'desktop' },
    })
  })

  it('carries the vibrancy flag to the transparency mode it became', () => {
    expect(
      resolveSettings([{ id: 'user', raw: { 'window.nativeVibrancy': true } }]).values[
        'window.transparency'
      ],
    ).toBe('window')
    expect(
      resolveSettings([{ id: 'user', raw: { 'window.nativeVibrancy': false } }]).values[
        'window.transparency'
      ],
    ).toBe('compositor')
  })

  it('says a removed key is gone instead of calling it unknown', () => {
    const resolution = resolveSettings([
      { id: 'user', raw: { 'editor.externalEditor': '/usr/bin/vim' } },
    ])

    expect(resolution.diagnostics).toMatchObject([
      { kind: 'removed-key', id: 'editor.externalEditor', layer: 'user' },
    ])
  })

  it('still calls a genuinely unknown key unknown', () => {
    const resolution = resolveSettings([{ id: 'user', raw: { 'editor.fromANewerBuild': true } }])

    expect(resolution.diagnostics).toMatchObject([{ kind: 'unknown-key' }])
  })

  it('holds a migrated value to the scope rules of the key it became', () => {
    // `window.transparency` is machine-scoped, so a workspace file must not be
    // able to set it — least of all through an id that predates the rule.
    const resolution = resolveSettings([
      { id: 'workspace', raw: { 'window.nativeVibrancy': true } },
    ])

    expect(resolution.diagnostics.map((d) => d.kind)).toContain('scope-not-allowed')
    expect(resolution.values['window.transparency']).toBe('compositor')
  })

  it('leaves the raw layer untouched so an older build still reads its own key', () => {
    const raw = { 'workbench.wallpaper.enabled': false }
    resolveSettings([{ id: 'user', raw }])

    expect(raw).toEqual({ 'workbench.wallpaper.enabled': false })
  })

  it('migrates every sample the table claims to handle', () => {
    for (const migration of SETTING_MIGRATIONS) {
      if (migration.kind !== 'renamed') continue

      for (const sample of migration.samples) {
        const outcome = migrateSetting(migration.from, sample)
        expect(outcome.kind).toBe('renamed')
        if (outcome.kind !== 'renamed') continue

        const parsed = v.safeParse(SETTINGS_REGISTRY[outcome.id].schema, outcome.value)
        expect(parsed.success).toBe(true)
      }
    }
  })
})
