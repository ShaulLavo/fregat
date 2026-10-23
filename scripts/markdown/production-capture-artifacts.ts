import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import * as v from 'valibot'
import { createScriptError } from '../structured-errors'
import {
  buildArtifact,
  fontsArtifact,
  nativeReport,
  productionReport,
  productionTrial,
  sourceCaptureArtifact,
  wasmBuildRoles,
} from './production-reconciliation'
import { timingLaunchManifest } from './production-shards'
import { stable } from './serialization'
import { foldJsonl, hashFile } from './timing-artifacts'

const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function json(root: string, file: string) {
  const observed = await hashFile({ root, file })
  const filename = path.resolve(root, observed.path)
  const value: unknown = JSON.parse(await readFile(filename, 'utf8'))
  return { observed, filename, value }
}
async function retainBytes(root: string, filename: string, bytes: Uint8Array) {
  filename = await confinedDestination(root, filename)
  await mkdir(path.dirname(filename), { recursive: true })
  try {
    await writeFile(filename, bytes, { flag: 'wx' })
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
    if ((await hashFile({ root, file: filename })).sha256 !== sha(bytes))
      throw createScriptError('Retained capture bytes differ from the original source.')
  }
}
async function retainJson(root: string, filename: string, value: unknown) {
  await retainBytes(root, filename, Buffer.from(JSON.stringify(value, null, 2) + '\n'))
}

async function resolveDestination(file: string): Promise<string> {
  try {
    return await realpath(file)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    return path.join(await resolveDestination(path.dirname(file)), path.basename(file))
  }
}
async function confinedDestination(root: string, file: string) {
  const destination = await resolveDestination(path.resolve(root, file))
  const relative = path.relative(root, destination)
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  )
    throw createScriptError('Capture artifacts must stay inside their evidence root.')
  return destination
}

async function retainSourceSnapshot(options: {
  readonly root: string
  readonly source: string
  readonly snapshot: string
  readonly provenance: v.InferOutput<typeof sourceCaptureArtifact>['provenance']
  readonly budgetSha256: string
}) {
  const { root, provenance } = options
  const snapshot = await confinedDestination(root, options.snapshot)
  await mkdir(snapshot, { recursive: true })
  for (const entry of provenance.sources) {
    if (
      path.isAbsolute(entry.file) ||
      entry.file.split(/[\\/]/u).some((part) => part === '..' || part === '.')
    )
      throw createScriptError('Captured source identities must be relative paths.')
    const bytes = await readFile(path.resolve(options.source, entry.file))
    if (sha(bytes) !== entry.sha256)
      throw createScriptError('Source changed after the actual capture.')
    await retainBytes(root, path.join(snapshot, entry.file), bytes)
  }
  const lock = await readFile(path.join(options.source, 'bun.lock'))
  if (sha(lock) !== provenance.lockfileSha256)
    throw createScriptError('The lockfile changed after the actual capture.')
  await retainBytes(root, path.join(snapshot, 'bun.lock'), lock)
  const budget = await readFile(path.join(options.source, 'scripts/markdown/promotion-budget.json'))
  if (sha(budget) !== options.budgetSha256)
    throw createScriptError('The budget changed after the actual capture.')
  await retainBytes(root, path.join(snapshot, 'scripts/markdown/promotion-budget.json'), budget)
  return snapshot
}

export async function finalizeProductionLaunch(options: {
  readonly root: string
  readonly report: string
  readonly build: string
  readonly source: string
  readonly snapshot: string
  readonly frozen: string
  readonly host: string
  readonly quietHost: string
  readonly output: string
}) {
  const root = await realpath(options.root)
  const captured = await json(root, options.report)
  const report = v.parse(productionReport, captured.value)
  const { provenance } = v.parse(
    v.object({ provenance: sourceCaptureArtifact.entries.provenance }),
    captured.value,
  )
  if (!report.browser.executablePath || !report.browser.actualArgs)
    throw createScriptError('Launch finalization requires the actual executable and command line.')
  const build = await json(root, path.join(options.build, 'markdown-probe-build.json'))
  const metadata = v.parse(buildArtifact, build.value)
  const manifest = await hashFile({ root, file: path.join(options.build, '.vite/manifest.json') })
  if (metadata.artifactManifestSha256 !== manifest.sha256)
    throw createScriptError('The build manifest differs from its captured identity.')
  for (const file of metadata.artifacts) {
    if (path.basename(file.file) !== file.file)
      throw createScriptError('Production asset identities must be flat file names.')
    const observed = await hashFile({ root, file: path.join(options.build, 'assets', file.file) })
    if (observed.sha256 !== file.sha256 || observed.byteLength !== file.bytes)
      throw createScriptError('A retained production asset differs from its build identity.')
  }
  const snapshot = await retainSourceSnapshot({
    ...options,
    root,
    provenance,
    budgetSha256: report.frozenBudgetSha256,
  })
  const output = await confinedDestination(root, options.output)
  await mkdir(output)
  const relative = (file: string) => path.relative(output, path.resolve(root, file))
  const sources = v.parse(sourceCaptureArtifact, {
    reportSha256: captured.observed.sha256,
    provenance,
    sourceRoot: relative(snapshot),
    files: {
      lockfile: relative(path.join(snapshot, 'bun.lock')),
      budget: relative(path.join(snapshot, 'scripts/markdown/promotion-budget.json')),
      ...Object.fromEntries(
        wasmBuildRoles.map(({ field, file }) => {
          const matches = metadata.artifacts.filter((entry) => file.test(entry.file))
          if (matches.length !== 1)
            throw createScriptError('The build must retain exactly one asset per WASM role.')
          const role = {
            grammarSha256: 'grammar',
            chatGrammarSha256: 'chatGrammar',
            resolverSha256: 'resolver',
          }[field]
          return [role, relative(path.join(options.build, 'assets', matches[0].file))]
        }),
      ),
    },
  })
  let environment: v.InferOutput<typeof productionTrial>['environment'] | undefined
  await foldJsonl({
    root,
    file: path.resolve(path.dirname(captured.filename), report.trialsArtifact.path),
    expected: {
      ...report.trialsArtifact,
      path: path
        .relative(root, path.resolve(path.dirname(captured.filename), report.trialsArtifact.path))
        .split(path.sep)
        .join('/'),
    },
    parse: (value) => v.parse(productionTrial, value),
    consume: (row) => {
      environment ??= row.environment
    },
  })
  if (!environment)
    throw createScriptError('A launch without actual trial records cannot supply font evidence.')
  const fontEnvironment = { fontFamily: environment.fontFamily, fonts: environment.fonts }
  const files = metadata.artifacts
    .filter((entry) => /\.(?:woff2?|ttf|otf)$/u.test(entry.file))
    .map((entry) => ({ path: `assets/${entry.file}`, sha256: entry.sha256 }))
  const fonts = v.parse(fontsArtifact, {
    host: report.host.id,
    ...fontEnvironment,
    files,
    fingerprint: sha(stable({ files, ...fontEnvironment })),
  })
  const fontFile = path.join(path.dirname(build.filename), 'capture-fonts.json')
  await retainJson(root, fontFile, fonts)
  await retainJson(root, path.join(output, 'browser.json'), {
    host: report.host.id,
    executablePath: report.browser.executablePath,
    version: report.browser.version,
    args: report.browser.actualArgs,
  })
  await retainJson(root, path.join(output, 'source-capture.json'), sources)
  for (const file of [options.host, options.quietHost, options.frozen])
    await hashFile({ root, file })
  const launch = v.parse(timingLaunchManifest, {
    schemaVersion: 1,
    kind: 'production',
    report: relative(captured.filename),
    frozen: relative(options.frozen),
    artifacts: {
      host: relative(options.host),
      quietHost: relative(options.quietHost),
      build: relative(build.filename),
      buildManifest: relative(manifest.path),
      browser: 'browser.json',
      fonts: relative(fontFile),
      sourceCapture: 'source-capture.json',
      trials: relative(path.resolve(path.dirname(captured.filename), report.trialsArtifact.path)),
    },
  })
  await retainJson(root, path.join(output, 'timing-manifest.json'), launch)
  return {
    manifestFile: path.join(output, 'timing-manifest.json'),
    fontFingerprint: fonts.fingerprint,
  }
}

export async function finalizeNativeLaunch(
  options: Omit<Parameters<typeof finalizeProductionLaunch>[0], 'build'> & {
    readonly grammar: string
    readonly chatGrammar: string
    readonly resolver: string
  },
) {
  const root = await realpath(options.root)
  const captured = await json(root, options.report)
  const report = v.parse(nativeReport, captured.value)
  const provenance = v.parse(
    sourceCaptureArtifact.entries.provenance,
    report.metadata.qualification,
  )
  const snapshot = await retainSourceSnapshot({
    ...options,
    root,
    provenance,
    budgetSha256: report.metadata.budgetSha256,
  })
  const assets = [
    { role: 'grammar', file: options.grammar, sha256: report.metadata.grammarSha256 },
    { role: 'chatGrammar', file: options.chatGrammar, sha256: report.metadata.chatGrammarSha256 },
    { role: 'resolver', file: options.resolver, sha256: report.metadata.resolverSha256 },
  ]
  const output = await confinedDestination(root, options.output)
  await mkdir(output)
  const relative = (file: string) => path.relative(output, path.resolve(root, file))
  const retained = []
  for (const asset of assets) {
    const bytes = await readFile(asset.file)
    if (sha(bytes) !== asset.sha256)
      throw createScriptError('A native asset differs from the original capture identity.')
    const file = path.join(snapshot, 'native-assets', `${asset.role}.wasm`)
    await retainBytes(root, file, bytes)
    retained.push([asset.role, relative(file)])
  }
  await retainJson(
    root,
    path.join(output, 'source-capture.json'),
    v.parse(sourceCaptureArtifact, {
      reportSha256: captured.observed.sha256,
      provenance,
      sourceRoot: relative(snapshot),
      files: {
        ...Object.fromEntries(retained),
        lockfile: relative(path.join(snapshot, 'bun.lock')),
        budget: relative(path.join(snapshot, 'scripts/markdown/promotion-budget.json')),
      },
    }),
  )
  for (const file of [options.host, options.quietHost, options.frozen])
    await hashFile({ root, file })
  const manifestFile = path.join(output, 'timing-manifest.json')
  await retainJson(
    root,
    manifestFile,
    v.parse(timingLaunchManifest, {
      schemaVersion: 1,
      kind: 'native',
      report: relative(captured.filename),
      frozen: relative(options.frozen),
      artifacts: {
        host: relative(options.host),
        quietHost: relative(options.quietHost),
        build: null,
        buildManifest: null,
        browser: null,
        fonts: null,
        sourceCapture: 'source-capture.json',
        trials: relative(path.resolve(path.dirname(captured.filename), report.pairsArtifact.path)),
      },
    }),
  )
  return { manifestFile }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: Object.fromEntries(
      [
        'kind',
        'root',
        'report',
        'build',
        'source',
        'snapshot',
        'frozen',
        'host',
        'quiet-host',
        'out',
        'grammar',
        'chat-grammar',
        'resolver',
      ].map((key) => [key, { type: 'string' as const }]),
    ),
  })
  const common = {
    root: v.string(),
    report: v.string(),
    source: v.string(),
    snapshot: v.string(),
    frozen: v.string(),
    host: v.string(),
    'quiet-host': v.string(),
    out: v.string(),
  }
  const options = v.parse(
    v.variant('kind', [
      v.object({ ...common, kind: v.literal('production'), build: v.string() }),
      v.object({
        ...common,
        kind: v.literal('native'),
        grammar: v.string(),
        'chat-grammar': v.string(),
        resolver: v.string(),
      }),
    ]),
    { ...values, kind: values.kind ?? 'production' },
  )
  const input = { ...options, quietHost: options['quiet-host'], output: options.out }
  const result =
    options.kind === 'production'
      ? await finalizeProductionLaunch({ ...input, build: options.build })
      : await finalizeNativeLaunch({
          ...input,
          grammar: options.grammar,
          chatGrammar: options['chat-grammar'],
          resolver: options.resolver,
        })
  process.stdout.write(JSON.stringify(result) + '\n')
}
