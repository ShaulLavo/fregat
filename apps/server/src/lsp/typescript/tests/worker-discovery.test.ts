import { expect, test, vi } from 'vitest'
import { lspErrors } from '../../../observability/structured-errors'
const { run } = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('../../../git/utils/process', () => ({ runBoundedProcess: run }))
import { discoverWorkerProject } from '../worker-discovery'

test.each([
  ['PROGRAM_LIST_LIMIT', { limit: { kind: 'timeout' }, config: '/project/tsconfig.json' }],
  ['PROGRAM_TSCONFIG_OUTSIDE_ROOT', { root: '/project', config: '/elsewhere/tsconfig.json' }],
  ['PROGRAM_NO_PROJECT', { documentPath: 'project/a.ts', reason: 'No containing project' }],
  ['PROGRAM_LIST_FAILED', { config: '/project/tsconfig.json', exitCode: 2 }],
] as const)('preserves discovery code and internal fields for %s', async (code, internal) => {
  run.mockResolvedValueOnce({
    exitCode: 1,
    stdout: '',
    stderr: JSON.stringify({ code: `lsp.${code}`, internal }),
  })
  const catalog = lspErrors[code]({ internal })
  await expect(discoverWorkerProject('/project', '/', 'project/a.ts')).rejects.toMatchObject({
    code: catalog.code,
    status: catalog.status,
    internal: expect.objectContaining(internal),
  })
})
