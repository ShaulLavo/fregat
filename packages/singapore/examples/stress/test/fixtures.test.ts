import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createManifest } from '../fixtures.mjs'
import { fixtureFacts, generateFixture, normalizedText } from '../src/fixtures.ts'
import { createDocumentSession, createEditorTextBuffer } from '@singapore-editor/core/document'

describe('versioned stress fixtures', () => {
  it('reproduces every checked hash and count, and changes seeded code with the seed', () => {
    const checked = JSON.parse(
      readFileSync(new URL('../results/manifest.json', import.meta.url), 'utf8'),
    )
    expect(createManifest()).toEqual(checked)
    expect(createManifest()).toEqual(createManifest())
    expect(generateFixture('ordinary', 1)).not.toBe(generateFixture('ordinary', 2))
    expect(fixtureFacts(generateFixture('short-lines')).lines).toBe(500_000)
    expect(fixtureFacts(generateFixture('long-line')).longestLine).toBeGreaterThan(1_048_576)
  })

  it('preserves surrogate and combining boundaries through real document edits', () => {
    const text = generateFixture('unicode')
    expect(text.slice(4095, 4099)).toBe('😀e\u0301')
    const buffer = createDocumentSession(text)
    buffer.applyEdits([{ from: 4095, to: 4099, text: '👩🏽‍💻' }])
    expect(buffer.materializeFullText()).toBe(text.slice(0, 4095) + '👩🏽‍💻' + text.slice(4099))
    buffer.undo()
    expect(buffer.materializeFullText()).toBe(text)
  })

  it('counts CRLF as one break and preserves the final empty line', () => {
    const text = generateFixture('mixed-endings')
    expect(text).toContain('\r\n')
    expect(text).toMatch(/[^\r]\n/)
    expect(text).toMatch(/\r[^\n]/)
    expect(fixtureFacts(text).lines).toBe(3001)
    expect(createEditorTextBuffer(text).materializeFullText()).toBe(normalizedText(text))
  })
})
