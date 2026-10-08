import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { verifyFullDocumentRow } from './full-document.mjs'
import { editors, percentile, verifyGeometry } from './protocol.mjs'

export function verifyOpenProfiles(result) {
  if (!result.config.profileOpen || !result.config.openOnly)
    throw new RangeError('Expected an open-only diagnostic profile')
  const expected = result.config.selected.length * result.config.repetitions * editors.length
  const identities = new Set(
    result.samples.map((row) => `${row.editor}/${row.mib}/${row.repetition}`),
  )
  if (result.samples.length !== expected || identities.size !== expected)
    throw new RangeError('Incomplete or duplicate profile matrix')
  for (const row of result.samples) verifyProfileRow(row, result.config)
  return `${result.samples.length} open profiles retained; ${result.samples.filter((row) => row.status === 'ok').length} completed`
}

function verifyProfileRow(row, config) {
  if (
    !editors.includes(row.editor) ||
    !config.selected.includes(row.mib) ||
    !Number.isInteger(row.repetition) ||
    row.repetition < 0 ||
    row.repetition >= config.repetitions
  )
    throw new RangeError('Unexpected profile identity')
  if (!row.openProfile?.trace || !Number.isFinite(row.openProfile.mainWorkMs))
    throw new RangeError('Missing diagnostic open trace')
  if (row.status !== 'ok') {
    if (!row.errors?.length) throw new RangeError('Failed profile has no retained error')
    return
  }
  if (row.editor === 'singapore' && config.fullDocument) verifyFullDocumentRow(row)
  verifyGeometry(row.open)
  if (!row.openProfile.completed || !Number.isFinite(row.open.highlightedFrameMs))
    throw new RangeError('Successful profile has no settled open clock')
  if (row.editor === 'singapore' && !hasInitialParseMeasurement(row))
    throw new RangeError('Successful Singapore profile has no worker parse measurement')
}

function firstParse(row) {
  return row.openProfile.requests.find(
    (request) =>
      request.resultMode === 'bootstrap' ||
      request.resultMode === 'parseOnly' ||
      request.resultMode === 'full',
  )
}

function hasInitialParseMeasurement(row) {
  const parse = firstParse(row)
  if (parse?.resultMode !== 'bootstrap')
    return parse?.timings?.some((timing) => timing.name === 'treeSitter.parseRoot')
  return row.openProfile.requests.some(
    (request) =>
      request.type === 'queryRange' &&
      request.analysis?.kind === 'partial' &&
      request.timings?.some((timing) => timing.name === 'treeSitter.bootstrapRoot'),
  )
}

export function openProfileRows(result) {
  verifyOpenProfiles(result)
  const phase = (request, name) =>
    request?.timings?.find((timing) => timing.name === name)?.durationMs
  return result.samples.map((row) => {
    const parse = firstParse(row)
    const reset = row.openProfile.requests.find((request) => request.sourceCommand === 'reset')
    const query =
      row.openProfile.requests.find((request) => request.resultMode === 'full') ??
      row.openProfile.requests.find(
        (request) => request.type === 'queryRange' && request.statistics?.tokens > 0,
      )
    const relative = (request) => (request ? request.at - row.openProfile.startedAtMs : undefined)
    const applied = row.openProfile.diagnostics?.find(
      (event) =>
        event.name === 'editor.syntax.structural.apply' && Number.isFinite(event.durationMs),
    )
    return {
      editor: row.editor,
      mib: row.mib,
      repetition: row.repetition,
      status: row.status,
      highlightedMs: row.open?.highlightedFrameMs,
      mountMs: row.openProfile.marksMs['compare-open-mounted'],
      firstFrameMs: row.open?.firstFrameMs,
      sourceStartMs: relative(reset),
      sourceResetMs: reset?.roundTripMs,
      sourcePostMs: reset?.postMessageMs,
      sourceOutboundMs: reset?.outboundMs,
      sourceCodeUnits: reset?.sourceCodeUnits,
      parseStartMs: relative(parse),
      parseRoundTripMs: parse?.roundTripMs,
      parseReturnedResult: parse?.returnedResult,
      parseMs: phase(parse, 'treeSitter.parse'),
      parseRootMs: phase(parse, 'treeSitter.parseRoot'),
      bootstrapRootMs: phase(query, 'treeSitter.bootstrapRoot'),
      bootstrapUnits: query?.statistics?.bootstrapUnits,
      injectionDiscoveryMs: phase(parse, 'treeSitter.injectionDiscovery'),
      queryStartMs: relative(query),
      queryRoundTripMs: query?.roundTripMs,
      queryMs: phase(query, 'treeSitter.queryRange') ?? phase(query, 'treeSitter.query'),
      inboundMs: query?.inboundMs,
      tokenStoreMs: row.openProfile.diagnostics?.find(
        (event) => event.name === 'compare.full.tokenStore',
      )?.durationMs,
      reference: row.open?.facts?.fullHighlight,
      structuralWalkMs: phase(query, 'treeSitter.structuralWalk'),
      highlightQueryMs: phase(query, 'treeSitter.highlightQueryAndPredicates'),
      packingMs: phase(query, 'treeSitter.packing'),
      structuralApplyMs: applied?.durationMs,
      visibleMs: row.openProfile.marksMs['compare-open-visible'],
      queryTokens: query?.statistics?.tokens,
      queryTokenBytes: query?.statistics?.transferredTokenBytes,
      queryStart: query?.statistics?.rangeStart,
      queryEnd: query?.statistics?.rangeEnd,
      mainWorkMs: row.openProfile.mainWorkMs,
      mainRenderingMs: row.openProfile.mainRenderingMs,
      errors: row.errors,
    }
  })
}

export function openProfileSummary(result) {
  const rows = openProfileRows(result)
  const groups = result.config.selected.flatMap((mib) =>
    editors.map((editor) => {
      const successful = rows.filter(
        (row) => row.mib === mib && row.editor === editor && row.status === 'ok',
      )
      const medians = Object.fromEntries(
        Object.keys(rows[0])
          .filter((key) => key.endsWith('Ms'))
          .map((key) => [
            key,
            percentile(successful.map((row) => row[key]).filter(Number.isFinite), 0.5),
          ]),
      )
      return {
        editor,
        mib,
        completed: successful.length,
        attempted: result.config.repetitions,
        ...medians,
      }
    }),
  )
  return {
    label: result.label,
    machine: result.machine,
    browser: result.browser,
    date: result.date,
    versions: result.versions,
    groups,
    rows,
  }
}

export function compareOpenProfiles(before, after) {
  for (const key of [
    'config',
    'machine',
    'browser',
    'tooling',
    'versions',
    'rootLockSha256',
    'fixtures',
  ]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      throw new RangeError(`Open comparison differs in ${key}`)
  }
  const competitors = (result) =>
    result.bundles?.filter((bundle) => !bundle.id.startsWith('singapore-'))
  if (JSON.stringify(competitors(before)) !== JSON.stringify(competitors(after)))
    throw new RangeError('Open comparison differs in competitor bundles')
  const baseline = openProfileSummary(before)
  const current = openProfileSummary(after)
  return {
    label:
      'Diagnostic experiment comparison; instrumented clocks do not establish a headline speedup.',
    beforeDate: before.date,
    afterDate: after.date,
    groups: current.groups.map((group, index) => ({
      editor: group.editor,
      mib: group.mib,
      beforeCompleted: baseline.groups[index].completed,
      afterCompleted: group.completed,
      medians: Object.fromEntries(
        Object.keys(group)
          .filter((key) => key.endsWith('Ms'))
          .map((key) => {
            const prior = baseline.groups[index][key]
            const next = group[key]
            return [
              key,
              {
                before: prior,
                after: next,
                delta: Number.isFinite(prior) && Number.isFinite(next) ? next - prior : null,
              },
            ]
          }),
      ),
    })),
  }
}

async function readExperiment(path) {
  const bytes = await readFile(resolve(path))
  return JSON.parse(path.endsWith('.gz') ? gunzipSync(bytes).toString() : bytes.toString())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [path, option, baselinePath] = process.argv.slice(2)
  if (!path || (option && (option !== '--compare' || !baselinePath)))
    throw new RangeError('Pass an open-only experiment path and optional --compare baseline path')
  const result = await readExperiment(path)
  console.error(verifyOpenProfiles(result))
  const summary = baselinePath
    ? compareOpenProfiles(await readExperiment(baselinePath), result)
    : openProfileSummary(result)
  console.log(JSON.stringify(summary, null, 2))
}
