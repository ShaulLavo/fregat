import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, expect, test } from 'vitest'

import { initializeTreeSitterMarkdown } from '../../packages/markdown/src/utils/tree-sitter-session'
import {
  assertFrozenIdentity,
  browserInput,
  compareProjections,
  evaluateNativeMessage,
  evaluationCounts,
  heldoutSchedules,
  parseBrowserInput,
  parseBrowserReceipt,
  parseReport,
  reserveEvaluationExposure,
  retireEvaluationBatch,
  validateBrowserEvaluation,
  validateEvaluationMessages,
  type CandidateIdentity,
  type EvaluationBatch,
  type EvaluationMessage,
} from './evaluate-heldout'

const temporary = new Set<string>()
afterEach(async () => {
  for (const directory of temporary) await rm(directory, { recursive: true, force: true })
  temporary.clear()
})
beforeAll(() => initializeTreeSitterMarkdown())
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const fingerprint: CandidateIdentity = {
  candidateCommit: 'a'.repeat(40),
  candidateSourceSha256: hash('owned-source'),
  artifacts: {
    grammarSha256: hash('grammar'),
    chatGrammarSha256: hash('chat-grammar'),
    resolverSha256: hash('resolver'),
    runtimeWasmSha256: hash('runtime-wasm'),
    runtimeBindingSha256: hash('runtime-binding'),
    parserBindingSha256: hash('parser-binding'),
    parserSemanticsSha256: hash('semantics'),
    parserConstantsSha256: hash('constants'),
    lockfileSha256: hash('lock'),
  },
}
function message(index: number, source = `Owned **message ${index}**.\n`): EvaluationMessage {
  return {
    id: `owned-${index}`,
    source,
    sha256: hash(source),
    createdDate: '2023-04-01',
    provenance: {
      dataset: 'owned-control',
      revision: 'b'.repeat(40),
      license: 'MIT',
      url: 'https://example.test/owned-controls',
    },
    split: 'evaluation',
  }
}
const messages = Array.from({ length: 100 }, (_, index) => message(index))
function batch(): EvaluationBatch {
  return {
    file: 'oasst1-batch-999.json.gz',
    messages: 100,
    sourceSha256: messages.map((entry) => entry.sha256),
    assetSha256: hash('owned-compressed-control'),
    uncompressedSha256: hash('owned-payload'),
    status: 'sealed',
  }
}
function manifest() {
  return {
    schemaVersion: 1 as const,
    dataset: 'owned-control',
    revision: 'b'.repeat(40),
    license: 'MIT',
    asset: 'owned',
    assetSha256: hash('asset'),
    selection: 'Owned controls only',
    batches: [batch()],
  }
}
async function scratch() {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-heldout-control-'))
  temporary.add(directory)
  return directory
}

test('the frozen candidate rejects changes to commits, installed WASM and binding identity', () => {
  expect(() => assertFrozenIdentity(fingerprint, fingerprint)).not.toThrow()
  expect(() =>
    assertFrozenIdentity({ ...fingerprint, candidateCommit: 'c'.repeat(40) }, fingerprint),
  ).toThrow()
  expect(() =>
    assertFrozenIdentity(
      { ...fingerprint, artifacts: { ...fingerprint.artifacts, resolverSha256: hash('changed') } },
      fingerprint,
    ),
  ).toThrow()
  expect(() =>
    assertFrozenIdentity(
      {
        ...fingerprint,
        artifacts: { ...fingerprint.artifacts, parserBindingSha256: hash('changed binding') },
      },
      fingerprint,
    ),
  ).toThrow()
})

test.each(['grammarSha256', 'chatGrammarSha256'] as const)(
  'the frozen identity independently rejects changed %s',
  (field) => {
    expect(() =>
      assertFrozenIdentity(
        {
          ...fingerprint,
          artifacts: { ...fingerprint.artifacts, [field]: hash('changed grammar') },
        },
        fingerprint,
      ),
    ).toThrow()
  },
)

test.each([undefined, null, '', 'not-a-hash', 'A'.repeat(64), 42])(
  'raw browser identities reject missing or malformed CHAT hash %s',
  (chatGrammarSha256) => {
    const candidate = {
      ...fingerprint,
      artifacts: { ...fingerprint.artifacts, chatGrammarSha256 },
    }
    expect(() =>
      parseBrowserInput({ ...browserInput(messages, fingerprint, batch()), candidate }),
    ).toThrow()
    expect(() => parseBrowserReceipt({ ...browserReceipt(), candidate })).toThrow()
  },
)

test('raw browser parsers retain the separate CHAT identity without stripping it', () => {
  const input = parseBrowserInput(browserInput(messages, fingerprint, batch()))
  const receipt = parseBrowserReceipt(browserReceipt())
  expect(input.candidate).toEqual(fingerprint)
  expect(receipt.candidate).toEqual(fingerprint)
  expect(input.candidate.artifacts.chatGrammarSha256).not.toBe(
    input.candidate.artifacts.grammarSha256,
  )
})

test('exposure is durable before content access and prevents reused or changed candidates', async () => {
  const directory = await scratch()
  const selected = batch()
  const input = {
    ledgerDirectory: directory,
    batch: selected,
    manifestSha256: hash('manifest'),
    candidate: fingerprint,
    receiptPath: path.join(directory, 'receipt.json'),
  }
  const ledger = await reserveEvaluationExposure(input)
  expect(ledger.state).toBe('exposed')
  const file = path.join(directory, `${selected.assetSha256}.json`)
  expect(JSON.parse(await readFile(file, 'utf8')).batch.messages).toBe(100)
  await expect(reserveEvaluationExposure(input)).rejects.toThrow()
  await expect(
    reserveEvaluationExposure({
      ...input,
      candidate: { ...fingerprint, candidateCommit: 'd'.repeat(40) },
    }),
  ).rejects.toThrow()
  await retireEvaluationBatch(
    directory,
    selected,
    'An evaluation-informed fix ends independence for all 100 messages.',
  )
  expect(JSON.parse(await readFile(file, 'utf8')).state).toBe('retired')
  await expect(reserveEvaluationExposure(input)).rejects.toThrow()
})

test('the loader preserves all raw authored source and rejects denominator/hash changes', () => {
  expect(validateEvaluationMessages(messages, manifest(), batch())).toEqual(messages)
  expect(() => validateEvaluationMessages(messages.slice(1), manifest(), batch())).toThrow()
  const modified = messages.map((entry, index) =>
    index === 7 ? { ...entry, source: entry.source + 'changed' } : entry,
  )
  expect(() => validateEvaluationMessages(modified, manifest(), batch())).toThrow()
  expect(() => validateEvaluationMessages(messages.toReversed(), manifest(), batch())).toThrow()
  const duplicate = messages.slice(0, 99).concat([messages[0]])
  expect(() => validateEvaluationMessages(duplicate, manifest(), batch())).toThrow()
})

test('eight seeded schedules, byte transport and exhaustive short prefixes remain distinct', () => {
  const source = 'BOM ﻿, emoji 👩🏽‍💻, é and CRLF\r\n**strong**'
  const schedules = heldoutSchedules(source)
  expect(schedules.filter((schedule) => schedule.id.startsWith('seed-'))).toHaveLength(8)
  expect(schedules).toEqual(heldoutSchedules(source))
  expect(schedules.find((schedule) => schedule.id === 'all-utf16-prefixes')?.offsets).toHaveLength(
    source.length + 1,
  )
  expect(schedules.find((schedule) => schedule.id === 'utf8-byte-transport')?.profile).toBe(
    'utf8-transport',
  )
  for (const schedule of schedules) expect(schedule.offsets.at(-1)).toBe(source.length)
  expect(
    heldoutSchedules('long '.repeat(200)).some((schedule) => schedule.id.startsWith('all-')),
  ).toBe(false)
})

test('safe projection comparison catches text, URL and source mapping differences', () => {
  const root = {
    type: 'root' as const,
    children: [
      {
        type: 'element' as const,
        tagName: 'a',
        properties: { href: '/one' },
        children: [{ type: 'text' as const, value: 'visible' }],
      },
    ],
  }
  expect(
    compareProjections({ root, source: 'visible' }, { root, source: 'visible' }, 7, false).status,
  ).toBe('passed')
  const changed = { ...root, children: [{ ...root.children[0], properties: { href: '/two' } }] }
  expect(
    compareProjections({ root, source: 'visible' }, { root: changed, source: 'visible' }, 7, false)
      .status,
  ).toBe('failed')
  const surrogate = {
    type: 'root' as const,
    children: [{ type: 'text' as const, value: '\ud83d' }],
  }
  const replacement = { type: 'root' as const, children: [{ type: 'text' as const, value: '�' }] }
  expect(
    compareProjections(
      { root: surrogate, source: '\ud83d' },
      { root: replacement, source: '\ud83d' },
      1,
      true,
    ).status,
  ).toBe('failed')
  const invalid = {
    ...root,
    position: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 40, offset: 40 },
    },
  }
  expect(
    compareProjections(
      { root: invalid, source: 'visible' },
      { root: invalid, source: 'visible' },
      7,
      false,
    ).failures.length,
  ).toBeGreaterThan(0)
})

test('owned real candidate replay records every prefix, fresh check and completed settlement', async () => {
  const result = await evaluateNativeMessage(
    message(0, 'Owned **strong**, [link](https://example.test), é.'),
  )
  const counts = evaluationCounts([result])
  expect(counts.nativeCases).toEqual({ total: 1, passed: 1, failed: 0 })
  expect(
    counts.streamCases.failed,
    JSON.stringify(
      result.streams.flatMap((stream) =>
        stream.checks
          .filter((check) => check.status === 'failed')
          .map((check) => ({ schedule: stream.schedule.id, ...check })),
      ),
    ),
  ).toBe(0)
  for (const stream of result.streams)
    expect(stream.checks.length).toBe(stream.schedule.offsets.length + 1)
})

const observation = {
  text: 'owned visible',
  elements: [{ tag: 'p', text: 'owned visible', attributes: {}, parents: [] }],
}
function browserFrame(source: string, live: boolean) {
  return { observation, inputSha256: hash(source), inputUtf16Units: source.length, live }
}
function browserReceipt() {
  const input = browserInput(messages, fingerprint, batch())
  return {
    candidate: fingerprint,
    batchAssetSha256: batch().assetSha256,
    productionBuildSha256: hash('actual-owned-build-control'),
    rows: input.messages.map((entry) => ({
      id: entry.id,
      sourceSha256: entry.sourceSha256,
      completed: Array.from({ length: 1 }, () => ({
        baseline: browserFrame(entry.source, false),
        candidate: browserFrame(entry.source, false),
      })),
      streams: entry.schedules.map((schedule) => ({
        scheduleId: schedule.id,
        observations: schedule.offsets
          .map((offset) => ({
            baseline: browserFrame(entry.source.slice(0, offset), true),
            candidate: browserFrame(entry.source.slice(0, offset), true),
          }))
          .concat([
            {
              baseline: browserFrame(entry.source, false),
              candidate: browserFrame(entry.source, false),
            },
          ]),
      })),
    })),
  }
}
test('browser receipts require every raw message, schedule and actual structured observation', () => {
  const input = browserInput(messages, fingerprint, batch())
  const receipt = browserReceipt()
  expect(validateBrowserEvaluation(input, receipt).cases).toEqual({
    total: 100,
    passed: 100,
    failed: 0,
  })
  expect(
    validateBrowserEvaluation(input, { ...receipt, rows: receipt.rows.slice(1) }).cases.failed,
  ).toBe(1)
  const omitted = receipt.rows.map((row, index) =>
    index === 1 ? { ...row, streams: row.streams.slice(1) } : row,
  )
  expect(validateBrowserEvaluation(input, { ...receipt, rows: omitted }).cases.failed).toBe(1)
  expect(() =>
    parseBrowserReceipt({
      ...receipt,
      rows: [
        {
          id: 'owned-0',
          sourceSha256: messages[0].sha256,
          completed: [{ baseline: {}, candidate: {} }],
          streams: [],
        },
      ],
    }),
  ).toThrow()
  expect(() =>
    parseReport({
      originalDenominator: 100,
      cases: [],
      counters: { nativeCases: { total: 100, passed: 100, failed: 0 } },
    }),
  ).toThrow()
})
