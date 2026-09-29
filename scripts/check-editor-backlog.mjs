import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = resolve(root, 'plans')
const manifest = JSON.parse(readFileSync(resolve(directory, 'backlog.json'), 'utf8'))
const problems = []
const plans = new Map()
const files = new Set()
const coverage = new Set()
const sections = [
  'Outcome',
  'Current code',
  'Scope',
  'Design',
  'Steps',
  'Verification',
  'Risks and decisions',
]
const indexPath = resolve(directory, 'README.md')
const index = readFileSync(indexPath, 'utf8')
const rows = index
  .split('\n')
  .filter((line) => line.startsWith('|'))
  .map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim()),
  )
const source = readFileSync(resolve(directory, manifest.source), 'utf8')
const topics = new Set([...source.matchAll(/^## (.+)$/gm)].map((match) => match[1]))

function check(condition, message) {
  if (!condition) problems.push(message)
}

function metadata(markdown, key) {
  return markdown.match(new RegExp(`^- ${key}: (.+)$`, 'm'))?.[1] ?? ''
}

function checkLinks(path, markdown) {
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '')
    if (/^(?:[a-z]+:|#)/i.test(target)) continue
    const file = decodeURIComponent(target.split('#')[0])
    check(existsSync(resolve(dirname(path), file)), `${path}: missing link target ${target}`)
  }
}

function checkPlan(plan) {
  check(/^E\d{3}$/.test(plan.id), `Invalid plan ID: ${plan.id}`)
  check(!plans.has(plan.id), `Duplicate plan ID: ${plan.id}`)
  plans.set(plan.id, plan)
  const referenced = plan.status === 'Completed' || plan.status === 'Moved'
  checkIndex(plan, referenced ? plan.reference : plan.file)
  check(plan.topics.length > 0, `${plan.id}: no source topic`)
  for (const topic of plan.topics) {
    check(topics.has(topic), `${plan.id}: unknown source topic ${topic}`)
    coverage.add(topic)
  }
  if (referenced) {
    checkReference(plan)
    return
  }
  checkExecutablePlan(plan)
}

// A Completed entry points at its permanent reference; a Moved entry at the plan that owns it now.
function checkReference(plan) {
  const kind = plan.status.toLowerCase()
  check(!Object.hasOwn(plan, 'file'), `${plan.id}: ${kind} entry must not have an executable file`)
  const reference = plan.reference
  const valid =
    typeof reference === 'string' && reference.startsWith('../') && reference.endsWith('.md')
  check(valid, `${plan.id}: ${kind} entry requires a relative Markdown reference outside plans`)
  if (!valid) return

  const path = resolve(directory, reference)
  check(!path.startsWith(directory + sep), `${plan.id}: ${kind} reference must be outside plans`)
  check(existsSync(path), `${plan.id}: missing reference ${reference}`)
  if (!existsSync(path)) return
  const isFile = statSync(path).isFile()
  check(isFile, `${plan.id}: ${kind} reference must be a file`)
  if (!isFile) return
  checkLinks(path, readFileSync(path, 'utf8'))
}

function checkExecutablePlan(plan) {
  check(
    !Object.hasOwn(plan, 'reference'),
    `${plan.id}: only Completed and Moved entries may use a reference`,
  )
  check(typeof plan.file === 'string', `${plan.id}: executable entry requires a plan file`)
  if (typeof plan.file !== 'string') return
  check(!files.has(plan.file), `Duplicate plan file: ${plan.file}`)
  check(
    plan.file.startsWith(`${plan.id.toLowerCase()}-`) && plan.file.endsWith('.md'),
    `${plan.id}: filename mismatch`,
  )
  files.add(plan.file)
  const path = resolve(directory, plan.file)
  check(existsSync(path), `${plan.id}: missing ${plan.file}`)
  if (!existsSync(path)) return

  const markdown = readFileSync(path, 'utf8')
  check(
    markdown.split('\n')[0] === `# ${plan.id}: ${plan.title}`,
    `${plan.id}: title differs from manifest`,
  )
  for (const key of ['Status', 'Kind', 'Owner', 'Priority', 'Effort']) {
    check(
      metadata(markdown, key) === plan[key.toLowerCase()],
      `${plan.id}: ${key} differs from manifest`,
    )
  }
  const baseline = plan.baseline ?? manifest.baseline
  check(/^[a-f0-9]{40}$/.test(baseline), `${plan.id}: invalid inspected baseline`)
  check(
    metadata(markdown, 'Inspected baseline').includes(baseline),
    `${plan.id}: missing inspected baseline`,
  )
  for (const section of sections) {
    check(markdown.includes(`\n## ${section}\n`), `${plan.id}: missing ${section} section`)
  }
  const dependencies = [
    ...new Set(metadata(markdown, 'Dependencies').match(/E\d{3}/g) ?? []),
  ].sort()
  check(
    JSON.stringify(dependencies) === JSON.stringify([...plan.dependsOn].sort()),
    `${plan.id}: dependency metadata differs`,
  )
  checkLinks(path, markdown)
}

function checkIndex(plan, target) {
  check(index.includes(`](${target})`), `${plan.id}: missing index link`)
  const row = rows.find((cells) => cells[0] === `[${plan.id} — ${plan.title}](${target})`)
  const expected = [plan.kind, plan.owner, plan.priority, plan.effort]
  check(
    JSON.stringify(row?.slice(1, 5)) === JSON.stringify(expected),
    `${plan.id}: index metadata differs`,
  )
  const indexDependencies = [...new Set(row?.[5]?.match(/E\d{3}/g) ?? [])].sort()
  check(
    JSON.stringify(indexDependencies) === JSON.stringify([...plan.dependsOn].sort()),
    `${plan.id}: index dependencies differ`,
  )
}

function visit(id, trail, complete) {
  check(!trail.includes(id), `Dependency cycle: ${[...trail, id].join(' -> ')}`)
  if (trail.includes(id) || complete.has(id)) return
  const plan = plans.get(id)
  if (!plan) return
  for (const dependency of plan.dependsOn) {
    check(plans.has(dependency), `${id}: unknown dependency ${dependency}`)
    visit(dependency, [...trail, id], complete)
  }
  complete.add(id)
}

check(manifest.schemaVersion === 2, 'Unsupported manifest schema')
check(/^[a-f0-9]{40}$/.test(manifest.baseline), 'Invalid inspected baseline')
for (const plan of manifest.plans) checkPlan(plan)
for (const topic of topics) {
  check(coverage.has(topic), `Unplanned source topic: ${topic}`)
  const row = rows.find((cells) => cells[0] === topic)
  const indexed = [...new Set(row?.[1]?.match(/E\d{3}/g) ?? [])].sort()
  const expected = manifest.plans
    .filter((plan) => plan.topics.includes(topic))
    .map((plan) => plan.id)
    .sort()
  check(
    JSON.stringify(indexed) === JSON.stringify(expected),
    `Index coverage differs for: ${topic}`,
  )
}
for (const file of readdirSync(directory)) {
  if (!/^e\d+-.*\.md$/.test(file)) continue
  check(files.has(file), `Plan absent from manifest: ${file}`)
}
const complete = new Set()
for (const id of plans.keys()) visit(id, [], complete)
for (const file of ['README.md', 'AUTHORING.md']) {
  const path = resolve(directory, file)
  checkLinks(path, readFileSync(path, 'utf8'))
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log(
    `Editor backlog: ${plans.size} entries; all ${topics.size} wishlist topics covered; dependencies acyclic; metadata and local links valid.`,
  )
}
