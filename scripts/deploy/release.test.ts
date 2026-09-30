import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { webBase } from './config'
import { porcelainPaths, verifyCandidateFiles, type Release } from './release'

test('the first dirty path keeps its first letter', () => {
  expect(porcelainPaths(' M apps/server/src/index.ts\0?? plans/new.md\0')).toEqual([
    'apps/server/src/index.ts',
    'plans/new.md',
  ])
})

test('reads real git status, renames included', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'platform-deploy-porcelain-'))
  try {
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe' })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      return result.stdout.toString()
    }
    git('init', '-q')
    writeFileSync(path.join(root, 'apps.txt'), 'one\n')
    writeFileSync(path.join(root, 'old name.txt'), 'two\n')
    git('add', '.')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
    writeFileSync(path.join(root, 'apps.txt'), 'changed\n')
    git('mv', 'old name.txt', 'new name.txt')
    writeFileSync(path.join(root, 'untracked.txt'), '')

    expect(porcelainPaths(git('status', '--porcelain', '-z')).toSorted()).toEqual([
      'apps.txt',
      'new name.txt',
      'untracked.txt',
    ])
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test.each(['pty-host.js', 'image-worker.ts', 'THIRD_PARTY_NOTICES.txt'])(
  'a candidate without %s fails verification',
  async (missing) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'platform-deploy-candidate-'))
    try {
      const web = path.join(directory, 'web')
      const server = path.join(directory, 'server')
      mkdirSync(path.join(web, 'assets'), { recursive: true })
      mkdirSync(path.join(server, 'runtime'), { recursive: true })
      writeFileSync(
        path.join(web, 'index.html'),
        `<script src="${webBase}assets/main.js"></script>`,
      )
      writeFileSync(path.join(web, 'assets/editor.wasm'), '')
      for (const file of [
        'index.js',
        'remote-support.js',
        'watch-worker.ts',
        'runtime/package.json',
        'runtime/bun.lock',
        'pty-host.js',
        'image-worker.ts',
        'THIRD_PARTY_NOTICES.txt',
      ].filter((file) => file !== missing))
        writeFileSync(path.join(server, file), '')
      const release: Release = { name: 'candidate', directory, web, server, previous: null }

      await expect(verifyCandidateFiles(release)).rejects.toThrow(
        `server/${missing} is missing; deploy with --server to rebuild the server`,
      )
      writeFileSync(path.join(server, missing), '')
      await expect(verifyCandidateFiles(release)).resolves.toBeUndefined()
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  },
)

const checkout = path.resolve(import.meta.dirname, '../..')

function copyDeploymentSources(file: string, fixture: string, copied = new Set<string>()) {
  if (copied.has(file)) return
  copied.add(file)
  const source = path.join(checkout, file)
  const destination = path.join(fixture, file)
  mkdirSync(path.dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  const imports = readFileSync(source, 'utf8').matchAll(/from ['"](\.[^'"]+)['"]/g)
  for (const [, specifier] of imports) {
    const target = path.normalize(path.join(path.dirname(file), specifier!))
    const resolved = [target, `${target}.ts`, `${target}.mjs`].find((candidate) =>
      existsSync(path.join(checkout, candidate)),
    )
    expect(resolved, `local deployment import ${target}`).toBeDefined()
    copyDeploymentSources(resolved!, fixture, copied)
  }
}

function createWebBuildFixture(directory: string, stale: boolean, failedBuild = false) {
  copyDeploymentSources('scripts/deploy/release.ts', directory)
  symlinkSync(path.join(checkout, 'node_modules'), path.join(directory, 'node_modules'))
  for (const workspace of ['scripts', 'apps/server', 'apps/web', 'packages/contracts']) {
    const dependencies = path.join(checkout, workspace, 'node_modules')
    if (!existsSync(dependencies)) continue
    mkdirSync(path.join(directory, workspace), { recursive: true })
    symlinkSync(dependencies, path.join(directory, workspace, 'node_modules'))
  }
  const write = (file: string, content: string) => {
    const destination = path.join(directory, file)
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, content)
  }
  write('package.json', JSON.stringify({ scripts: { 'build:workspaces': 'bun build.ts' } }))
  write(
    'build.ts',
    failedBuild
      ? 'process.exit(17)'
      : `import { mkdirSync, writeFileSync } from 'node:fs'
mkdirSync('editor/packages/editor/dist', { recursive: true })
writeFileSync('editor/packages/editor/dist/index.d.ts', 'export type EditorTextBufferChange = { revisionAfter: number }')`,
  )
  if (stale)
    write('editor/packages/editor/dist/index.d.ts', 'export type EditorTextBufferChange = {}')
  write(
    'apps/web/tsconfig.json',
    JSON.stringify({
      compilerOptions: { noEmit: true, strict: true, types: [], skipLibCheck: true },
      files: ['main.ts'],
    }),
  )
  write(
    'apps/web/main.ts',
    `import type { EditorTextBufferChange } from '../../editor/packages/editor/dist/index'
const change: EditorTextBufferChange = { revisionAfter: 1 }
export const revision = change.revisionAfter`,
  )
  write('apps/web/index.html', '<head></head><script type="module" src="/main.ts"></script>')
  write('apps/web/dev.html', '<head></head><script type="module" src="/main.ts"></script>')
  write(
    'apps/web/vite.config.ts',
    `export default { build: { rolldownOptions: { input: ['index.html', 'dev.html'] } } }`,
  )
  write(
    'invoke.ts',
    `import { buildWeb } from './scripts/deploy/release'
const directory = import.meta.dir + '/release'
await buildWeb({ name: 'fixture', directory, web: directory + '/web', server: directory + '/server', previous: null })`,
  )
  mkdirSync(path.join(directory, 'release'))
}

test.each([false, true])(
  'web deployment builds %s stale workspace exports before consumers',
  async (stale) => {
    const directory = mkdtempSync('/work/tmp/platform-deploy-workspaces-')
    try {
      createWebBuildFixture(directory, stale)
      const child = Bun.spawn([process.execPath, 'invoke.ts'], {
        cwd: directory,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      const typecheckLog = path.join(directory, 'release/web-typecheck.log')
      const compilerOutput = existsSync(typecheckLog) ? readFileSync(typecheckLog, 'utf8') : ''
      expect(code, stdout + stderr + compilerOutput).toBe(0)
      expect(readFileSync(path.join(directory, 'release/web-workspaces.log'), 'utf8')).toContain(
        '[exit 0]',
      )
      expect(readFileSync(path.join(directory, 'release/web/index.html'), 'utf8')).toContain(
        'platform-release',
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test('a failed workspace build stops web deployment before consumer compilation', async () => {
  const directory = mkdtempSync('/work/tmp/platform-deploy-workspaces-')
  try {
    createWebBuildFixture(directory, false, true)
    const child = Bun.spawn([process.execPath, 'invoke.ts'], {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(code, stdout + stderr).not.toBe(0)
    expect(readFileSync(path.join(directory, 'release/web-workspaces.log'), 'utf8')).toContain(
      '[exit 17]',
    )
    expect(existsSync(path.join(directory, 'release/web-typecheck.log'))).toBe(false)
    expect(existsSync(path.join(directory, 'release/web'))).toBe(false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
