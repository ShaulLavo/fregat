import type ts from 'typescript-language-service'
import path from 'node:path'
import * as v from 'valibot'
import { runBoundedProcess } from '../../git/utils/process'
import { lspErrors } from '../errors'

const resultSchema = v.object({
  config: v.string(),
  roots: v.array(v.string()),
  files: v.array(v.string()),
  options: v.custom<ts.CompilerOptions>(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  ),
  runtime: v.object({
    kind: v.union([v.literal('native'), v.literal('legacy')]),
    version: v.string(),
  }),
})

export async function discoverWorkerProject(
  root: string,
  filesystemRoot: string,
  document: string,
) {
  const result = await runBoundedProcess({
    argv: [process.execPath, path.join(import.meta.dirname, 'worker-discovery-process.ts')],
    cwd: root,
    input: JSON.stringify({ root, filesystemRoot, document }),
    timeoutMs: 60_000,
    maxOutputBytes: 16 * 1024 * 1024,
  })
  if (result.limit)
    throw lspErrors.PROGRAM_LIST_LIMIT({ internal: { limit: result.limit, root, document } })
  if (result.exitCode !== 0)
    throw lspErrors.PROGRAM_LIST_FAILED({ internal: { root, document, reason: result.stderr } })
  return v.parse(resultSchema, JSON.parse(result.stdout))
}
