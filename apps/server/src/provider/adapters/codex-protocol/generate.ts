import { createInternalError } from '../../../observability/structured-errors'

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CODEX_PROTOCOL_UPSTREAM_REF = 'be75785504ff152fa6333e380a2d50642f42fba0'

const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/openai/codex/${CODEX_PROTOCOL_UPSTREAM_REF}/codex-rs/app-server-protocol`
const USER_AGENT = 'platform-codex-protocol-generator'
const GENERATED_DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), 'generated')

/**
 * Codex adds enum members (reasoning efforts, plan types, item kinds) in
 * releases that ship faster than this pinned schema is regenerated. With a
 * closed `v.picklist` a single unknown member fails the whole payload — the
 * `max` and `ultra` efforts emptied the entire model list. Multi-member string
 * enums are therefore open: known members keep their literal types for
 * autocomplete and narrowing, unknown members pass through as plain strings and
 * are left for the caller to ignore. Single-member enums stay `v.literal` so
 * union discriminators keep discriminating.
 */
const OPEN_ENUM_HELPER_SOURCE = `function openEnum<const TOptions extends readonly string[]>(options: TOptions) {
  return v.union([
    v.picklist(options),
    // \`string & {}\` keeps the known members in autocomplete while accepting new ones.
    v.pipe(v.string(), v.transform((value): TOptions[number] | (string & {}) => value)),
  ])
}`

const CLIENT_REQUEST_METHODS = [
  'initialize',
  'account/read',
  'model/list',
  'thread/start',
  'thread/resume',
  'turn/start',
  'turn/interrupt',
  'thread/read',
  'thread/list',
  'thread/rollback',
  'skills/list',
] as const

const SERVER_NOTIFICATION_METHODS = [
  'thread/started',
  'thread/status/changed',
  'thread/archived',
  'thread/unarchived',
  'thread/closed',
  'skills/changed',
  'thread/name/updated',
  'thread/tokenUsage/updated',
  'turn/started',
  'hook/started',
  'item/agentMessage/delta',
  'turn/completed',
  'hook/completed',
  'turn/diff/updated',
  'turn/plan/updated',
  'item/started',
  'item/autoApprovalReview/started',
  'item/autoApprovalReview/completed',
  'item/completed',
  'rawResponseItem/completed',
  'item/plan/delta',
  'command/exec/outputDelta',
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'serverRequest/resolved',
  'item/mcpToolCall/progress',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
  'account/updated',
  'account/rateLimits/updated',
  'app/list/updated',
  'externalAgentConfig/import/completed',
  'fs/changed',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta',
  'thread/compacted',
  'model/rerouted',
  'warning',
  'deprecationNotice',
  'configWarning',
  'thread/realtime/started',
  'thread/realtime/itemAdded',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/error',
  'thread/realtime/closed',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
  'account/login/completed',
  'error',
] as const

type ClientRequestMethod = (typeof CLIENT_REQUEST_METHODS)[number]
type ServerNotificationMethod = (typeof SERVER_NOTIFICATION_METHODS)[number]
type ProtocolNamespace = 'v1' | 'v2'
type JsonValue = boolean | null | number | string | JsonObject | JsonValue[]
type JsonObject = { readonly [key: string]: JsonValue }

type MethodEntry = {
  readonly method: string
  readonly paramsType?: string
}

type ProtocolSchemaFile = {
  readonly namespace: ProtocolNamespace
  readonly schemaName: string
  readonly typeName: string
}

export type GeneratedFile = {
  readonly path: string
  readonly text: string
}

type RenderContext = {
  readonly definitionNames: ReadonlyMap<string, string>
}

export async function generateCodexProtocolFiles(): Promise<GeneratedFile[]> {
  const methodMaps = await fetchMethodMaps()
  const schemaFiles = schemaFilesForMethodMaps(methodMaps)
  const documents = await Promise.all(
    schemaFiles.map(async (file) => ({
      document: await fetchSchemaFile(file),
      file,
    })),
  )

  return formatGeneratedFiles([
    {
      path: path.join(GENERATED_DIR, 'schema.gen.ts'),
      text: renderSchemaModule(documents),
    },
    {
      path: path.join(GENERATED_DIR, 'meta.gen.ts'),
      text: renderMetaModule(methodMaps),
    },
  ])
}

export async function writeCodexProtocolFiles(input: { check: boolean }) {
  const files = await generateCodexProtocolFiles()
  if (input.check) {
    await assertGeneratedFilesCurrent(files)
    return
  }

  await mkdir(GENERATED_DIR, { recursive: true })
  for (const file of files) {
    await writeFile(file.path, file.text)
  }
}

export function renderValibotExpressionForTest(schema: JsonObject) {
  return renderSchemaExpression(schema, { definitionNames: new Map() })
}

async function assertGeneratedFilesCurrent(files: readonly GeneratedFile[]) {
  for (const file of files) {
    const current = await readFile(file.path, 'utf8').catch(() => null)
    if (current === file.text) continue

    throw createInternalError(`Generated Codex protocol file is stale: ${file.path}`)
  }
}

async function formatGeneratedFiles(files: readonly GeneratedFile[]) {
  return Promise.all(
    files.map(async (file) => ({
      ...file,
      text: await formatGeneratedText(file.path, file.text),
    })),
  )
}

async function formatGeneratedText(filePath: string, text: string) {
  const result = await runFormatter(filePath, text)
  if (result.code === 0) return result.stdout

  throw createInternalError(`oxfmt failed for ${filePath}: ${result.stderr}`)
}

function runFormatter(filePath: string, text: string) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn('bun', ['oxfmt', '--stdin-filepath', filePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stderr: Buffer[] = []
    const stdout: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) =>
      resolve({
        code,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      }),
    )
    child.stdin.end(text)
  })
}

async function fetchMethodMaps() {
  const [clientRequestRaw, serverNotificationRaw] = await Promise.all([
    fetchText(`${GITHUB_RAW_BASE}/schema/typescript/ClientRequest.ts`),
    fetchText(`${GITHUB_RAW_BASE}/schema/typescript/ServerNotification.ts`),
  ])
  const clientRequests = parseRequestEntries(clientRequestRaw).filter((entry) =>
    isClientRequestMethod(entry.method),
  )
  const serverNotifications = parseNotificationEntries(serverNotificationRaw).filter((entry) =>
    isServerNotificationMethod(entry.method),
  )

  assertMethodsPresent(CLIENT_REQUEST_METHODS, clientRequests, 'client request')
  assertMethodsPresent(SERVER_NOTIFICATION_METHODS, serverNotifications, 'server notification')

  return { clientRequests, serverNotifications }
}

function schemaFilesForMethodMaps(methodMaps: {
  readonly clientRequests: readonly MethodEntry[]
  readonly serverNotifications: readonly MethodEntry[]
}) {
  const files = new Map<string, ProtocolSchemaFile>()
  for (const entry of methodMaps.clientRequests) {
    addSchemaFile(files, schemaFileForMethodType(entry.method, requiredType(entry)))
    addSchemaFile(files, schemaFileForMethodType(entry.method, responseTypeName(entry)))
  }
  for (const entry of methodMaps.serverNotifications) {
    addSchemaFile(files, schemaFileForMethodType(entry.method, requiredType(entry)))
  }

  return [...files.values()].sort((left, right) => left.typeName.localeCompare(right.typeName))
}

function addSchemaFile(files: Map<string, ProtocolSchemaFile>, file: ProtocolSchemaFile) {
  files.set(`${file.namespace}/${file.schemaName}`, file)
}

function schemaFileForMethodType(method: string, schemaName: string): ProtocolSchemaFile {
  const namespace = method === 'initialize' ? 'v1' : 'v2'
  const typeName = `${namespace.toUpperCase()}${schemaName}`
  return { namespace, schemaName, typeName }
}

async function fetchSchemaFile(file: ProtocolSchemaFile) {
  const url = `${GITHUB_RAW_BASE}/schema/json/${file.namespace}/${file.schemaName}.json`
  return asJsonObject(JSON.parse(await fetchText(url)), url)
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw createInternalError(`Failed to download ${url}: ${response.status} ${detail}`)
  }

  return response.text()
}

function parseRequestEntries(fileContents: string): readonly MethodEntry[] {
  const entryPattern = /\{\s*"method":\s*"([^"]+)",\s*id:\s*RequestId,\s*params:\s*([^,}]+)/g
  const entries: MethodEntry[] = []
  let match: RegExpExecArray | null
  while ((match = entryPattern.exec(fileContents)) !== null) {
    entries.push({ method: match[1] ?? '', paramsType: match[2]?.trim() })
  }

  return entries
}

function parseNotificationEntries(fileContents: string): readonly MethodEntry[] {
  const entryPattern = /\{\s*"method":\s*"([^"]+)"(?:,\s*"params":\s*([^ }]+))?\s*\}/g
  const entries: MethodEntry[] = []
  let match: RegExpExecArray | null
  while ((match = entryPattern.exec(fileContents)) !== null) {
    const paramsType = match[2]?.trim()
    entries.push({ method: match[1] ?? '', ...(paramsType ? { paramsType } : {}) })
  }

  return entries
}

function responseTypeName(entry: MethodEntry) {
  const paramsType = requiredType(entry)
  if (paramsType.endsWith('Params')) return `${paramsType.slice(0, -'Params'.length)}Response`

  return `${toPascalCaseMethod(entry.method)}Response`
}

function requiredType(entry: MethodEntry) {
  if (entry.paramsType && entry.paramsType !== 'undefined') return entry.paramsType

  throw createInternalError(`Codex protocol entry is missing params type: ${entry.method}`)
}

function assertMethodsPresent(
  expected: readonly string[],
  entries: readonly MethodEntry[],
  label: string,
) {
  const actual = new Set(entries.map((entry) => entry.method))
  for (const method of expected) {
    if (actual.has(method)) continue

    throw createInternalError(`Pinned Codex protocol is missing ${label} method: ${method}`)
  }
}

function isClientRequestMethod(method: string): method is ClientRequestMethod {
  return (CLIENT_REQUEST_METHODS as readonly string[]).includes(method)
}

function isServerNotificationMethod(method: string): method is ServerNotificationMethod {
  return (SERVER_NOTIFICATION_METHODS as readonly string[]).includes(method)
}

function renderSchemaModule(
  documents: readonly { readonly document: JsonObject; readonly file: ProtocolSchemaFile }[],
) {
  const sections = documents.flatMap(({ document, file }) => renderSchemaFile(file, document))
  return [
    ...generatedPrelude(),
    "import * as v from 'valibot'",
    '',
    OPEN_ENUM_HELPER_SOURCE,
    '',
    ...sections,
    '',
  ].join('\n')
}

function renderSchemaFile(file: ProtocolSchemaFile, document: JsonObject) {
  const definitions = objectField(document, 'definitions')
  const definitionNames = new Map(
    Object.keys(definitions).map((name) => [name, `${file.typeName}__${sanitizeIdentifier(name)}`]),
  )
  const context = { definitionNames }
  const sections: string[] = []

  for (const name of orderedDefinitionNames(definitions)) {
    sections.push(
      renderNamedSchema(definitionNames.get(name) ?? name, objectField(definitions, name), context),
    )
  }
  sections.push(renderNamedSchema(file.typeName, document, context))

  return sections
}

function renderNamedSchema(typeName: string, schema: JsonObject, context: RenderContext) {
  const schemaConst = schemaConstName(typeName)
  return [
    `export const ${schemaConst} = ${renderSchemaExpression(schema, context)}`,
    `export type ${typeName} = v.InferOutput<typeof ${schemaConst}>`,
    '',
  ].join('\n')
}

function orderedDefinitionNames(definitions: JsonObject) {
  const names = Object.keys(definitions).sort()
  const ordered: string[] = []
  const permanent = new Set<string>()
  const temporary = new Set<string>()

  for (const name of names) {
    visitDefinition(name, { definitions, names: new Set(names), ordered, permanent, temporary })
  }

  return ordered
}

function visitDefinition(
  name: string,
  input: {
    readonly definitions: JsonObject
    readonly names: ReadonlySet<string>
    readonly ordered: string[]
    readonly permanent: Set<string>
    readonly temporary: Set<string>
  },
) {
  if (input.permanent.has(name)) return
  if (input.temporary.has(name))
    throw createInternalError(`Cyclic Codex protocol definition: ${name}`)

  input.temporary.add(name)
  for (const dependency of localReferences(objectField(input.definitions, name))) {
    if (dependency === name) continue
    if (!input.names.has(dependency)) continue

    visitDefinition(dependency, input)
  }
  input.temporary.delete(name)
  input.permanent.add(name)
  input.ordered.push(name)
}

function localReferences(schema: JsonValue) {
  const references: string[] = []
  collectLocalReferences(schema, references)
  return references
}

function collectLocalReferences(schema: JsonValue, references: string[]) {
  if (Array.isArray(schema)) {
    for (const item of schema) collectLocalReferences(item, references)
    return
  }
  if (!isJsonObject(schema)) return

  const ref = stringField(schema, '$ref')
  if (ref?.startsWith('#/definitions/')) references.push(ref.slice('#/definitions/'.length))
  for (const value of Object.values(schema)) collectLocalReferences(value, references)
}

function renderSchemaExpression(schema: JsonObject, context: RenderContext): string {
  const ref = stringField(schema, '$ref')
  if (ref) return renderRef(ref, context)

  const allOf = arrayField(schema, 'allOf')
  if (allOf.length === 1 && isJsonObject(allOf[0])) return renderSchemaExpression(allOf[0], context)
  if (allOf.length > 1) return renderUnion(allOf, context)

  if ('const' in schema) return renderLiteral(schema.const)

  const enumValues = arrayField(schema, 'enum')
  if (enumValues.length > 0) return renderEnum(enumValues)

  const oneOf = arrayField(schema, 'oneOf')
  if (oneOf.length > 0) return renderUnion(oneOf, context)

  const anyOf = arrayField(schema, 'anyOf')
  if (anyOf.length > 0) return renderUnion(anyOf, context)

  return renderSchemaByType(schema, context)
}

function renderSchemaByType(schema: JsonObject, context: RenderContext): string {
  const rawType = schema.type
  if (Array.isArray(rawType))
    return renderUnion(
      rawType.map((type) => ({ ...schema, type })),
      context,
    )
  if (rawType === 'object') return renderObjectSchema(schema, context)
  if (rawType === 'array') return `v.array(${renderArrayItemSchema(schema, context)})`
  if (rawType === 'string') return 'v.string()'
  if (rawType === 'integer') return renderNumberSchema(schema, true)
  if (rawType === 'number') return renderNumberSchema(schema, false)
  if (rawType === 'boolean') return 'v.boolean()'
  if (rawType === 'null') return 'v.null()'
  if ('properties' in schema || 'additionalProperties' in schema) {
    return renderObjectSchema(schema, context)
  }

  return 'v.unknown()'
}

function renderUnion(values: readonly JsonValue[], context: RenderContext): string {
  const expressions = values
    .filter(isJsonObject)
    .map((value) => renderSchemaExpression(value, context))
    .filter((value, index, array) => array.indexOf(value) === index)
  if (expressions.length === 0) return 'v.unknown()'
  if (expressions.length === 1) return expressions[0] ?? 'v.unknown()'

  const literals = expressions.map(stringLiteralOfExpression)
  if (literals.every(isString)) return renderOpenEnum(literals)

  return `v.union([${expressions.join(', ')}])`
}

/**
 * `oneOf` lists of documented `const`s and plain `enum` arrays are the same
 * closed set once rendered, so both go through the open-enum helper.
 */
function stringLiteralOfExpression(expression: string) {
  const match = /^v\.literal\((".*")\)$/.exec(expression)
  if (!match?.[1]) return null

  const value: unknown = JSON.parse(match[1])
  return typeof value === 'string' ? value : null
}

function renderOpenEnum(values: readonly string[]) {
  return `openEnum(${JSON.stringify(values)})`
}

function renderObjectSchema(schema: JsonObject, context: RenderContext): string {
  const properties = objectField(schema, 'properties')
  const required = new Set(stringArrayField(schema, 'required'))
  const entries = Object.entries(properties).map(([key, value]) =>
    renderObjectEntry(key, value, required.has(key), context),
  )
  const entriesSource = `{${entries.join(', ')}}`
  const additionalProperties = schema.additionalProperties

  if (isJsonObject(additionalProperties)) {
    const rest = renderSchemaExpression(additionalProperties, context)
    if (entries.length > 0) return `v.objectWithRest(${entriesSource}, ${rest})`

    return `v.record(v.string(), ${rest})`
  }

  return `v.looseObject(${entriesSource})`
}

function renderObjectEntry(
  key: string,
  schema: JsonValue,
  required: boolean,
  context: RenderContext,
) {
  const expression = isJsonObject(schema) ? renderSchemaExpression(schema, context) : 'v.unknown()'
  return `${JSON.stringify(key)}: ${required ? expression : `v.optional(${expression})`}`
}

function renderArrayItemSchema(schema: JsonObject, context: RenderContext) {
  const items = schema.items
  if (!isJsonObject(items)) return 'v.unknown()'

  return renderSchemaExpression(items, context)
}

function renderNumberSchema(schema: JsonObject, integer: boolean) {
  const actions = integer ? ['v.number()', 'v.integer()'] : ['v.number()']
  if (typeof schema.minimum === 'number') actions.push(`v.minValue(${schema.minimum})`)
  if (actions.length === 1) return actions[0] ?? 'v.number()'

  return `v.pipe(${actions.join(', ')})`
}

function renderEnum(values: readonly JsonValue[]) {
  if (values.length === 1) return renderLiteral(values[0])
  if (values.every(isString)) return renderOpenEnum(values)
  if (values.every(isPicklistValue)) return `v.picklist(${JSON.stringify(values)})`

  return `v.union([${values.map(renderLiteral).join(', ')}])`
}

function renderLiteral(value: JsonValue | undefined) {
  if (value === null) return 'v.null()'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `v.literal(${JSON.stringify(value)})`
  }

  return 'v.unknown()'
}

function renderRef(ref: string, context: RenderContext) {
  const prefix = '#/definitions/'
  if (!ref.startsWith(prefix)) throw createInternalError(`Unsupported Codex protocol ref: ${ref}`)

  const name = ref.slice(prefix.length)
  const typeName = context.definitionNames.get(name)
  if (!typeName) throw createInternalError(`Unknown Codex protocol ref: ${ref}`)

  return schemaConstName(typeName)
}

function renderMetaModule(methodMaps: {
  readonly clientRequests: readonly MethodEntry[]
  readonly serverNotifications: readonly MethodEntry[]
}) {
  return [
    ...generatedPrelude(),
    "import * as CodexSchema from './schema.gen'",
    '',
    renderMethodConstants('CODEX_CLIENT_REQUEST_METHODS', methodMaps.clientRequests),
    renderMethodConstants('CODEX_SERVER_NOTIFICATION_METHODS', methodMaps.serverNotifications),
    'export type CodexClientRequestMethod = keyof typeof CODEX_CLIENT_REQUEST_METHODS',
    'export type CodexServerNotificationMethod = keyof typeof CODEX_SERVER_NOTIFICATION_METHODS',
    '',
    renderMethodTypeInterface(
      'CodexClientRequestParamsByMethod',
      methodMaps.clientRequests,
      (entry) => schemaFileForMethodType(entry.method, requiredType(entry)).typeName,
    ),
    renderMethodTypeInterface(
      'CodexClientRequestResultByMethod',
      methodMaps.clientRequests,
      (entry) => schemaFileForMethodType(entry.method, responseTypeName(entry)).typeName,
    ),
    renderMethodTypeInterface(
      'CodexServerNotificationParamsByMethod',
      methodMaps.serverNotifications,
      (entry) => schemaFileForMethodType(entry.method, requiredType(entry)).typeName,
    ),
    renderSchemaMap(
      'CODEX_CLIENT_REQUEST_PARAMS',
      methodMaps.clientRequests,
      (entry) => schemaFileForMethodType(entry.method, requiredType(entry)).typeName,
    ),
    renderSchemaMap(
      'CODEX_CLIENT_REQUEST_RESULTS',
      methodMaps.clientRequests,
      (entry) => schemaFileForMethodType(entry.method, responseTypeName(entry)).typeName,
    ),
    renderSchemaMap(
      'CODEX_SERVER_NOTIFICATION_PARAMS',
      methodMaps.serverNotifications,
      (entry) => schemaFileForMethodType(entry.method, requiredType(entry)).typeName,
    ),
  ].join('\n')
}

function renderMethodConstants(constantName: string, entries: readonly MethodEntry[]) {
  return [
    `export const ${constantName} = {`,
    ...entries.map(
      (entry) => `  ${JSON.stringify(entry.method)}: ${JSON.stringify(entry.method)},`,
    ),
    '} as const',
    '',
  ].join('\n')
}

function renderMethodTypeInterface(
  interfaceName: string,
  entries: readonly MethodEntry[],
  typeName: (entry: MethodEntry) => string,
) {
  return [
    `export interface ${interfaceName} {`,
    ...entries.map(
      (entry) => `  readonly ${JSON.stringify(entry.method)}: CodexSchema.${typeName(entry)}`,
    ),
    '}',
    '',
  ].join('\n')
}

function renderSchemaMap(
  constantName: string,
  entries: readonly MethodEntry[],
  typeName: (entry: MethodEntry) => string,
) {
  return [
    `export const ${constantName} = {`,
    ...entries.map(
      (entry) =>
        `  ${JSON.stringify(entry.method)}: CodexSchema.${schemaConstName(typeName(entry))},`,
    ),
    '} as const',
    '',
  ].join('\n')
}

function generatedPrelude() {
  return [
    '// This file is generated by apps/server/src/provider/adapters/codex-protocol/generate.ts. Do not edit manually.',
    `// Upstream Codex protocol ref: ${CODEX_PROTOCOL_UPSTREAM_REF}`,
    '',
  ]
}

function schemaConstName(typeName: string) {
  return `${typeName}Schema`
}

function toPascalCaseMethod(method: string) {
  return method
    .split('/')
    .flatMap((segment) => segment.split(/(?=[A-Z])/))
    .flatMap((segment) => segment.split(/[-_]/))
    .filter(Boolean)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ''}${segment.slice(1)}`)
    .join('')
}

function sanitizeIdentifier(value: string) {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, '')
  if (/^[A-Za-z_]/.test(sanitized)) return sanitized

  return `_${sanitized}`
}

function objectField(value: JsonObject, key: string): JsonObject {
  const child = value[key]
  return isJsonObject(child) ? child : {}
}

function arrayField(value: JsonObject, key: string): readonly JsonValue[] {
  const child = value[key]
  return Array.isArray(child) ? child : []
}

function stringArrayField(value: JsonObject, key: string) {
  return arrayField(value, key).filter((item): item is string => typeof item === 'string')
}

function stringField(value: JsonObject, key: string) {
  const child = value[key]
  return typeof child === 'string' ? child : null
}

function isJsonObject(value: JsonValue | unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isPicklistValue(value: JsonValue): value is boolean | number | string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function asJsonObject(value: unknown, source: string): JsonObject {
  if (isJsonObject(value)) return value

  throw createInternalError(`Expected JSON object from ${source}`)
}

if (import.meta.main) {
  await writeCodexProtocolFiles({ check: process.argv.includes('--check') })
}
