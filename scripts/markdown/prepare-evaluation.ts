import { createHash, hash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parse } from 'valibot'
import { createScriptError } from '../structured-errors'
import {
  curationFreezeSchema,
  evaluationManifestSchema,
  exclusionHashes,
  unresolvedExclusionSources,
  exclusionsSchema,
  sourceIdentity,
  validateCurationProtocol,
  validateCustodyInventory,
} from './evaluation-custody'
import { DEVELOPMENT_POLICY_SHA256 } from './development-exclusions'
import { encoded } from './serialization'
import { builtInExclusions } from './snapshot-evaluation'

async function archiveIdentity(file: string) {
  const digest = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk)
    bytes += chunk.length
  }
  return { sha256: digest.digest('hex'), bytes }
}

export async function prepareEvaluation(input: {
  readonly root: string
  readonly asset: string
  readonly license: string
  readonly exclusions?: string
  readonly freeze?: string
}) {
  const inspectedAt = new Date().toISOString()
  const directory = path.join(input.root, 'packages/markdown/test/evaluation')
  const manifestBytes = await readFile(path.join(directory, 'manifest.json'))
  const manifest = parse(evaluationManifestSchema, JSON.parse(manifestBytes.toString('utf8')))
  const custody = validateCustodyInventory(
    JSON.parse(await readFile(path.join(directory, 'custody.json'), 'utf8')),
    manifest,
  )
  const archive = await archiveIdentity(input.asset)
  const licenseSha256 = hash('sha256', await readFile(input.license))
  if (
    archive.sha256 !== manifest.assetSha256 ||
    licenseSha256 !== hash('sha256', await readFile(path.join(directory, 'LICENSE')))
  )
    throw createScriptError('Preparation requires the pinned source archive and license.', {
      internal: { boundary: 'preparation-source-integrity' },
    })
  const builtIn = await builtInExclusions()
  const exclusions = input.exclusions
    ? parse(exclusionsSchema, JSON.parse(await readFile(input.exclusions, 'utf8')))
    : null
  const freeze = input.freeze
    ? parse(curationFreezeSchema, JSON.parse(await readFile(input.freeze, 'utf8')))
    : null
  if (exclusions) {
    const excluded = exclusionHashes(exclusions)
    if (Array.from(builtIn).some((source) => !excluded.has(source)))
      throw createScriptError('Preparation requires every built-in development source exclusion.', {
        internal: { boundary: 'preparation-built-in-exclusions' },
      })
  }
  if (freeze && exclusions) validateCurationProtocol(freeze, exclusions, inspectedAt)
  const missingInputs: string[] = []
  if (!freeze) missingInputs.push('final-parser-freeze')
  if (!exclusions) missingInputs.push('complete-development-exclusions')
  const unresolvedSources = exclusions ? unresolvedExclusionSources(exclusions) : []
  if (unresolvedSources.length) missingInputs.push('unresolved-development-sources')
  return {
    developmentPolicySha256: DEVELOPMENT_POLICY_SHA256,
    exactHashInventoryComplete: exclusions?.complete ?? null,
    unresolvedSources,
    schemaVersion: 1,
    status: missingInputs.length ? 'awaiting-inputs' : 'metadata-validated',
    inspectedAt,
    selectionPerformed: false,
    eligibleMessages: null,
    requiredMessages: 100,
    missingInputs,
    source: { ...sourceIdentity(manifest), archiveBytes: archive.bytes, licenseSha256 },
    manifestSha256: hash('sha256', manifestBytes),
    quarantinedMessages: custody.records
      .filter((record) => record.kind === 'legacy-unknown')
      .reduce((total, record) => total + record.batch.messages, 0),
    builtInExcludedSources: builtIn.size,
    exclusionsSha256: exclusions ? hash('sha256', encoded(exclusions)) : null,
    freeze,
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      asset: { type: 'string' },
      license: { type: 'string' },
      'exclude-manifest': { type: 'string' },
      'freeze-manifest': { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    process.stdout.write(
      'bun scripts/markdown/prepare-evaluation.ts --asset FILE --license FILE [--exclude-manifest FILE] [--freeze-manifest FILE] [--out FILE]\nHashes compressed bytes and validates metadata. Selection and eligible capacity remain unmeasured.\n',
    )
    return
  }
  if (!values.asset || !values.license)
    throw createScriptError('Preparation requires --asset and --license.', {
      internal: { boundary: 'preparation-arguments' },
    })
  const receipt = encoded(
    await prepareEvaluation({
      root: fileURLToPath(new URL('../../', import.meta.url)),
      asset: values.asset,
      license: values.license,
      exclusions: values['exclude-manifest'],
      freeze: values['freeze-manifest'],
    }),
  )
  if (values.out) await writeFile(values.out, receipt, { flag: 'wx' })
  process.stdout.write(receipt)
}

if (import.meta.main) await main()
