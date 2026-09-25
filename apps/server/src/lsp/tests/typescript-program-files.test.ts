import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'

import { test, workspaceRequest as request } from '../../../test/factories/workspace-address'
import { createWorkspacePaths } from '../../fs/path'
import { readProgramFiles, type ProgramFileSystem } from '../typescript/program-files'

const RUNTIMES = [
  { packageName: 'typescript', kind: 'native' },
  { packageName: 'typescript-language-service', kind: 'legacy' },
] as const

const PROJECT_FILES: Readonly<Record<string, string>> = {
  'project/package.json': '{"name":"project","type":"module"}',
  'project/tsconfig.json': JSON.stringify({
    compilerOptions: {
      strict: true,
      lib: ['es2022'],
      types: [],
      module: 'esnext',
      moduleResolution: 'bundler',
    },
    include: ['src'],
  }),
  'project/src/a.ts':
    'import { b } from "./b"\nimport { dep } from "dep"\nimport { far } from "far"\nexport const a = b + dep + far\n',
  'project/src/b.ts': 'export const b = 1\n',
  // A NUL inside a string literal makes the file look binary to `/fs/read`'s sniffing.
  'project/src/key.ts': 'export const key = `a\u0000b`\n',
  'project/node_modules/dep/package.json': '{"name":"dep","types":"index.d.ts"}',
  'project/node_modules/dep/index.d.ts': 'export declare const dep: number\n',
  'project/other.json': '{}',
  'elsewhere/tsconfig.json': '{"include":["../project/src"]}',
}

type Workspace = { root: string; directory: string }

async function writeProject(workspace: Workspace, packageName: string) {
  for (const [relativePath, contents] of Object.entries(PROJECT_FILES)) {
    const filePath = path.join(workspace.root, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, contents)
  }
  const installed = path.dirname(fileURLToPath(import.meta.resolve(`${packageName}/package.json`)))
  await symlink(installed, path.join(workspace.root, 'project/node_modules/typescript'), 'dir')

  // A package linked in from outside the server's root: listed by the compiler, refused by /fs/read.
  const far = path.join(workspace.directory, 'far')
  await mkdir(far)
  await writeFile(path.join(far, 'package.json'), '{"name":"far","types":"index.d.ts"}')
  await writeFile(path.join(far, 'index.d.ts'), 'export declare const far: number\n')
  await symlink(far, path.join(workspace.root, 'project/node_modules/far'), 'dir')
}

function programFiles(app: Parameters<typeof request>[0], root: string, tsconfig: string) {
  const query = new URLSearchParams({ root, tsconfig })
  return request(app, `/lsp/typescript/program-files?${query}`)
}

test.for(RUNTIMES)(
  'lists the program files of a $kind TypeScript project with sizes and totals',
  async ({ packageName, kind }, { workspace }) => {
    await writeProject(workspace, packageName)
    const app = workspace.openApp()
    expect((await request(app, '/fs/workspace-address', { path: 'project' })).status).toBe(200)

    const response = await programFiles(app, 'project', 'project/tsconfig.json')
    expect(response.status).toBe(200)
    const body = await response.json()

    const expected = [
      'project/node_modules/dep/index.d.ts',
      'project/src/a.ts',
      'project/src/b.ts',
      'project/src/key.ts',
    ]
    const sizes = await Promise.all(
      expected.map(async (file) => (await readFile(path.join(workspace.root, file))).byteLength),
    )
    expect(body).toMatchObject({
      root: 'project',
      tsconfig: 'project/tsconfig.json',
      runtime: { kind },
      totals: { files: 4, bytes: sizes.reduce((sum, size) => sum + size, 0) },
      skipped: { outside: 1, missing: 0 },
    })
    expect(body.skipped.library).toBeGreaterThan(0)
    expect(
      body.files.toSorted((left: { path: string }, right: { path: string }) =>
        left.path.localeCompare(right.path),
      ),
    ).toEqual(expected.map((file, index) => ({ path: file, size: sizes[index] })))
  },
)

test('refuses a root the server has not opened', async ({ workspace }) => {
  await writeProject(workspace, 'typescript')
  const app = workspace.openApp()

  const response = await programFiles(app, 'project', 'project/tsconfig.json')
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ error: { code: 'lsp.PROGRAM_ROOT_NOT_OPEN' } })
})

test('refuses a tsconfig outside the root', async ({ workspace }) => {
  await writeProject(workspace, 'typescript')
  const app = workspace.openApp()
  await request(app, '/fs/workspace-address', { path: 'project' })

  const response = await programFiles(app, 'project', 'elsewhere/tsconfig.json')
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({
    error: { code: 'lsp.PROGRAM_TSCONFIG_OUTSIDE_ROOT' },
  })
})

test('reports a project the compiler cannot list', async ({ workspace }) => {
  await writeProject(workspace, 'typescript')
  await writeFile(path.join(workspace.root, 'project/empty.json'), '{"include":["nothing"]}')
  const app = workspace.openApp()
  await request(app, '/fs/workspace-address', { path: 'project' })

  const response = await programFiles(app, 'project', 'project/empty.json')
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({ error: { code: 'lsp.PROGRAM_LIST_FAILED' } })
})

test('reads the listed files in one response, under the same rule as /fs/read', async ({
  workspace,
}) => {
  await writeProject(workspace, 'typescript')
  const app = workspace.openApp()
  const paths = [
    'project/src/a.ts',
    'project/node_modules/dep/index.d.ts',
    'project/node_modules/far/index.d.ts',
    'project/src/key.ts',
    'project/src/gone.ts',
    '../escape.ts',
  ]

  const response = await request(app, '/lsp/typescript/program-files/read', { paths })
  expect(response.status).toBe(200)
  const body = await response.json()

  const single = await (await request(app, '/fs/read?path=project%2Fsrc%2Fa.ts')).json()
  expect(body.files).toEqual(
    expect.arrayContaining([
      {
        path: 'project/src/a.ts',
        content: single.content,
        size: single.size,
        version: single.version,
        diskVersion: `stat:${single.mtimeMs}:${single.size}`,
        dependencies: expect.any(String),
      },
      expect.objectContaining({ path: 'project/node_modules/dep/index.d.ts' }),
      expect.objectContaining({
        path: 'project/src/key.ts',
        content: PROJECT_FILES['project/src/key.ts'],
      }),
    ]),
  )
  expect(body.totals.files).toBe(3)
  expect(
    body.failed.toSorted((left: { path: string }, right: { path: string }) =>
      left.path.localeCompare(right.path),
    ),
  ).toEqual([
    { path: '../escape.ts', code: 'PATH_OUTSIDE_WORKSPACE' },
    { path: 'project/node_modules/far/index.d.ts', code: 'PATH_OUTSIDE_WORKSPACE' },
    { path: 'project/src/gone.ts', code: 'NOT_FOUND' },
  ])
})

test('prepares worker roots, inherited options and logical dependency paths', async ({
  workspace,
}) => {
  await writeProject(workspace, 'typescript-language-service')
  await mkdir(path.join(workspace.root, 'shared'), { recursive: true })
  await writeFile(
    path.join(workspace.root, 'shared/package.json'),
    '{"name":"linked","types":"index.d.ts"}',
  )
  await writeFile(
    path.join(workspace.root, 'shared/index.d.ts'),
    'export declare const linked: string',
  )
  await symlink(
    path.join(workspace.root, 'shared'),
    path.join(workspace.root, 'project/node_modules/linked'),
  )
  await writeFile(
    path.join(workspace.root, 'project/src/a.ts'),
    "import { linked } from 'linked'; export const value = linked",
  )
  await writeFile(
    path.join(workspace.root, 'project/base.json'),
    '{"compilerOptions":{"strict":true,"baseUrl":".","moduleResolution":"bundler","module":"esnext"}}',
  )
  await writeFile(
    path.join(workspace.root, 'project/tsconfig.json'),
    '{"files":[],"references":[{"path":"./tsconfig.app.json"}]}',
  )
  await writeFile(
    path.join(workspace.root, 'project/tsconfig.app.json'),
    '{"extends":"./base.json","include":["src"]}',
  )
  const app = workspace.openApp()
  await request(app, '/fs/workspace-address', { path: 'project' })
  const response = await request(
    app,
    '/lsp/typescript/program-files?root=project&file=project/src/a.ts&worker=true',
  )
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.tsconfig).toBe('project/tsconfig.app.json')
  expect(body.worker).toMatchObject({ compilerOptions: { strict: true, baseUrl: '/project' } })
  expect(body.worker.roots).toContain('/project/src/a.ts')
  expect(body.files.map((file: { path: string }) => file.path)).toEqual(
    expect.arrayContaining([
      'project/node_modules/linked/index.d.ts',
      'project/node_modules/linked/package.json',
    ]),
  )
  const read = await request(app, '/lsp/typescript/program-files/read', {
    paths: ['project/node_modules/linked/index.d.ts'],
  })
  expect(await read.json()).toMatchObject({
    files: [
      {
        path: 'project/node_modules/linked/index.d.ts',
        content: 'export declare const linked: string',
      },
    ],
  })
})

test('stops batch reads at the requested byte budget', async ({ workspace }) => {
  await writeFile(path.join(workspace.root, 'first.ts'), 'éé')
  await writeFile(path.join(workspace.root, 'second.ts'), 'abc')
  await writeFile(path.join(workspace.root, 'third.ts'), 'z')
  const response = await request(workspace.openApp(), '/lsp/typescript/program-files/read', {
    paths: ['first.ts', 'second.ts', 'third.ts'],
    maxBytes: 5,
  })
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.files.map((file: { path: string }) => file.path)).toEqual(['first.ts'])
  expect(result.totals.bytes).toBe(4)
  expect(result.failed).toEqual([
    { path: 'second.ts', code: 'PROGRAM_READ_LIMIT' },
    { path: 'third.ts', code: 'PROGRAM_READ_LIMIT' },
  ])
})

test('keeps a file over the per-file cap distinct from the shared budget', async ({
  workspace,
}) => {
  await writeFile(path.join(workspace.root, 'first.ts'), 'ab')
  await writeFile(path.join(workspace.root, 'big.ts'), 'abcdef')
  await writeFile(path.join(workspace.root, 'small.ts'), 'c')
  const result = await readProgramFiles(
    { paths: createWorkspacePaths(workspace.root), maxTextFileBytes: 4 } as ProgramFileSystem,
    ['first.ts', 'big.ts', 'small.ts'],
    5,
  )
  expect(result.failed).toEqual([{ path: 'big.ts', code: 'FILE_TOO_LARGE' }])
  expect(result.files.map((file) => file.path)).toEqual(['first.ts', 'small.ts'])
})

test('rejects read budgets above the server ceiling', async ({ workspace }) => {
  const response = await request(workspace.openApp(), '/lsp/typescript/program-files/read', {
    paths: [],
    maxBytes: 256 * 1024 * 1024 + 1,
  })
  expect(response.status).toBe(400)
})

test('keeps project discovery context across the child process boundary', async ({ workspace }) => {
  const { discoverWorkerProject } = await import('../typescript/worker-discovery')
  await expect(
    discoverWorkerProject(workspace.root, workspace.root, 'missing.ts'),
  ).rejects.toMatchObject({
    code: 'lsp.PROGRAM_NO_PROJECT',
    internal: expect.objectContaining({
      documentPath: 'missing.ts',
      rootPath: workspace.root,
      reason: 'No project configuration',
    }),
  })
})

test('resolves a shared project identity and include filters without running the compiler listing', async ({
  workspace,
}) => {
  await writeProject(workspace, 'typescript')
  const app = workspace.openApp()
  await request(app, '/fs/workspace-address', { path: 'project' })
  const query = new URLSearchParams({ root: 'project', file: 'project/src/a.ts' })
  const response = await request(app, `/lsp/typescript/project?${query}`)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    config: '/project/tsconfig.json',
    roots: expect.arrayContaining(['/project/src/a.ts', '/project/src/b.ts']),
    watch: {
      include: ['/project/src'],
      configFiles: expect.arrayContaining(['/project/tsconfig.json']),
    },
  })
})

test('resolves a project opened through a linked folder', async ({ workspace }) => {
  await writeProject(workspace, 'typescript')
  await symlink(path.join(workspace.root, 'project'), path.join(workspace.root, 'linked'), 'dir')
  const app = workspace.openApp()
  await request(app, '/fs/workspace-address', { path: 'linked' })
  const query = new URLSearchParams({ root: 'linked', file: 'linked/src/a.ts' })
  const response = await request(app, `/lsp/typescript/project?${query}`)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ config: '/project/tsconfig.json' })
})

test('checks unchanged disk versions without retransmitting text and reports changed dependency sets', async ({
  workspace,
}) => {
  const first = path.join(workspace.root, 'first.ts')
  await writeFile(first, 'import { value } from "./other"; value')
  const app = workspace.openApp()
  const initial = await (
    await request(app, '/lsp/typescript/program-files/read', { paths: ['first.ts'] })
  ).json()
  const loaded = initial.files[0]
  const unchanged = await (
    await request(app, '/lsp/typescript/program-files/read', {
      paths: ['first.ts'],
      versions: { 'first.ts': loaded.diskVersion },
      maxBytes: 1,
    })
  ).json()
  expect(unchanged.files).toEqual([])
  expect(unchanged.unchanged).toEqual(['first.ts'])
  await writeFile(first, 'import { value } from "./other"; value + 1')
  const edited = await (
    await request(app, '/lsp/typescript/program-files/read', { paths: ['first.ts'] })
  ).json()
  expect(edited.files[0].dependencies).toBe(loaded.dependencies)
  await writeFile(first, 'import { value } from "./new"; value')
  const imported = await (
    await request(app, '/lsp/typescript/program-files/read', { paths: ['first.ts'] })
  ).json()
  expect(imported.files[0].dependencies).not.toBe(loaded.dependencies)
})

test('resolves an established config after its original editor file is deleted', async ({
  workspace,
}) => {
  await writeProject(workspace, 'typescript')
  const app = workspace.openApp()
  await request(app, '/fs/workspace-address', { path: 'project' })
  await rm(path.join(workspace.root, 'project/src/a.ts'))
  const query = new URLSearchParams({
    root: 'project',
    file: 'project/src/a.ts',
    tsconfig: 'project/tsconfig.json',
  })
  const response = await request(app, `/lsp/typescript/project?${query}`)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    roots: expect.arrayContaining(['/project/src/b.ts']),
  })
})

test('project metadata changes when compiler options change with identical roots', async ({
  workspace,
}) => {
  await writeProject(workspace, 'typescript')
  const app = workspace.openApp()
  await request(app, '/fs/workspace-address', { path: 'project' })
  const query = new URLSearchParams({ root: 'project', file: 'project/src/a.ts' })
  const before = await (await request(app, `/lsp/typescript/project?${query}`)).json()
  const config = path.join(workspace.root, 'project/tsconfig.json')
  const changed = JSON.parse(await readFile(config, 'utf8'))
  changed.compilerOptions.strict = false
  await writeFile(config, JSON.stringify(changed))
  const after = await (await request(app, `/lsp/typescript/project?${query}`)).json()
  expect(after.roots).toEqual(before.roots)
  expect(after.optionsVersion).not.toBe(before.optionsVersion)
})

test('package entry changes invalidate the dependency signature', async ({ workspace }) => {
  const manifest = path.join(workspace.root, 'package.json')
  await writeFile(manifest, '{"types":"old.d.ts"}')
  const app = workspace.openApp()
  const before = await (
    await request(app, '/lsp/typescript/program-files/read', { paths: ['package.json'] })
  ).json()
  await writeFile(manifest, '{"types":"new.d.ts"}')
  const after = await (
    await request(app, '/lsp/typescript/program-files/read', { paths: ['package.json'] })
  ).json()
  expect(after.files[0].dependencies).not.toBe(before.files[0].dependencies)
})
