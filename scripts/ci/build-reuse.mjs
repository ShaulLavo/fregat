import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { release, tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { readWorkspaceGraph, requiredLibraries } from './affected.mjs'

const schema = 'fregat-ci-ws-v2'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const cacheDirectory = '.turbo/ci-builds'
const receiptFile = '.turbo/workspace-builds-receipt.json'
const sitePackages = {
  fregat: 'site',
  singapore: 'singapore-editor-site',
  demo: '@singapore-editor/example-app',
  'ghostty-webgpu': 'ghostty-webgpu-site',
}

function targets(graph, source) {
  if (source === 'all') return Array.from(graph.packages.keys())
  if (source === 'editor')
    return Array.from(graph.packages.values())
      .filter((pkg) => pkg.directory.startsWith('packages/singapore/'))
      .map((pkg) => pkg.name)
  if (!source.startsWith('sites:')) return JSON.parse(source)
  const sites = source.slice(6).split(',').filter(Boolean)
  assert(
    sites.every((name) => Object.hasOwn(sitePackages, name)),
    'Unknown CI site target',
  )
  return sites.map((name) => sitePackages[name])
}

export function planBuilds(graph, changes) {
  const enabled = (key) => changes[key] === 'true'
  let names = []
  if (enabled('shared') || enabled('tooling'))
    names = names.concat(targets(graph, enabled('tooling') ? 'all' : changes.packages))
  if (enabled('web') || enabled('tree') || enabled('tooling')) names = names.concat(['web'])
  if (enabled('server')) names = names.concat(['server'])
  if (enabled('tui')) names = names.concat(['tui'])
  if (enabled('editor')) names = names.concat(targets(graph, 'editor'))
  if (enabled('ghostty'))
    names = names.concat(['ghostty-webgpu', 'ghostty-webgpu-line-editor', 'ghostty-webgpu-shaders'])
  if (enabled('site')) names = names.concat(targets(graph, `sites:${changes.sites}`))
  return requiredLibraries(graph, names)
}

function safePath(file) {
  assert(
    typeof file === 'string' && file.length > 0 && !file.includes('\\') && !file.includes('\0'),
    'Invalid bundle path',
  )
  assert(!path.posix.isAbsolute(file) && !/^[A-Za-z]:/.test(file), 'Absolute bundle path')
  assert(
    file
      .split('/')
      .every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.env')),
    'Unsafe bundle path',
  )
  return file
}

function filesBelow(directory, prefix = '') {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const file = prefix ? `${prefix}/${name}` : name
      const stat = lstatSync(path.join(directory, name))
      assert(!stat.isSymbolicLink(), 'Bundle contains a link')
      if (stat.isDirectory()) return filesBelow(path.join(directory, name), file)
      assert(stat.isFile() && stat.nlink === 1, 'Bundle must contain regular files')
      return [file]
    })
}

function inputSeal(root, graph) {
  const directories = Array.from(graph.packages.values(), (pkg) => `${pkg.directory}/`)
  const files = git(root, 'ls-files', '-z')
    .split('\0')
    .filter(Boolean)
    .filter((file) => {
      if (!directories.some((directory) => file.startsWith(directory))) return true
      if (graph.globalInputs.some((pattern) => new Bun.Glob(pattern).match(file))) return true
      return /(^|\/)(package\.json|turbo\.json|tsconfig[^/]*\.json|\.env[^/]*)$/.test(file)
    })
  return digest(
    JSON.stringify(
      files.map((file) => {
        const source = path.join(root, file)
        const bytes = lstatSync(source).isSymbolicLink()
          ? readlinkSync(source)
          : readFileSync(source)
        return [file, digest(bytes)]
      }),
    ),
  )
}

function environmentSeal(root, graph) {
  const global = JSON.parse(readFileSync(path.join(root, 'turbo.json'), 'utf8')).globalEnv ?? []
  const values = global.toSorted().map((name) => [name, process.env[name] ?? null])
  const directories = [''].concat(Array.from(graph.packages.values(), (pkg) => pkg.directory))
  const files = directories.flatMap((directory) =>
    Array.from(
      new Bun.Glob('.env*').scanSync({ cwd: path.join(root, directory), onlyFiles: true }),
      (file) => path.posix.join(directory, file),
    ),
  )
  return digest(
    JSON.stringify(
      values.concat(
        files.sort().map((file) => [file, digest(readFileSync(path.join(root, file)))]),
      ),
    ),
  )
}

function imageOS(image) {
  const match = typeof image === 'string' && image.match(/^([a-z][a-z0-9-]*)\/(\d[\d.]+)$/)
  assert(match, 'Missing or invalid runner image provenance')
  return match[1]
}

// Image patch stamps are provenance; these generated outputs bind to the live OS and toolchain.
function platformIdentity(runtime) {
  assert.equal(runtime.platform, process.platform, 'Node/Bun operating systems differ')
  assert.equal(runtime.arch, process.arch, 'Node/Bun architectures differ')
  const distribution =
    process.platform === 'linux' ? parseEnv(readFileSync('/etc/os-release', 'utf8')) : null
  const system = distribution
    ? { distribution: distribution.ID, version: distribution.VERSION_ID, libc: runtime.libc }
    : { release: release() }
  assert(
    Object.values(system).every((value) => typeof value === 'string' && value.length > 0),
    'Missing operating system compatibility metadata',
  )
  return { os: process.platform, arch: process.arch, system }
}

function identity(root, graph, context) {
  assert(/^[\w.-]+\/[\w.-]+$/.test(context.repository), 'Missing repository identity')
  assert(
    /^[1-9]\d*$/.test(context.run) && Number.isSafeInteger(context.attempt) && context.attempt > 0,
    'Invalid run identity',
  )
  assert(/^[a-f0-9]{40}$/.test(context.source), 'Invalid source identity')
  assert(
    [context.os, context.arch].every((part) => typeof part === 'string' && part.length > 0),
    'Missing platform identity',
  )
  assert(
    /^[A-Za-z0-9]+$/.test(context.os) && /^[A-Za-z0-9]+$/.test(context.arch),
    'Invalid platform namespace',
  )
  const runtime = JSON.parse(
    execFileSync(
      'node',
      [
        '-e',
        `
    process.stdout.write(JSON.stringify({
      version: process.version, platform: process.platform, arch: process.arch,
      libc: process.report.getReport().header.glibcVersionRuntime,
    }))
  `,
      ],
      { encoding: 'utf8' },
    ),
  )
  const toolchain = {
    bun: Bun.version,
    bunRevision: Bun.revision,
    node: runtime.version,
    turbo: JSON.parse(readFileSync(path.join(root, 'node_modules/turbo/package.json'), 'utf8'))
      .version,
  }
  assert(
    Object.values(toolchain).every((value) => typeof value === 'string' && value.length > 0),
    'Missing build toolchain metadata',
  )
  return {
    schema,
    repository: context.repository,
    checkout: git(root, 'rev-parse', 'HEAD'),
    tree: git(root, 'rev-parse', 'HEAD^{tree}'),
    source: context.source,
    run: context.run,
    os: context.os,
    arch: context.arch,
    imageOS: imageOS(context.image),
    platform: platformIdentity(runtime),
    toolchain,
    environment: environmentSeal(root, graph),
    inputs: inputSeal(root, graph),
  }
}

export function prepare({ root, temporary = tmpdir(), selection, targets: source, context }) {
  const graph = readWorkspaceGraph(root)
  const libraries = selection
    ? planBuilds(graph, selection)
    : requiredLibraries(graph, targets(graph, source))
  const seal = identity(root, graph, context)
  const namespace = `${schema}-${seal.os}-${seal.arch}-${seal.run}-${seal.checkout}-a`
  const cachePrefix = `${schema}-${digest(JSON.stringify([seal.os, seal.arch, seal.imageOS, seal.platform, seal.toolchain, seal.environment, seal.inputs]))}-`
  mkdirSync(temporary, { recursive: true })
  return {
    root,
    directory: mkdtempSync(path.join(temporary, 'workspace-builds-')),
    libraries,
    identity: seal,
    provenance: { image: context.image },
    attempt: context.attempt,
    artifactPattern: `${namespace}*`,
    namespace,
    cachePrefix,
    cacheKey: `${cachePrefix}${seal.tree}-${digest(JSON.stringify(libraries))}`,
  }
}

function turbo(root, libraries, extra) {
  return execFileSync(
    path.join(root, 'node_modules/.bin/turbo'),
    ['run', 'build', '--cache=local:rw', `--cache-dir=${cacheDirectory}`].concat(
      libraries.map((name) => `--filter=${name}`),
      extra,
    ),
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
    },
  )
}

function concreteBuildTasks(graph, tasks) {
  return tasks.filter((task) => {
    const pkg = graph.packages.get(task.package)
    assert(pkg && task.task === 'build', 'Unknown build task')
    if (pkg.scripts.build) return true
    assert(task.command === '<NONEXISTENT>', 'Unexpected command for a source-only workspace')
    return false
  })
}

function buildTasks(request) {
  const tasks = concreteBuildTasks(
    readWorkspaceGraph(request.root),
    JSON.parse(turbo(request.root, request.libraries, ['--dry=json'])).tasks,
  )
  assert.deepEqual(
    tasks.map((task) => task.package).sort(),
    request.libraries,
    'Turbo build closure differs from the selected graph',
  )
  for (const task of tasks) {
    assert(
      task.task === 'build' && task.command && /^[a-f0-9]{16}$/.test(task.hash),
      'Expected a concrete build task',
    )
    assert(task.resolvedTaskDefinition.cache === true, 'Build task must support local reuse')
  }
  return tasks.sort((a, b) => a.taskId.localeCompare(b.taskId))
}

function outputRoots(graph, task) {
  const pkg = graph.packages.get(task.package)
  assert(pkg, 'Unknown output owner')
  const outputs = task.resolvedTaskDefinition.outputs
  assert(Array.isArray(outputs) && outputs.length > 0, 'Build output declaration is empty')
  return outputs
    .map((output) => {
      const file = output.endsWith('/**') ? output.slice(0, -3) : output
      assert(!/[*?{}[\]!]/.test(file), 'Unsupported build output root')
      assert(!file.split('/').includes('node_modules'), 'Installed dependencies are not outputs')
      return safePath(path.posix.join(pkg.directory, safePath(file)))
    })
    .sort()
}

function under(file, roots) {
  return roots.some((root) => file === root || file.startsWith(`${root}/`))
}

function exportPaths(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportPaths)
}

function validateOutputs(graph, task, files) {
  const pkg = graph.packages.get(task.package)
  const roots = outputRoots(graph, task)
  assert(
    roots.every((root) => files.some((file) => under(file.path, [root]) && file.size > 0)),
    'Required build output root is empty',
  )
  const expected = exportPaths(pkg.manifest.exports).concat(
    exportPaths(pkg.manifest.main),
    exportPaths(pkg.manifest.module),
    exportPaths(pkg.manifest.types),
  )
  for (const file of expected) {
    const relative = file.replace(/^\.\//, '')
    if (!relative.startsWith('dist/')) continue
    const pattern = new Bun.Glob(path.posix.join(pkg.directory, relative))
    assert(
      files.some((entry) => pattern.match(entry.path)),
      `Required package export is missing: ${pkg.name}/${relative}`,
    )
  }
}

function outputFiles(root, roots) {
  return roots.flatMap((file) => {
    safePath(file)
    const stat = lstatSync(path.join(root, file))
    assert(!stat.isSymbolicLink(), 'Output root is a link')
    if (stat.isDirectory())
      return filesBelow(path.join(root, file)).map((child) => `${file}/${child}`)
    assert(stat.isFile() && stat.nlink === 1, 'Output root must be a regular file')
    return [file]
  })
}

function entry(root, file) {
  const stat = lstatSync(path.join(root, file))
  assert(stat.isFile() && stat.nlink === 1, 'Build payload must contain regular files')
  return {
    path: safePath(file),
    size: stat.size,
    mode: stat.mode & 0o777,
    sha256: digest(readFileSync(path.join(root, file))),
  }
}

function copy(root, destination, file, mode, source = file) {
  safePath(file)
  safePath(source)
  assert(
    lstatSync(destination).isDirectory() && !lstatSync(destination).isSymbolicLink(),
    'Destination must be a real directory',
  )
  const target = path.join(destination, file)
  let ancestor = path.dirname(target)
  while (ancestor !== destination) {
    if (existsSync(ancestor))
      assert(
        lstatSync(ancestor).isDirectory() && !lstatSync(ancestor).isSymbolicLink(),
        'Output parent must be a real directory',
      )
    ancestor = path.dirname(ancestor)
  }
  if (existsSync(target))
    assert(
      lstatSync(target).isFile() &&
        !lstatSync(target).isSymbolicLink() &&
        lstatSync(target).nlink === 1,
      'Output target must be a regular file',
    )
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(path.join(root, source), target)
  chmodSync(target, mode)
}

function summary(request, before) {
  const directory = path.join(request.root, '.turbo/runs')
  const files = readdirSync(directory).filter(
    (file) => file.endsWith('.json') && !before.includes(file),
  )
  assert(files.length === 1, 'Expected one successful build summary')
  const result = JSON.parse(readFileSync(path.join(directory, files[0]), 'utf8'))
  assert(result.execution.exitCode === 0, 'Build failed')
  return result.tasks
}

function taskRecord(graph, task) {
  return { taskId: task.taskId, hash: task.hash, roots: outputRoots(graph, task) }
}

export function produce(request) {
  if (!request.libraries.length) return null
  const graph = readWorkspaceGraph(request.root)
  const planned = buildTasks(request)
  const summaries = path.join(request.root, '.turbo/runs')
  const before = existsSync(summaries) ? readdirSync(summaries) : []
  process.stdout.write(turbo(request.root, request.libraries, ['--summarize']))
  const tasks = concreteBuildTasks(graph, summary(request, before))
  assert.deepEqual(
    tasks.map((task) => [task.taskId, task.hash]).sort(),
    planned.map((task) => [task.taskId, task.hash]).sort(),
    'Build task identities changed during execution',
  )
  assert.deepEqual(
    identity(request.root, readWorkspaceGraph(request.root), {
      ...request.identity,
      attempt: request.attempt,
      image: request.provenance.image,
    }),
    request.identity,
    'Build inputs changed during execution',
  )
  assert.deepEqual(
    buildTasks(request).map((task) => taskRecord(graph, task)),
    planned.map((task) => taskRecord(graph, task)),
    'Build task/output identity changed during execution',
  )
  const records = planned.map((task) => taskRecord(graph, task))
  const outputs = outputFiles(
    request.root,
    records.flatMap((task) => task.roots),
  ).sort()
  const files = outputs.map((file) => entry(request.root, file))
  for (const task of planned) validateOutputs(graph, task, files)
  const cache = path.join(request.root, cacheDirectory)
  const names = tasks.flatMap((task) => [`${task.hash}.tar.zst`, `${task.hash}-meta.json`])
  for (const file of readdirSync(cache))
    if (!names.includes(file)) rmSync(path.join(cache, file), { recursive: true })
  const cacheFiles = names.map((name) => entry(request.root, `${cacheDirectory}/${name}`))
  const manifest = JSON.stringify({
    identity: request.identity,
    provenance: request.provenance,
    attempt: request.attempt,
    libraries: request.libraries,
    tasks: records,
    files: files.concat(cacheFiles),
  })
  const directory = path.join(request.directory, 'bundle')
  mkdirSync(path.join(directory, 'files'), { recursive: true })
  for (const file of files.concat(cacheFiles))
    copy(request.root, path.join(directory, 'files'), file.path, file.mode)
  writeFileSync(path.join(directory, 'manifest.json'), manifest)
  const name = `${request.namespace}${request.attempt}-${digest(manifest)}`
  telemetry('producer-ready', request, {
    name,
    tasks: tasks.map((task) => ({ task: task.taskId, hash: task.hash, cache: task.cache.status })),
  })
  return { directory, name, tasks }
}

function artifact(request, downloads) {
  const names = readdirSync(downloads)
  const pattern = new RegExp(`^${request.namespace}(\\d+)-([a-f0-9]{64})$`)
  const candidates = names.map((name) => {
    const match = name.match(pattern)
    assert(
      match && lstatSync(path.join(downloads, name)).isDirectory(),
      'Unexpected build artifact identity',
    )
    const attempt = Number(match[1])
    assert(
      Number.isSafeInteger(attempt) && attempt > 0 && attempt <= request.attempt,
      'Invalid producer attempt',
    )
    return { name, attempt, digest: match[2] }
  })
  const latest = Math.max(...candidates.map((item) => item.attempt))
  const selected = candidates.filter((item) => item.attempt === latest)
  assert(selected.length === 1, 'Expected one build artifact for the latest producer attempt')
  return selected[0]
}

function validateBundle(request, directory, selected) {
  assert(
    lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
    'Artifact must be a real directory',
  )
  const content = readFileSync(path.join(directory, 'manifest.json'))
  assert.equal(digest(content), selected.digest, 'Build manifest digest mismatch')
  const manifest = JSON.parse(content.toString('utf8'))
  assert.deepEqual(manifest.identity, request.identity, 'Build identity mismatch')
  assert.equal(
    imageOS(manifest.provenance?.image),
    request.identity.imageOS,
    'Build image OS mismatch',
  )
  assert.equal(manifest.attempt, selected.attempt, 'Build attempt mismatch')
  const graph = readWorkspaceGraph(request.root)
  assert.deepEqual(
    requiredLibraries(graph, manifest.libraries),
    manifest.libraries,
    'Build union is not a graph closure',
  )
  assert.deepEqual(
    manifest.tasks.map((task) => task.taskId).sort(),
    manifest.libraries.map((name) => `${name}#build`).sort(),
    'Build task coverage mismatch',
  )
  const union = buildTasks({ ...request, libraries: manifest.libraries })
  assert.deepEqual(
    manifest.tasks,
    union.map((task) => taskRecord(graph, task)),
    'Build task/output identity mismatch',
  )
  const planned = union.filter((task) => request.libraries.includes(task.package))
  assert.equal(planned.length, request.libraries.length, 'Missing required build tasks')
  const required = planned.map((task) => taskRecord(graph, task))
  const paths = manifest.files.map((file) => safePath(file.path))
  assert.equal(new Set(paths).size, paths.length, 'Duplicate build payload path')
  const roots = manifest.tasks.flatMap((task) => task.roots)
  const cachePaths = manifest.tasks.flatMap((task) => [
    `${cacheDirectory}/${task.hash}.tar.zst`,
    `${cacheDirectory}/${task.hash}-meta.json`,
  ])
  assert(
    paths.every((file) => under(file, roots) || cachePaths.includes(file)),
    'Unexpected build payload file',
  )
  assert(
    cachePaths.every((file) => paths.includes(file)),
    'Missing build cache entry',
  )
  assert.deepEqual(
    filesBelow(directory).sort(),
    ['manifest.json'].concat(paths.map((file) => `files/${file}`)).sort(),
    'Build payload file table mismatch',
  )
  for (const file of manifest.files) {
    assert(
      Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777,
      'Invalid output mode',
    )
    const actual = entry(path.join(directory, 'files'), file.path)
    assert.equal(actual.sha256, file.sha256, 'Build payload digest mismatch')
    assert.equal(actual.size, file.size, 'Build payload size mismatch')
  }
  for (const task of union) validateOutputs(graph, task, manifest.files)
  return { manifest, required }
}

export function consume(request, downloads) {
  if (!request.libraries.length) return []
  const selected = artifact(request, downloads)
  const directory = path.join(downloads, selected.name)
  const { manifest, required } = validateBundle(request, directory, selected)
  const roots = required.flatMap((task) => task.roots)
  for (const file of manifest.files) {
    const cached = required.some(
      (task) =>
        file.path === `${cacheDirectory}/${task.hash}.tar.zst` ||
        file.path === `${cacheDirectory}/${task.hash}-meta.json`,
    )
    if (!cached && !under(file.path, roots)) continue
    const target = cached ? file.path.replace(`${cacheDirectory}/`, '.turbo/cache/') : file.path
    copy(path.join(directory, 'files'), request.root, target, file.mode, file.path)
  }
  writeFileSync(
    path.join(request.root, receiptFile),
    JSON.stringify({
      identity: request.identity,
      provenance: { producer: manifest.provenance, consumer: request.provenance },
      files: manifest.files.filter((file) => under(file.path, roots)),
      libraries: request.libraries,
    }),
  )
  telemetry('import-ready', request, {
    producerAttempt: selected.attempt,
    tasks: required.map((task) => ({ task: task.taskId, hash: task.hash })),
  })
  return required
}

export function verifyImported(request) {
  if (!request.libraries.length) return
  const receipt = JSON.parse(readFileSync(path.join(request.root, receiptFile), 'utf8'))
  assert.deepEqual(receipt.identity, request.identity, 'Missing matching workspace import')
  assert.deepEqual(
    receipt.provenance?.consumer,
    request.provenance,
    'Import runner provenance mismatch',
  )
  assert.equal(
    imageOS(receipt.provenance?.producer?.image),
    request.identity.imageOS,
    'Import image OS mismatch',
  )
  assert(
    request.libraries.every((name) => receipt.libraries.includes(name)),
    'Missing site prerequisites',
  )
  for (const file of receipt.files) {
    const actual = entry(request.root, file.path)
    assert.equal(actual.sha256, file.sha256, 'Imported prerequisite changed')
    assert.equal(actual.size, file.size, 'Imported prerequisite size changed')
  }
}

function telemetry(event, request, detail = {}) {
  const record = JSON.stringify({
    event,
    at: new Date().toISOString(),
    run: request.identity.run,
    checkout: request.identity.checkout,
    attempt: request.attempt,
    identity: request.identity,
    provenance: request.provenance,
    ...detail,
  })
  process.stdout.write(`${record}\n`)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${record}\n\`\`\`\n`)
}

function output(values) {
  for (const [name, value] of Object.entries(values))
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function context() {
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    : {}
  return {
    repository: process.env.GITHUB_REPOSITORY,
    run: process.env.GITHUB_RUN_ID,
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    source: process.env.BUILD_SOURCE_SHA ?? event.pull_request?.head?.sha ?? process.env.GITHUB_SHA,
    os: process.env.RUNNER_OS,
    arch: process.env.RUNNER_ARCH,
    image: `${process.env.ImageOS}/${process.env.ImageVersion}`,
  }
}

function main() {
  const [operation, state] = process.argv.slice(2)
  if (operation === 'prepare') {
    assert(
      ['produce', 'consume'].includes(process.env.BUILD_OPERATION),
      'Unknown build action operation',
    )
    const request = prepare({
      root: process.cwd(),
      temporary: process.env.RUNNER_TEMP,
      selection: process.env.BUILD_SELECTION ? JSON.parse(process.env.BUILD_SELECTION) : undefined,
      targets: process.env.BUILD_TARGETS,
      context: context(),
    })
    const file = path.join(request.directory, 'request.json')
    writeFileSync(file, JSON.stringify(request))
    output({
      state: file,
      directory: request.directory,
      required: request.libraries.length > 0,
      'cache-prefix': request.cachePrefix,
      'cache-key': request.cacheKey,
      pattern: request.artifactPattern,
    })
    return
  }
  if (operation === 'verify-site') {
    const request = prepare({
      root: process.cwd(),
      temporary: process.env.RUNNER_TEMP,
      targets: state,
      context: context(),
    })
    try {
      verifyImported(request)
    } finally {
      rmSync(request.directory, { recursive: true, force: true })
    }
    return
  }
  const request = JSON.parse(readFileSync(state, 'utf8'))
  if (operation === 'produce') {
    const publication = produce(request)
    if (publication) output({ name: publication.name, bundle: publication.directory })
    return
  }
  if (operation === 'consume') {
    consume(request, path.join(request.directory, 'downloads'))
    output({ ready: true })
    return
  }
  assert.equal(operation, 'published', 'Unknown build reuse operation')
  telemetry('published', request)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
