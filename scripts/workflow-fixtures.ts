import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'

const runDefaults = v.object({
  run: v.object({ 'working-directory': v.optional(v.string()) }),
})

const workflowSchema = v.object({
  on: v.record(v.string(), v.unknown()),
  defaults: v.optional(runDefaults),
  jobs: v.record(
    v.string(),
    v.object({
      defaults: v.optional(runDefaults),
      steps: v.array(
        v.object({
          name: v.optional(v.string()),
          id: v.optional(v.string()),
          if: v.optional(v.string()),
          uses: v.optional(v.string()),
          run: v.optional(v.string()),
          'working-directory': v.optional(v.string()),
          with: v.optional(v.record(v.string(), v.unknown())),
        }),
      ),
    }),
  ),
})

export function readWorkflow(file: string) {
  const root = path.resolve(import.meta.dirname, '..')
  const source = readFileSync(path.join(root, '.github/workflows', file), 'utf8')
  return v.parse(workflowSchema, Bun.YAML.parse(source))
}
