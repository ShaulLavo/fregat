import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  bootCandidate,
  porcelainPaths,
  readCheckout,
  verifyCandidateFiles,
  type Release,
} from './release'

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

test.each([
  ['attached', 'feature'],
  ['main', 'main'],
  ['unpushed', null],
  ['missing remote', null],
] as const)('reads a release branch for %s HEAD', async (state, branch) => {
  const root = mkdtempSync(path.join(tmpdir(), 'platform-deploy-checkout-'))
  try {
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe' })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      return result.stdout.toString().trim()
    }
    git('init', '-qb', 'feature')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'init')
    const initial = git('rev-parse', 'HEAD')
    if (state !== 'missing remote') git('update-ref', 'refs/remotes/origin/main', initial)
    if (state !== 'attached') git('checkout', '--detach', '-q', initial)
    if (state === 'main') {
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'remote')
      git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      git('checkout', '--detach', '-q', initial)
    }
    if (state === 'unpushed')
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'local')
    const expected = branch ?? git('rev-parse', '--short', 'HEAD')

    const checkout = await readCheckout(root)
    expect(checkout.branch).toBe(expected)
    expect(checkout.commit).toBe(git('rev-parse', 'HEAD'))
    expect(checkout.dirtyFiles).toEqual([])
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test.each(
  ['pty-host.js', 'pair.js', 'image-worker.ts', 'THIRD_PARTY_NOTICES.txt'].flatMap((missing) =>
    ['/', '/demo/', '/platform-api/'].map((base) => ({ missing, base })),
  ),
)('a candidate with base $base without $missing fails verification', async ({ missing, base }) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'platform-deploy-candidate-'))
  try {
    const web = path.join(directory, 'web')
    const server = path.join(directory, 'server')
    mkdirSync(path.join(web, 'assets'), { recursive: true })
    mkdirSync(path.join(server, 'runtime'), { recursive: true })
    writeFileSync(path.join(web, 'index.html'), `<script src="${base}assets/main.js"></script>`)
    writeFileSync(path.join(web, 'assets/editor.wasm'), '')
    for (const file of [
      'index.js',
      'remote-support.js',
      'pair.js',
      'watch-worker.ts',
      'runtime/package.json',
      'runtime/bun.lock',
      'pty-host.js',
      'image-worker.ts',
      'THIRD_PARTY_NOTICES.txt',
    ].filter((file) => file !== missing))
      writeFileSync(path.join(server, file), '')
    const release: Release = { name: 'candidate', directory, web, server, previous: null }

    await expect(verifyCandidateFiles(release, base)).rejects.toThrow(
      `server/${missing} is missing; install with --server to rebuild the server`,
    )
    writeFileSync(path.join(server, missing), '')
    await expect(verifyCandidateFiles(release, base)).resolves.toBeUndefined()
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test.each(['/', '/demo/', '/platform-api/'])(
  'candidate boot reads the entry asset for base %s',
  async (base) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'platform-deploy-boot-'))
    try {
      const web = path.join(directory, 'web')
      const server = path.join(directory, 'server')
      mkdirSync(web)
      mkdirSync(server)
      writeFileSync(path.join(web, 'index.html'), `<script src="${base}assets/main.js"></script>`)
      const release: Release = {
        name: path.basename(directory),
        directory,
        web,
        server,
        previous: null,
      }
      writeFileSync(
        path.join(server, 'index.js'),
        `
      import { readFileSync, writeFileSync } from 'node:fs'
      import path from 'node:path'
      process.on('SIGTERM', () => {})
      setTimeout(() => {
        writeFileSync('watchdog-fired', '')
        process.exit(0)
      }, 1500)
      Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT), fetch(request) {
        const pathname = new URL(request.url).pathname
        if (pathname === '/release') return Response.json({ release: ${JSON.stringify(release.name)}, server: { release: ${JSON.stringify(release.name)} } })
        if (pathname === '/~probe/workbench') return new Response(readFileSync(path.join(process.env.WEB_ROOT, 'index.html')))
        if (pathname === '/assets/main.js') return new Response('')
        return new Response('', { status: 401 })
      } })
    `,
      )
      await expect(bootCandidate(release, base)).resolves.toBeUndefined()
      expect(existsSync(path.join(directory, 'watchdog-fired'))).toBe(false)
      expect(
        JSON.parse(readFileSync(path.join(directory, 'candidate-check.json'), 'utf8')),
      ).toMatchObject({ ok: true })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

const checkout = path.resolve(import.meta.dirname, '../..')

test.each([
  ['release', 'Candidate release:'],
  ['document', 'Candidate document status:'],
  ['asset', 'Candidate asset status:'],
  ['shutdown', 'Candidate document status:'],
])(
  'failed candidate %s validation stops the server before reading stderr',
  async (failure, message) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'platform-deploy-failed-'))
    const release: Release = {
      name: path.basename(directory),
      directory,
      web: path.join(directory, 'web'),
      server: path.join(directory, 'server'),
      previous: null,
    }
    try {
      mkdirSync(release.web)
      mkdirSync(release.server)
      writeFileSync(path.join(release.web, 'index.html'), '<script src="/assets/main.js"></script>')
      writeFileSync(
        path.join(release.server, 'index.js'),
        `
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const failure = ${JSON.stringify(failure)}
writeFileSync('candidate.pid', String(process.pid))
console.error('candidate diagnostic')
if (failure === 'shutdown') process.on('SIGTERM', () => console.error('shutdown stalled'))
setTimeout(() => {
  writeFileSync('watchdog-fired', '')
  process.exit(0)
}, 2000)
Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT), fetch(request) {
  const pathname = new URL(request.url).pathname
  if (pathname === '/release') return Response.json({ release: failure === 'release' ? 'wrong' : ${JSON.stringify(release.name)}, server: { release: ${JSON.stringify(release.name)} } })
  if (pathname === '/~probe/workbench') return new Response(readFileSync(path.join(process.env.WEB_ROOT, 'index.html')), { status: ['document', 'shutdown'].includes(failure) ? 404 : 200 })
  if (pathname === '/assets/main.js') return new Response('', { status: failure === 'asset' ? 404 : 200 })
  return new Response('', { status: 401 })
} })
`,
      )

      await expect(bootCandidate(release)).rejects.toThrow(message)
      expect(existsSync(path.join(directory, 'watchdog-fired'))).toBe(false)
      expect(readFileSync(path.join(directory, 'candidate-server.log'), 'utf8')).toContain(
        'candidate diagnostic',
      )
      const pid = Number(readFileSync(path.join(directory, 'candidate.pid'), 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
      expect(existsSync(path.join(tmpdir(), `platform-deploy-${release.name}`))).toBe(false)
      expect(existsSync(path.join(directory, 'candidate-check.json'))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

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
    const resolved = [`${target}.ts`, `${target}.mjs`, `${target}/index.ts`, target].find(
      (candidate) =>
        existsSync(path.join(checkout, candidate)) &&
        statSync(path.join(checkout, candidate)).isFile(),
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
    const directory = mkdtempSync(path.join(tmpdir(), 'platform-deploy-workspaces-'))
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
  const directory = mkdtempSync(path.join(tmpdir(), 'platform-deploy-workspaces-'))
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
