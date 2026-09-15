import fs from 'node:fs'
import path from 'node:path'
import { readDevSources, type DevPackage } from './dev-sources'

/**
 * Fails a typecheck that would otherwise read a stale sibling build.
 *
 * The linked editor packages are consumed two different ways. Vite's
 * `devSourcePlugin` (`apps/web/vite.config.ts`) rewrites every
 * `@singapore-editor/*` specifier to the checkout's `src` during `serve`, and
 * `check-dev-types.ts` generates a tsconfig with the same mapping. But plain
 * `tsgo` — what `bun run typecheck` runs in every package — has no `paths` for
 * those ids, so it resolves them through the published `exports` map and reads
 * `dist/*.d.ts`.
 *
 * So the dev server can be running fresh sibling source while the typechecker
 * reads a build from days ago. It fails in both directions: errors for code
 * that is already fixed, and silence for code the sibling has since broken. On
 * 2026-09-15 it cost a debugging cycle — ten `EditorCommandId` errors for
 * commands that were sitting in the sibling's `src` the whole time.
 *
 * Comparing mtimes rather than rebuilding automatically: building another
 * checkout as a side effect of typechecking this one is a surprise, and the
 * command to run is short enough to hand over.
 */
const SKIP = new Set(['ghostty-webgpu'])

type Stale = {
  readonly name: string
  readonly checkout: string
  readonly newestSource: string
}

function newestMtime(dir: string, deadline: number): { ms: number; file: string } {
  let best = { ms: 0, file: dir }
  if (!fs.existsSync(dir)) return best

  const stack = [dir]
  while (stack.length > 0) {
    if (Date.now() > deadline) return best

    const current = stack.pop()
    if (current === undefined) break

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue

      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }

      const { mtimeMs } = fs.statSync(full)
      if (mtimeMs > best.ms) best = { ms: mtimeMs, file: full }
    }
  }

  return best
}

function staleness(pkg: DevPackage, deadline: number): Stale | null {
  const dist = path.join(pkg.root, 'dist')
  // No dist means nothing to go stale — the package is consumed some other way.
  if (!fs.existsSync(dist)) return null

  const source = newestMtime(path.join(pkg.root, 'src'), deadline)
  const built = newestMtime(dist, deadline)
  if (source.ms <= built.ms) return null

  return {
    name: pkg.name,
    checkout: pkg.checkout,
    newestSource: path.relative(pkg.checkout, source.file),
  }
}

// A typecheck that hangs on a filesystem walk is worse than one that misses a
// stale package, so the walk gets a budget and gives up rather than blocking.
const deadline = Date.now() + 5_000
const packages = readDevSources(path.resolve(import.meta.dirname, '../apps/web'))
const stale = packages
  .filter((pkg) => !SKIP.has(pkg.name))
  .map((pkg) => staleness(pkg, deadline))
  .filter((entry): entry is Stale => entry !== null)

if (stale.length === 0) process.exit(0)

const checkouts = [...new Set(stale.map((entry) => entry.checkout))]
const names = stale.map((entry) => entry.name)

console.error(
  [
    `${stale.length} linked package${stale.length === 1 ? ' has' : 's have'} source newer than dist.`,
    'Typecheck reads dist, so it would check a stale build:',
    '',
    ...stale.map((entry) => `  ${entry.name} — ${entry.newestSource}`),
    '',
    'Rebuild, then run typecheck again:',
    ...checkouts.map(
      (checkout) => `  cd ${checkout} && bun run --filter '${names.join("' --filter '")}' build`,
    ),
    '',
  ].join('\n'),
)
process.exit(1)
