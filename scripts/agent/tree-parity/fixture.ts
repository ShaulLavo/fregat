import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createScriptError } from '../../structured-errors'
import { fixtureGit, releaseFixture } from '../fixture-workspace'

/** Files under `src/list/`, enough to scroll the tree with `src/` and `src/list/` stuck. */
const LIST_FILE_COUNT = 48

export const LONG_FILE_NAME =
  'a-very-long-component-file-name-that-the-sidebar-has-to-truncate.component.tsx'

/**
 * The parity fixture: every git state, a flattened chain, a long name, an unreadable folder and a
 * folder long enough for sticky rows. Names are fixed so captures compare across runs.
 */
export async function createTreeParityFixture() {
  const root = await mkdtemp('/work/tmp/fregat-tree-parity-')
  try {
    await fillFixture(root)
    return { root, release: () => releaseTreeParityFixture(root) }
  } catch (error) {
    await releaseTreeParityFixture(root)
    throw error
  }
}

async function releaseTreeParityFixture(root: string) {
  // `rm` cannot descend into the unreadable folder until its mode is restored.
  await chmod(path.join(root, 'secret'), 0o755).catch(() => undefined)
  await releaseFixture(root)
}

async function fillFixture(root: string) {
  const git = (...args: string[]) => fixtureGit(root, args)
  await git('init', '--quiet', '--initial-branch=main')
  await git('config', 'user.email', 'fregat@example.com')
  await git('config', 'user.name', 'Fregat')
  await git('config', 'commit.gpgsign', 'false')

  await files(root, {
    '.gitignore': 'ignored-dir/\ndebug.log\n',
    'bun.lock': '{}\n',
    'conflict.ts': 'export const side = "base"\n',
    'deleted.json': '{}\n',
    'modified.md': '# Before\n',
    'package.json': '{ "name": "fixture" }\n',
    'rename-me.ts': 'export const renamed = true\n',
    'lonely/chain/of/single/only.txt': 'alone\n',
    'src/app.ts': 'export const app = 1\n',
    'src/styles.css': 'body {}\n',
    [`src/${LONG_FILE_NAME}`]: 'export {}\n',
    'src/components/button.tsx': 'export {}\n',
    'src/components/deep/nested/leaf.css': '.leaf {}\n',
    'pending/inside.ts': 'export {}\n',
    ...listFiles(),
  })
  await git('add', '-A')
  await git('commit', '--quiet', '-m', 'base')

  // A merge conflict first: it needs a clean tree on both sides.
  await git('checkout', '--quiet', '-b', 'other')
  await writeFile(path.join(root, 'conflict.ts'), 'export const side = "other"\n')
  await git('commit', '--quiet', '-am', 'other side')
  await git('checkout', '--quiet', 'main')
  await writeFile(path.join(root, 'conflict.ts'), 'export const side = "main"\n')
  await git('commit', '--quiet', '-am', 'main side')
  await mergeExpectingConflict(root)

  await files(root, {
    'added.ts': 'export const added = true\n',
    'untracked.py': 'print("untracked")\n',
    'debug.log': 'ignored\n',
    'ignored-dir/cache.bin': 'ignored\n',
    'modified.md': '# After\n',
    'src/components/deep/nested/leaf.css': '.leaf { color: red }\n',
    'secret/hidden.txt': 'unreadable\n',
  })
  await git('add', 'added.ts')
  await git('rm', '--quiet', 'deleted.json')
  await git('mv', 'rename-me.ts', 'renamed.ts')
  await chmod(path.join(root, 'secret'), 0o000)
}

async function mergeExpectingConflict(root: string) {
  const child = Bun.spawn(['git', '-C', root, 'merge', '--quiet', '--no-edit', 'other'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  // Exit 1 is the conflict this fixture wants; the index then holds `conflict.ts` as UU.
  const code = await child.exited
  if (code !== 1) throw createScriptError(`Fixture merge exited ${code}, expected a conflict (1).`)
}

function listFiles() {
  return Object.fromEntries(
    Array.from({ length: LIST_FILE_COUNT }, (_, index) => [
      `src/list/item-${String(index).padStart(2, '0')}.ts`,
      `export const item = ${index}\n`,
    ]),
  )
}

async function files(root: string, entries: Record<string, string>) {
  for (const [name, content] of Object.entries(entries)) {
    const file = path.join(root, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
}
