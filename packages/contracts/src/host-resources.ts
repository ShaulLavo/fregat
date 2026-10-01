import * as v from 'valibot'

export const hostResourcesSchema = v.object({
  sampledAt: v.number(),
  cpuCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  cpuUtilization: v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
  totalMemoryBytes: v.pipe(v.number(), v.minValue(1)),
  availableMemoryBytes: v.pipe(v.number(), v.minValue(0)),
})
export type HostResources = v.InferOutput<typeof hostResourcesSchema>
