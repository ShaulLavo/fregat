import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { descriptorFor, SETTING_IDS } from '../settings/keys'
import { SETTINGS_JSON_SCHEMA } from '../settings/schema'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('settings JSON Schema', () => {
  it('contains every registered key and only registered keys', () => {
    expect(Object.keys(SETTINGS_JSON_SCHEMA.properties)).toEqual([...SETTING_IDS].toSorted())
  })

  it('derives descriptions and defaults from each descriptor', () => {
    for (const id of SETTING_IDS) {
      const property = SETTINGS_JSON_SCHEMA.properties[id]
      const descriptor = descriptorFor(id)

      expect(property.description).toBe(descriptor.description)
      expect(property.default).toEqual(descriptor.default)
    }
  })

  it('preserves enum, numeric, and string constraints', () => {
    expect(SETTINGS_JSON_SCHEMA.properties['workbench.colorTheme']).toMatchObject({
      enum: ['dark', 'light', 'system'],
      type: 'string',
    })
    expect(SETTINGS_JSON_SCHEMA.properties['editor.fontSize']).toMatchObject({
      maximum: 72,
      minimum: 6,
      type: 'integer',
    })
    expect(SETTINGS_JSON_SCHEMA.properties['editor.fontFamily']).toMatchObject({
      maxLength: 160,
      minLength: 3,
      type: 'string',
    })
  })

  it('allows omitted settings and rejects unknown root keys', () => {
    expect('required' in SETTINGS_JSON_SCHEMA).toBe(false)
    expect(SETTINGS_JSON_SCHEMA.additionalProperties).toBe(false)
  })

  it('fails the schema check when the checked artifact drifts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'platform-settings-schema-test-'))
    temporaryDirectories.push(directory)
    const target = path.join(directory, 'schema.json')
    await writeFile(target, '{}\n', 'utf8')

    const result = spawnSync(
      'bun',
      ['scripts/generate-settings-schema.ts', '--check', '--target', target],
      {
        cwd: path.resolve(import.meta.dirname, '../../../..'),
        encoding: 'utf8',
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('settings schema is stale')
  })
})
