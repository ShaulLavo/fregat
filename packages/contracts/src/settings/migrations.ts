import * as v from 'valibot'
import type { SettingId } from './keys'

/**
 * What happened to a key that was once shipped and is no longer in the registry.
 *
 * Setting ids are a public API surface. A user's settings.json is written by one
 * build and read by the next, so removing an id is a breaking change to a file
 * we do not own — and the failure is silent: the value is dropped, the new
 * default takes over, and the app quietly does the opposite of what the user
 * asked for. `workbench.wallpaper.enabled: false` became a wallpaper switched
 * back on.
 *
 * Every id that ever shipped therefore stays accounted for here forever, even
 * when the answer is "that feature is gone". `settings-migrations.test.ts`
 * checks that against the released-id list and fails the build when a rename
 * lands without an entry.
 */
export type SettingMigration =
  | {
      readonly kind: 'renamed'
      readonly from: string
      readonly to: SettingId
      /** Shown to the user, so it reads as a sentence about their setting. */
      readonly reason: string
      /**
       * The old value in the new key's shape.
       *
       * Omit only when the shape is genuinely unchanged. Returning something the
       * new schema rejects is not a crash: it lands in the existing
       * `invalid-value` path, same as any hand-edited file.
       */
      readonly migrate?: (value: unknown) => unknown
      /**
       * Old values this migration claims to handle, checked against the new
       * key's schema by the test. A migration nobody exercised is a migration
       * that runs for the first time on a user's real file.
       */
      readonly samples: readonly unknown[]
    }
  | {
      readonly kind: 'removed'
      readonly from: string
      /** Shown to the user. Say what replaced the feature, or that nothing did. */
      readonly reason: string
    }

/**
 * Keys that have left the registry, oldest first.
 *
 * Reconstructed from the history of `keys.ts` rather than written from memory:
 * five ids had already been dropped before this table existed, and only one of
 * them was the one anybody noticed.
 */
export const SETTING_MIGRATIONS: readonly SettingMigration[] = [
  {
    kind: 'removed',
    from: 'window.defaultWidth',
    reason: 'The window restores its own size now; this value is no longer read.',
  },
  {
    kind: 'removed',
    from: 'window.defaultHeight',
    reason: 'The window restores its own size now; this value is no longer read.',
  },
  {
    kind: 'renamed',
    from: 'window.nativeVibrancy',
    to: 'window.transparency',
    reason: 'Vibrancy became a choice of who supplies the see-through, not an on/off switch.',
    // `true` meant "composite the live desktop behind the window", which is the
    // per-pixel transparent window — `window`, not the compositor blend that
    // replaced it as the default.
    migrate: (value) => (value === true ? 'window' : 'compositor'),
    samples: [true, false],
  },
  {
    kind: 'removed',
    from: 'editor.externalEditor',
    reason: 'Opening files in an external editor was removed; nothing replaced it.',
  },
  {
    kind: 'renamed',
    from: 'workbench.wallpaper.enabled',
    to: 'workbench.wallpaper',
    reason: 'The wallpaper setting stores visibility and the selected image.',
    // Preserve the old switch alongside the default source.
    migrate: (value) =>
      value === false
        ? { enabled: false, source: { kind: 'desktop' } }
        : { enabled: true, source: { kind: 'desktop' } },
    samples: [true, false],
  },
]

const BY_FROM: ReadonlyMap<string, SettingMigration> = new Map(
  SETTING_MIGRATIONS.map((migration) => [migration.from, migration]),
)

export function migrationFor(id: string): SettingMigration | undefined {
  return BY_FROM.get(id)
}

export type MigrationOutcome =
  /** Not a retired id. The caller reads it as it always did. */
  | { readonly kind: 'none' }
  /** Retired with a successor: read `value` under `id` instead. */
  | {
      readonly kind: 'renamed'
      readonly id: SettingId
      readonly value: unknown
      readonly from: string
      readonly reason: string
    }
  /** Retired with nothing behind it. */
  | { readonly kind: 'removed'; readonly from: string; readonly reason: string }

/**
 * How many renames one id may pass through before we call it a cycle.
 *
 * A chain is legitimate — a key renamed twice across two releases has to reach
 * its current id from a file written before either — but an unbounded walk over
 * a hand-edited table is a hang, and this runs on every settings read.
 */
const MAX_HOPS = 8

/**
 * Follow a retired id to where its value lives today.
 *
 * Transitive, because the file being read may predate every rename in the
 * chain. Each hop applies its own transform in turn, so a two-step rename does
 * not need a third entry spelling out the composition.
 */
export function migrateSetting(
  id: string,
  value: unknown,
  // The table to walk. Defaulted rather than imported at the call sites so the
  // shipping path stays a two-argument call, and so `migrationProblems` can
  // check a fixture against the same walk the resolver uses rather than a
  // second copy of it.
  byFrom: ReadonlyMap<string, SettingMigration> = BY_FROM,
): MigrationOutcome {
  let currentId = id
  let currentValue = value
  let from: string | undefined
  let reason: string | undefined

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const migration = byFrom.get(currentId)
    if (!migration) {
      return from === undefined || reason === undefined
        ? { kind: 'none' }
        : { kind: 'renamed', id: currentId as SettingId, value: currentValue, from, reason }
    }

    if (migration.kind === 'removed') {
      return { kind: 'removed', from: id, reason: migration.reason }
    }

    currentValue = migration.migrate ? migration.migrate(currentValue) : currentValue
    currentId = migration.to
    from = id
    // The user is told where their value went, so the last hop is the one that
    // names the key they can now edit.
    reason = migration.reason
  }

  // `migrationProblems` makes this unreachable in the shipping table; a cycle
  // must still not hang a settings read if one ever lands.
  return { kind: 'removed', from: id, reason: 'This setting could not be migrated.' }
}

export type MigrationProblem = {
  readonly from: string
  readonly reason: string
}

/**
 * Checks the table the way `registryProblems` checks the registry.
 *
 * Takes the registry rather than importing it so the test can exercise the
 * rules against a fixture, and so this module stays free of the shipping table.
 *
 * The sample check is the one that earns its keep: a `migrate` that returns a
 * shape the new key rejects fails in exactly the way the table exists to
 * prevent, and it would otherwise first run on a user's file.
 */
export function migrationProblems(
  registry: Readonly<Record<string, { readonly schema: v.GenericSchema }>>,
  migrations: readonly SettingMigration[] = SETTING_MIGRATIONS,
): MigrationProblem[] {
  const problems: MigrationProblem[] = []
  const seen = new Set<string>()
  const byFrom = new Map(migrations.map((migration) => [migration.from, migration]))

  for (const migration of migrations) {
    const { from } = migration

    if (seen.has(from)) problems.push({ from, reason: 'listed twice' })
    seen.add(from)

    // A retired id that is also a live key would shadow the real setting: every
    // read of it would be rewritten to somewhere else.
    if (registry[from]) {
      problems.push({ from, reason: 'is still a registered key, so it has not been retired' })
    }

    if (migration.kind === 'removed') continue

    const target = registry[migration.to]
    if (!target) {
      problems.push({ from, reason: `renamed to an unregistered key: ${migration.to}` })
      continue
    }

    if (migration.samples.length === 0) {
      problems.push({ from, reason: 'a renamed key needs at least one sample old value' })
    }

    for (const sample of migration.samples) {
      const outcome = migrateSetting(from, sample, byFrom)
      if (outcome.kind !== 'renamed') {
        problems.push({ from, reason: `sample ${JSON.stringify(sample)} did not migrate` })
        continue
      }

      const schema = registry[outcome.id]?.schema
      if (!schema) {
        problems.push({ from, reason: `migrates into an unregistered key: ${outcome.id}` })
        continue
      }

      const parsed = v.safeParse(schema, outcome.value)
      if (!parsed.success) {
        problems.push({
          from,
          reason: `sample ${JSON.stringify(sample)} migrates to a value ${outcome.id} rejects: ${v.summarize(parsed.issues)}`,
        })
      }
    }
  }

  problems.push(...chainProblems(byFrom))

  return problems
}

/**
 * A chain that does not terminate inside `MAX_HOPS` is a cycle, and a cycle
 * would otherwise be caught only by the defensive bail in `migrateSetting` —
 * which reports every affected key as unmigratable rather than as a table bug.
 */
function chainProblems(byFrom: ReadonlyMap<string, SettingMigration>): MigrationProblem[] {
  const problems: MigrationProblem[] = []

  for (const [from, migration] of byFrom) {
    if (migration.kind !== 'renamed') continue

    let current = migration.to as string
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const next = byFrom.get(current)
      if (!next) break
      if (next.kind === 'removed') break
      current = next.to
      if (current === from) {
        problems.push({ from, reason: 'renames in a cycle' })
        break
      }
    }
  }

  return problems
}
