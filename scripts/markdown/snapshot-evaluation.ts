import { hash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync, gzipSync } from 'node:zlib'
import { array, boolean, object, parse, string } from 'valibot'
import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'
import commonmark from '../../packages/markdown/test/reference/commonmark.json'
import gfm from '../../packages/markdown/test/reference/gfm.json'
import chat from '../../packages/markdown/test/reference/chat.json'
import { createScriptError } from '../structured-errors'

const DATASET = {
  dataset: 'OpenAssistant/oasst1',
  revision: 'fdf72ae0827c1cda404aff25b6603abec9e3399b',
  license: 'Apache-2.0',
  url: 'https://huggingface.co/datasets/OpenAssistant/oasst1',
}
const messageSchema = object({
  message_id: string(),
  text: string(),
  role: string(),
  lang: string(),
  synthetic: boolean(),
  deleted: boolean(),
  created_date: string(),
})

export function selectEvaluationMessages(raw: string, excluded: ReadonlySet<string>) {
  const seen = new Set(excluded)
  const candidates = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const message = parse(messageSchema, JSON.parse(line))
    if (message.role !== 'assistant' || message.synthetic || message.deleted) continue
    const length = Array.from(message.text).length
    if (message.lang !== 'en' || length < 150 || length > 16384) continue
    if (!/\n|`|\*\*|\[[^\]]+\]\(/u.test(message.text)) continue
    const sha256 = hash('sha256', message.text, 'hex')
    if (seen.has(sha256)) continue
    seen.add(sha256)
    candidates.push({
      priority: hash('sha256', `fregat-chat-evaluation-v1:${message.message_id}`, 'hex'),
      row: {
        id: message.message_id,
        source: message.text,
        sha256,
        createdDate: message.created_date,
        provenance: DATASET,
        split: 'evaluation',
      },
    })
  }
  candidates.sort((left, right) => left.priority.localeCompare(right.priority))
  return candidates.map((candidate) => candidate.row)
}

async function main() {
  const { values } = parseArgs({
    options: { asset: { type: 'string' }, license: { type: 'string' }, out: { type: 'string' } },
  })
  if (!values.asset || !values.license || !values.out)
    throw createScriptError('Evaluation snapshots need --asset, --license and --out.', {
      internal: { boundary: 'evaluation-arguments' },
    })
  const bytes = await readFile(values.asset)
  const excluded = new Set(
    commonmark.concat(gfm).map((example) => hash('sha256', example.source, 'hex')),
  )
  for (const source of chat) excluded.add(hash('sha256', source, 'hex'))
  for (const fixture of MARKDOWN_CASES) excluded.add(fixture.sha256)
  const repositories = parse(
    array(object({ text: string() })),
    JSON.parse(
      gunzipSync(
        await readFile(
          new URL('../../packages/markdown/test/reference/repositories.json.gz', import.meta.url),
        ),
      ).toString('utf8'),
    ),
  )
  for (const document of repositories) excluded.add(hash('sha256', document.text, 'hex'))
  const rows = selectEvaluationMessages(gunzipSync(bytes).toString('utf8'), excluded)
  if (rows.length < 300)
    throw createScriptError('The dataset cannot supply three complete evaluation batches.', {
      internal: { eligible: rows.length, required: 300 },
    })
  const output = path.resolve(values.out)
  await mkdir(output, { recursive: true })
  const batches = []
  for (let batch = 0; batch < 3; batch += 1) {
    const selected = rows.slice(batch * 100, (batch + 1) * 100)
    const payload = `${JSON.stringify(selected)}\n`
    const compressed = gzipSync(payload, { level: 9 })
    // The gzip header records no host operating system; payload hashes verify the selection.
    compressed[9] = 255
    const file = `oasst1-batch-${String(batch + 1).padStart(3, '0')}.json.gz`
    await writeFile(path.join(output, file), compressed)
    batches.push({
      file,
      messages: selected.length,
      sourceSha256: selected.map((message) => message.sha256),
      assetSha256: hash('sha256', compressed, 'hex'),
      uncompressedSha256: hash('sha256', payload, 'hex'),
      status: 'sealed',
    })
  }
  await writeFile(
    path.join(output, 'selection.json'),
    JSON.stringify(
      {
        ...DATASET,
        assetSha256: hash('sha256', bytes, 'hex'),
        batches,
      },
      null,
      2,
    ) + '\n',
  )
  await writeFile(path.join(output, 'LICENSE'), await readFile(values.license))
  process.stdout.write(
    JSON.stringify({ eligible: rows.length, sealedBatches: batches.length }) + '\n',
  )
}

if (import.meta.main) await main()
