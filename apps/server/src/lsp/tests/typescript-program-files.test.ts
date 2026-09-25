import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'

import { test, workspaceRequest as request } from '../../../test/factories/workspace-address'

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
