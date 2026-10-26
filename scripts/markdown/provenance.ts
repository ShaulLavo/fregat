import { execFile } from 'node:child_process'
import { hash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'
import { REMARK_BASELINE_PROFILE } from '../../packages/markdown/test/qualification'
import reference from '../../packages/markdown/test/reference/manifest.json'

const execute = promisify(execFile)

export async function qualificationProvenance(root: string) {
  const [commit, diff, lockfile, files] = await Promise.all([
    execute('git', ['rev-parse', 'HEAD'], { cwd: root }),
    execute('git', ['diff', '--binary', '--full-index', 'HEAD'], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    }),
    readFile(path.join(root, 'bun.lock')),
    sourceFiles(root),
  ])
  const sources = await Promise.all(
    files.map(async (file) => ({
      file,
      sha256: hash('sha256', await readFile(path.join(root, file)), 'hex'),
    })),
  )
  return {
    revision: commit.stdout.trim(),
    trackedDiffSha256: hash('sha256', diff.stdout, 'hex'),
    lockfileSha256: hash('sha256', lockfile, 'hex'),
    sourceClosureSha256: hash('sha256', JSON.stringify(sources), 'hex'),
    sources,
    runtime: {
      bun: Bun.version,
      node: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
    },
    curatedSources: MARKDOWN_CASES.map(({ id, sha256, split, profile }) => ({
      id,
      sha256,
      split,
      profile,
    })),
    reference,
    baselineProfile: REMARK_BASELINE_PROFILE,
  }
}

async function sourceFiles(root: string): Promise<string[]> {
  const directories = [
    'packages/markdown/src',
    'packages/markdown/test',
    'apps/web/src/features/chat/components',
    'apps/web/src/features/chat/providers',
    'apps/web/src/features/chat/state',
    'apps/web/src/features/chat/utils',
    'apps/web/src/features/chat/tests',
    'scripts/markdown',
  ]
  const files = (await Promise.all(directories.map((directory) => codeFiles(root, directory))))
    .flat()
    .concat(await installedPackageFiles(root, '@singapore-editor/tree-sitter'))
  files.push(
    'apps/web/test/providers.tsx',
    'apps/web/test/factories/markdown-browser.tsx',
    'apps/web/test/factories/markdown-observation.ts',
    'apps/web/test/factories/markdown-production-assets.ts',
    'apps/web/test/factories/markdown-production-types.ts',
    'apps/web/test/factories/markdown-production.tsx',
    'apps/web/test/factories/markdown-timeline-scene.tsx',
    'apps/web/test/factories/qualification-image-command.ts',
    'apps/web/test/markdown-production.html',
    'apps/web/test/markdown-production.ts',
    'apps/web/vitest.markdown-qualification.config.ts',
    'apps/web/vite.config.ts',
    'apps/web/vitest.browser.config.ts',
    'package.json',
  )
  return files.sort()
}

async function installedPackageFiles(root: string, name: string): Promise<string[]> {
  const webRequire = createRequire(path.join(root, 'apps/web/package.json'))
  webRequire.resolve(name)
  const directory = path.join(root, 'apps/web/node_modules', name)
  const files = await artifactFiles(root, path.join(directory, 'dist'))
  files.push(path.relative(root, path.join(directory, 'package.json')))
  return files
}

async function artifactFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const parts = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) return artifactFiles(root, file)
      return [path.relative(root, file)]
    }),
  )
  return parts.flat()
}

async function codeFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true })
  const parts = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) return codeFiles(root, file)
      return /\.(?:tsx?|json)$/u.test(file) ? [file] : []
    }),
  )
  return parts.flat()
}
