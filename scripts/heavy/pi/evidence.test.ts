import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { collectEvidence, EVIDENCE_FAILED, laneExitCode } from './evidence'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), 'lane-evidence-'))
  roots.push(root)
  return root
}

test('copies a run directory that holds lane.json', () => {
  const root = scratch()
  mkdirSync(path.join(root, 'run'))
  writeFileSync(path.join(root, 'run/lane.json'), '{}')
  collectEvidence(path.join(root, 'run'), path.join(root, 'out'))
})

test('fails when the copy fails or lane.json is missing', () => {
  const root = scratch()
  expect(() => collectEvidence(path.join(root, 'absent'), path.join(root, 'out'))).toThrow(
    /failed with exit/,
  )
  mkdirSync(path.join(root, 'empty'))
  expect(() => collectEvidence(path.join(root, 'empty'), path.join(root, 'out2'))).toThrow(
    /lane.json/,
  )
})

test('keeps a failed command exit and fails a successful one whose evidence is missing', () => {
  expect(laneExitCode(3, false)).toBe(3)
  expect(laneExitCode(0, false)).toBe(EVIDENCE_FAILED)
  expect(laneExitCode(0, true)).toBe(0)
})
