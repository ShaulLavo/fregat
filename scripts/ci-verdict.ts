import { readFileSync } from 'node:fs'
import path from 'node:path'

type Result<T> = { ok: true; value: T } | { ok: false; issue: string }
type Event = 'pull_request' | 'push' | 'workflow_dispatch'
export type RunIdentity = {
  runId: number
  attempt: number
  headSha: string
  event: Event
  repository: string
  workflowPath: string
}
export type CiVerdictInput = {
  workflow: unknown
  needs: unknown
  pages: unknown
  run: unknown
  identity: RunIdentity
  readWorkflow: (file: string) => unknown
}
type NeedResult = 'success' | 'failure' | 'cancelled' | 'skipped'
type Predicate =
  | { kind: 'changes'; key: string }
  | { kind: 'input'; key: string }
  | { kind: 'dispatch' }
type Matrix = { key: string; values: readonly string[] } | { key: string; output: string }
type Job = {
  id: string
  name: string
  condition: readonly Predicate[] | null
  matrix: Matrix | null
  reusable: string | null
  inputs: Readonly<Record<string, readonly Predicate[] | { output: string }>>
}
type Workflow = { jobs: ReadonlyMap<string, Job>; needs: readonly string[]; verdictName: string }
type Context = {
  event: string
  results: ReadonlyMap<string, NeedResult>
  outputs: Readonly<Record<string, string>>
}
type ApiConclusion =
  | 'success'
  | 'skipped'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | 'startup_failure'
type ApiJob = { name: string; conclusion: ApiConclusion }
type ExpectedJob = { name: string; required: boolean }
export type Verdict = { passed: boolean; issues: readonly string[] }

function rejected(issue: string): Result<never> {
  return { ok: false, issue }
}

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return Object.fromEntries(Object.entries(value))
}

function strings(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return null
  return value
}

function condition(value: unknown): Result<readonly Predicate[] | null> {
  if (value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') return rejected('Workflow condition must be a string')
  const expression = value.match(/^\$\{\{\s*(.*?)\s*\}\}$/)?.[1]
  if (!expression) return rejected('Workflow condition has unsupported framing')
  const predicates: Predicate[] = []
  for (const term of expression.split(/\s*\|\|\s*/)) {
    const parsed = predicate(term)
    if (!parsed.ok) return parsed
    predicates.push(parsed.value)
  }
  return { ok: true, value: predicates }
}

function predicate(term: string): Result<Predicate> {
  const changes = term.match(/^needs\.changes\.outputs\.([\w]+) == 'true'$/)?.[1]
  if (changes) return { ok: true, value: { kind: 'changes', key: changes } }
  const input = term.match(/^inputs\.([\w]+)$/)?.[1]
  if (input) return { ok: true, value: { kind: 'input', key: input } }
  if (term === "github.event_name == 'workflow_dispatch'")
    return { ok: true, value: { kind: 'dispatch' } }
  return rejected('Workflow condition uses an unsupported expression')
}

function matrix(value: unknown): Result<Matrix | null> {
  if (value === undefined) return { ok: true, value: null }
  const strategy = record(value)
  const axes = record(strategy?.matrix)
  if (!axes || Object.keys(axes).length !== 1)
    return rejected('Workflow matrix must declare one supported axis')
  const entry = Object.entries(axes)[0]
  if (!entry) return rejected('Workflow matrix axis is missing')
  const [key, source] = entry
  const values = strings(source)
  if (values) return { ok: true, value: { key, values } }
  if (typeof source !== 'string') return rejected('Workflow matrix values are unsupported')
  const output = source.match(/^\$\{\{ fromJSON\(needs\.changes\.outputs\.([\w]+)\) \}\}$/)?.[1]
  if (!output) return rejected('Workflow matrix expression is unsupported')
  return { ok: true, value: { key, output } }
}

function parseJob(id: string, value: unknown): Result<Job> {
  const source = record(value)
  if (!source || typeof source.name !== 'string') return rejected(`Job ${id} needs a name`)
  const parsedCondition = condition(source.if)
  if (!parsedCondition.ok) return parsedCondition
  const parsedMatrix = matrix(source.strategy)
  if (!parsedMatrix.ok) return parsedMatrix
  const inputs: Record<string, readonly Predicate[] | { output: string }> = {}
  const supplied = source.with === undefined ? {} : record(source.with)
  if (!supplied) return rejected(`Job ${id} inputs must be an object`)
  for (const [key, expression] of Object.entries(supplied)) {
    const output =
      typeof expression === 'string'
        ? expression.match(/^\$\{\{ needs\.changes\.outputs\.([\w]+) \}\}$/)?.[1]
        : undefined
    if (output) {
      inputs[key] = { output }
      continue
    }
    const parsed = condition(expression)
    if (!parsed.ok || parsed.value === null)
      return rejected(`Job ${id} input ${key} is unsupported`)
    inputs[key] = parsed.value
  }
  if (source.uses !== undefined && typeof source.uses !== 'string')
    return rejected(`Job ${id} reusable workflow must be a string`)
  return {
    ok: true,
    value: {
      id,
      name: source.name,
      condition: parsedCondition.value,
      matrix: parsedMatrix.value,
      reusable: source.uses ?? null,
      inputs,
    },
  }
}

function parseWorkflow(value: unknown, aggregate: boolean): Result<Workflow> {
  const source = record(value)
  const jobs = record(source?.jobs)
  if (!jobs) return rejected('Workflow jobs must be an object')
  const verdict = aggregate ? record(jobs.verdict) : null
  const needs = aggregate ? strings(verdict?.needs) : Object.keys(jobs)
  if (!needs || needs.length === 0 || new Set(needs).size !== needs.length)
    return rejected('Workflow required-needs graph must contain unique job ids')
  if (aggregate && typeof verdict?.name !== 'string')
    return rejected('Aggregate job name is missing')
  const parsed = new Map<string, Job>()
  for (const id of needs) {
    const job = parseJob(id, jobs[id])
    if (!job.ok) return job
    parsed.set(id, job.value)
  }
  return {
    ok: true,
    value: {
      jobs: parsed,
      needs,
      verdictName: typeof verdict?.name === 'string' ? verdict.name : '',
    },
  }
}

function needResult(value: unknown): Result<NeedResult> {
  switch (value) {
    case 'success':
    case 'failure':
    case 'cancelled':
    case 'skipped':
      return { ok: true, value }
    default:
      return rejected('Required need has an unknown result state')
  }
}

function parseContext(value: unknown, graph: Workflow, event: string): Result<Context> {
  const source = record(value)
  if (!source) return rejected('Needs input must be an object')
  const results = new Map<string, NeedResult>()
  for (const id of graph.needs) {
    const need = record(source[id])
    if (!need) return rejected(`Required need ${id} is missing`)
    const parsed = needResult(need.result)
    if (!parsed.ok) return rejected(`Required need ${id} has an unknown result state`)
    results.set(id, parsed.value)
  }
  const changes = record(source.changes)
  const rawOutputs = record(changes?.outputs)
  if (!rawOutputs) return rejected('Changes outputs are missing')
  const outputs: Record<string, string> = {}
  for (const [key, output] of Object.entries(rawOutputs)) {
    if (typeof output !== 'string') return rejected('Changes output must be a string')
    outputs[key] = output
  }
  if (!['pull_request', 'push', 'workflow_dispatch'].includes(event))
    return rejected('Workflow event is unsupported')
  return { ok: true, value: { event, results, outputs } }
}

function evaluateCondition(
  predicates: readonly Predicate[] | null,
  context: Context,
  inputs: Readonly<Record<string, boolean | string>>,
): Result<boolean> {
  if (predicates === null) return { ok: true, value: true }
  let enabled = false
  for (const term of predicates) {
    const result = evaluatePredicate(term, context, inputs)
    if (!result.ok) return result
    enabled ||= result.value
  }
  return { ok: true, value: enabled }
}

function evaluatePredicate(
  term: Predicate,
  context: Context,
  inputs: Readonly<Record<string, boolean | string>>,
): Result<boolean> {
  switch (term.kind) {
    case 'dispatch':
      return { ok: true, value: context.event === 'workflow_dispatch' }
    case 'input': {
      const value = inputs[term.key]
      return typeof value === 'boolean'
        ? { ok: true, value }
        : rejected('Reusable input is missing')
    }
    case 'changes': {
      const value = context.outputs[term.key]
      if (value !== 'true' && value !== 'false')
        return rejected('Changes flag is missing or invalid')
      return { ok: true, value: value === 'true' }
    }
    default: {
      const exhaustive: never = term
      return exhaustive
    }
  }
}

function matrixValues(axis: Matrix, context: Context): Result<readonly string[]> {
  if ('values' in axis) return { ok: true, value: axis.values }
  const source = context.outputs[axis.output]
  if (!source) return rejected('Matrix output is missing')
  try {
    const values = strings(JSON.parse(source))
    if (!values || values.length === 0 || new Set(values).size !== values.length)
      return rejected('Matrix output must contain unique string values')
    return { ok: true, value: values }
  } catch {
    return rejected('Matrix output is invalid JSON')
  }
}

function jobNames(job: Job, context: Context): Result<readonly string[]> {
  if (!job.matrix)
    return job.name.includes('${{')
      ? rejected('Job name expression is unsupported')
      : { ok: true, value: [job.name] }
  const values = matrixValues(job.matrix, context)
  if (!values.ok) return values
  const token = '${{ matrix.' + job.matrix.key + ' }}'
  if (!job.name.includes(token) || job.name.replace(token, '').includes('${{'))
    return rejected('Matrix job name must use its declared axis')
  return { ok: true, value: values.value.map((value) => job.name.replace(token, value)) }
}

function reusableInputs(
  job: Job,
  context: Context,
): Result<Readonly<Record<string, boolean | string>>> {
  const inputs: Record<string, boolean | string> = {}
  for (const [key, expression] of Object.entries(job.inputs)) {
    if ('output' in expression) {
      const value = context.outputs[expression.output]
      if (typeof value !== 'string') return rejected('Reusable output input is missing')
      inputs[key] = value
      continue
    }
    const result = evaluateCondition(expression, context, {})
    if (!result.ok) return result
    inputs[key] = result.value
  }
  return { ok: true, value: inputs }
}

function expectedJobs(
  job: Job,
  context: Context,
  readWorkflow: (file: string) => unknown,
): Result<readonly ExpectedJob[]> {
  const enabled = evaluateCondition(job.condition, context, {})
  if (!enabled.ok) return enabled
  const result = context.results.get(job.id)
  if (enabled.value && result !== 'success')
    return rejected(`Required need ${job.id} did not succeed`)
  if (!enabled.value && result !== 'skipped')
    return rejected(`Disabled need ${job.id} must be skipped`)
  if (!enabled.value) return { ok: true, value: [] }
  if (!job.reusable) {
    const names = jobNames(job, context)
    return names.ok
      ? { ok: true, value: names.value.map((name) => ({ name, required: true })) }
      : names
  }
  if (!/^\.\/\.github\/workflows\/[\w.-]+\.yml$/.test(job.reusable))
    return rejected('Reusable workflow must be a supported local file')
  const workflow = parseWorkflow(readWorkflow(job.reusable), false)
  if (!workflow.ok) return workflow
  const inputs = reusableInputs(job, context)
  if (!inputs.ok) return inputs
  const jobs: ExpectedJob[] = []
  for (const child of workflow.value.jobs.values()) {
    const expanded = expectedChild(job.name, child, context, inputs.value)
    if (!expanded.ok) return expanded
    jobs.push(expanded.value)
  }
  return { ok: true, value: jobs }
}

function expectedChild(
  parent: string,
  child: Job,
  context: Context,
  inputs: Readonly<Record<string, boolean | string>>,
): Result<ExpectedJob> {
  if (child.matrix || child.reusable || child.name.includes('${{'))
    return rejected('Reusable child graph is unsupported')
  const enabled = evaluateCondition(child.condition, context, inputs)
  if (!enabled.ok) return enabled
  return { ok: true, value: { name: `${parent} / ${child.name}`, required: enabled.value } }
}

function apiConclusion(value: unknown): Result<ApiConclusion> {
  switch (value) {
    case 'success':
    case 'skipped':
    case 'failure':
    case 'cancelled':
    case 'timed_out':
    case 'action_required':
    case 'neutral':
    case 'stale':
    case 'startup_failure':
      return { ok: true, value }
    default:
      return rejected('Job API conclusion is unknown or missing')
  }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function runIdentity(value: unknown, expected: RunIdentity): Result<RunIdentity> {
  const run = record(value)
  const repository = record(run?.repository)
  if (
    !run ||
    run.id !== expected.runId ||
    run.head_sha !== expected.headSha ||
    run.run_attempt !== expected.attempt ||
    run.event !== expected.event ||
    typeof run.path !== 'string' ||
    run.path.split('@')[0] !== expected.workflowPath ||
    typeof repository?.full_name !== 'string' ||
    repository.full_name.toLowerCase() !== expected.repository.toLowerCase()
  )
    return rejected('Workflow run identity differs from the current workflow context')
  return { ok: true, value: expected }
}

function parseApiJob(
  value: unknown,
  aggregate: string,
  identity: RunIdentity,
): Result<ApiJob | null> {
  const job = record(value)
  if (!job || typeof job.name !== 'string') return rejected('Job API record needs a name')
  if (
    job.run_id !== identity.runId ||
    job.head_sha !== identity.headSha ||
    !positiveInteger(job.run_attempt) ||
    job.run_attempt > identity.attempt
  )
    return rejected(`Job ${job.name} has stale or foreign run identity`)
  if (job.name === aggregate) return { ok: true, value: null }
  if (job.status !== 'completed') return rejected(`Job ${job.name} is not terminal`)
  const conclusion = apiConclusion(job.conclusion)
  if (!conclusion.ok) return rejected(`Job ${job.name} has an unknown or missing conclusion`)
  if (
    conclusion.value === 'success' &&
    (!positiveInteger(job.runner_id) ||
      typeof job.started_at !== 'string' ||
      !Number.isFinite(Date.parse(job.started_at)))
  )
    return rejected(`Job ${job.name} lacks evidence of a started runner`)
  return { ok: true, value: { name: job.name, conclusion: conclusion.value } }
}

function parseJobPage(
  value: unknown,
  aggregate: string,
  identity: RunIdentity,
): Result<readonly ApiJob[]> {
  const rows = record(value)?.jobs
  if (!Array.isArray(rows)) return rejected('Job API page needs a jobs array')
  const jobs: ApiJob[] = []
  for (const row of rows) {
    const parsed = parseApiJob(row, aggregate, identity)
    if (!parsed.ok) return parsed
    if (parsed.value) jobs.push(parsed.value)
  }
  return { ok: true, value: jobs }
}

function parseJobs(
  value: unknown,
  aggregate: string,
  identity: RunIdentity,
): Result<readonly ApiJob[]> {
  if (!Array.isArray(value) || value.length === 0) return rejected('Job API pages are missing')
  const jobs: ApiJob[] = []
  for (const page of value) {
    const parsed = parseJobPage(page, aggregate, identity)
    if (!parsed.ok) return parsed
    jobs.push(...parsed.value)
  }
  return { ok: true, value: jobs }
}

function checkJobs(expected: readonly ExpectedJob[], actual: readonly ApiJob[]): Verdict {
  const issues: string[] = []
  for (const job of actual) {
    if (job.conclusion !== 'success' && job.conclusion !== 'skipped')
      issues.push(`Job ${job.name} lacks an accepted terminal conclusion`)
  }
  for (const job of expected) {
    const matches = actual.filter((entry) => entry.name === job.name)
    if (!job.required) {
      if (matches.some((entry) => entry.conclusion !== 'skipped'))
        issues.push(`Disabled job ${job.name} must be skipped`)
      continue
    }
    if (matches.length !== 1 || matches[0]?.conclusion !== 'success')
      issues.push(`Required job ${job.name} lacks one successful execution`)
  }
  return { passed: issues.length === 0, issues }
}

export function ciVerdict(input: CiVerdictInput): Verdict {
  const identity = runIdentity(input.run, input.identity)
  if (!identity.ok) return { passed: false, issues: [identity.issue] }
  const graph = parseWorkflow(input.workflow, true)
  if (!graph.ok) return { passed: false, issues: [graph.issue] }
  const context = parseContext(input.needs, graph.value, identity.value.event)
  if (!context.ok) return { passed: false, issues: [context.issue] }
  const actual = parseJobs(input.pages, graph.value.verdictName, identity.value)
  if (!actual.ok) return { passed: false, issues: [actual.issue] }
  const expected: ExpectedJob[] = []
  for (const job of graph.value.jobs.values()) {
    const expanded = expectedJobs(job, context.value, input.readWorkflow)
    if (!expanded.ok) return { passed: false, issues: [expanded.issue] }
    expected.push(...expanded.value)
  }
  return checkJobs(expected, actual.value)
}

function contextIdentity(workflowPath: string): Result<RunIdentity> {
  const runId = Number(process.env.RUN_ID)
  const attempt = Number(process.env.RUN_ATTEMPT)
  const headSha = process.env.CI_SOURCE_SHA
  const repository = process.env.GH_REPO
  const event = process.env.GITHUB_EVENT_NAME
  if (
    !positiveInteger(runId) ||
    !positiveInteger(attempt) ||
    !headSha ||
    !/^[a-f0-9]{40}$/.test(headSha) ||
    !repository ||
    (event !== 'pull_request' && event !== 'push' && event !== 'workflow_dispatch')
  )
    return rejected('CI verdict workflow identity metadata is missing or invalid')
  return { ok: true, value: { runId, attempt, headSha, repository, event, workflowPath } }
}

function main(): Verdict {
  const [workflowFile, jobsFile, runFile] = process.argv.slice(2)
  if (!workflowFile || !jobsFile || !runFile || !process.env.CI_NEEDS_JSON)
    return { passed: false, issues: ['CI verdict needs workflow, jobs, run and needs metadata'] }
  const root = path.resolve(path.dirname(workflowFile), '../..')
  const workflowPath = path.relative(root, path.resolve(workflowFile)).split(path.sep).join('/')
  const identity = contextIdentity(workflowPath)
  if (!identity.ok) return { passed: false, issues: [identity.issue] }
  const read = (file: string): unknown =>
    Bun.YAML.parse(readFileSync(path.resolve(root, file), 'utf8'))
  return ciVerdict({
    workflow: Bun.YAML.parse(readFileSync(workflowFile, 'utf8')),
    needs: JSON.parse(process.env.CI_NEEDS_JSON),
    pages: JSON.parse(readFileSync(jobsFile, 'utf8')),
    run: JSON.parse(readFileSync(runFile, 'utf8')),
    identity: identity.value,
    readWorkflow: read,
  })
}

if (import.meta.main) {
  try {
    const verdict = main()
    for (const issue of verdict.issues) console.error(`::error::${issue}`)
    process.exitCode = verdict.passed ? 0 : 1
  } catch {
    console.error('::error::CI verdict input could not be parsed')
    process.exitCode = 1
  }
}
