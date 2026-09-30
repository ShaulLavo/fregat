import { YAML } from 'bun'
import * as v from 'valibot'

const step = v.looseObject({
  name: v.optional(v.string()),
  id: v.optional(v.string()),
  run: v.optional(v.string()),
  with: v.optional(v.record(v.string(), v.unknown())),
})
const job = v.looseObject({
  if: v.optional(v.string()),
  needs: v.optional(v.union([v.string(), v.array(v.string())])),
  permissions: v.optional(v.record(v.string(), v.string()), {}),
  outputs: v.optional(v.record(v.string(), v.string()), {}),
  steps: v.array(step),
})
const workflow = v.looseObject({
  permissions: v.optional(v.record(v.string(), v.string()), {}),
  jobs: v.record(v.string(), job),
})

export type WorkflowJob = v.InferOutput<typeof job>
export function readWorkflow(source: string) {
  return v.parse(workflow, YAML.parse(source))
}
