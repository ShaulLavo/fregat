import { isJsonObject, type JsonObject, type JsonValue } from '@workspace/utils/json'
import { targetArgument } from './target-argument'
/** Generates the settings JSON Schema from the live descriptor registry. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { toJsonSchema } from '@valibot/to-json-schema'
import { format } from 'oxfmt'

import { SETTINGS_REGISTRY } from '../packages/contracts/src/settings/keys'

const DRAFT_07 = 'http://json-schema.org/draft-07/schema#'
const CONVERTER_OPTIONS: NonNullable<Parameters<typeof toJsonSchema>[1]> = {
  // Type brands, trimming, and cross-entry uniqueness have no draft-07 equivalent.
  ignoreActions: ['brand', 'check', 'trim'],
  target: 'draft-07',
}
const DEFAULT_TARGET = path.join(
  import.meta.dirname,
  '..',
  'packages',
  'contracts',
  'src',
  'settings',
  'schema.json',
)
const ORDER_INSENSITIVE_ARRAY_KEYS = new Set([
  'allOf',
  'anyOf',
  'enum',
  'oneOf',
  'required',
  'type',
])

export function generateSettingsSchema(): JsonObject {
  const properties = Object.fromEntries(
    Object.entries(SETTINGS_REGISTRY).map(([id, descriptor]) => [
      id,
      settingPropertySchema(descriptor),
    ]),
  )

  return normalizeSchema({
    $schema: DRAFT_07,
    additionalProperties: false,
    properties,
    type: 'object',
  }) as JsonObject
}

function settingPropertySchema(
  descriptor: (typeof SETTINGS_REGISTRY)[keyof typeof SETTINGS_REGISTRY],
): JsonObject {
  const converted = withoutRootSchema(
    toJsonSchema(descriptor.schema, CONVERTER_OPTIONS) as JsonObject,
  )
  const property: JsonObject = {
    ...converted,
    default: descriptor.default as JsonValue,
    description: descriptor.description,
    ...(descriptor.deprecationReason ? { deprecated: true } : {}),
  }
  const notes = [
    descriptor.dependsOn ? `Applies while \`${descriptor.dependsOn}\` is on.` : null,
    descriptor.deprecationReason ? `Deprecated: ${descriptor.deprecationReason}` : null,
  ].filter((note) => note !== null)
  if (notes.length === 0) return property

  return { ...property, markdownDescription: [descriptor.description, ...notes].join('\n\n') }
}

function withoutRootSchema(schema: JsonObject): JsonObject {
  const { $schema: _draft, ...property } = schema
  return property
}

function normalizeSchema(value: JsonValue, parentKey?: string): JsonValue {
  if (Array.isArray(value)) return normalizeArray(value, parentKey)
  if (!isJsonObject(value)) return value

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizeSchema(child, key)]),
  )
}

function normalizeArray(value: JsonValue[], parentKey?: string): JsonValue[] {
  const normalized = value.map((item) => normalizeSchema(item))
  if (!parentKey || !ORDER_INSENSITIVE_ARRAY_KEYS.has(parentKey)) return normalized

  return normalized.toSorted((left, right) => stableJson(left).localeCompare(stableJson(right)))
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(value)
}

async function schemaText(): Promise<string> {
  const source = `${JSON.stringify(generateSettingsSchema(), null, 2)}\n`
  const result = await format('schema.json', source)
  return result.code
}

async function writeSchema(target: string): Promise<void> {
  const content = await schemaText()
  await writeFile(target, content, 'utf8')
  console.log(`wrote ${target} (${Object.keys(SETTINGS_REGISTRY).length} settings)`)
}

async function checkSchema(target: string): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-settings-schema-'))
  const generated = path.join(directory, 'schema.json')

  try {
    await writeFile(generated, await schemaText(), 'utf8')
    const [actual, expected] = await Promise.all([
      readFile(target, 'utf8').catch(() => ''),
      readFile(generated, 'utf8'),
    ])
    if (actual === expected) return

    console.error(`settings schema is stale: run bun run settings:schema`)
    process.exitCode = 1
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** A valueless `--target` used to fall through to the default and overwrite it. */

const target = targetArgument(DEFAULT_TARGET)
if (process.argv.includes('--check')) await checkSchema(target)
else await writeSchema(target)
