import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import type { JsonObject } from '@workspace/utils/json'
import {
  CODEX_CLIENT_REQUEST_PARAMS,
  CODEX_CLIENT_REQUEST_RESULTS,
  CODEX_SERVER_NOTIFICATION_PARAMS,
  CodexAgentMessageDeltaNotificationSchema,
  CodexThreadStartParamsSchema,
  CodexTurnStartResponseSchema,
} from '../index'
import { renderSchemaModule, renderValibotExpressionForTest } from '../generate'
import * as generatedSchemas from '../generated/schema.gen'

describe('Codex protocol generator', () => {
  it('maps representative JSON schema features to Valibot source', () => {
    const source = renderValibotExpressionForTest({
      properties: {
        flags: {
          additionalProperties: { type: 'boolean' },
          type: 'object',
        },
        id: { type: 'string' },
        mode: { enum: ['fast', 'safe'], type: 'string' },
        score: { minimum: 0, type: 'integer' },
        tags: { items: { type: 'string' }, type: 'array' },
      },
      required: ['id', 'mode'],
      type: 'object',
    })

    expect(source).toContain('v.looseObject')
    expect(source).toContain('"id": v.string()')
    expect(source).toContain('"mode": openEnum(["fast","safe"])')
    expect(source).toContain('"score": v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)))')
    expect(source).toContain('"flags": v.optional(v.record(v.string(), v.boolean()))')
  })

  it('leaves single-member enums closed so union discriminators keep discriminating', () => {
    const source = renderValibotExpressionForTest({
      properties: { type: { enum: ['reasoning'], type: 'string' } },
      required: ['type'],
      type: 'object',
    })

    expect(source).toContain('"type": v.literal("reasoning")')
  })

  it('generates method maps for Platform-used Codex protocol methods', () => {
    expect(CODEX_CLIENT_REQUEST_PARAMS['thread/start']).toBe(CodexThreadStartParamsSchema)
    expect(CODEX_CLIENT_REQUEST_RESULTS['turn/start']).toBe(CodexTurnStartResponseSchema)
    expect(CODEX_SERVER_NOTIFICATION_PARAMS['item/agentMessage/delta']).toBe(
      CodexAgentMessageDeltaNotificationSchema,
    )
  })
})

async function generateSchemas(documents: readonly JsonObject[]) {
  const { text: source, schemaNames } = renderSchemaModule(
    documents.map((document, index) => ({
      document,
      file: { namespace: 'v2', schemaName: `Example${index}`, typeName: `V2Example${index}` },
    })),
  )
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.replace("from 'valibot'", `from ${JSON.stringify(import.meta.resolve('valibot'))}`),
  )
  const schemas: Record<string, v.GenericSchema> = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
  )
  expect(new Set(Object.values(schemas)).size).toBe(Object.keys(schemas).length)
  return [...schemaNames.values()].map((name) => schemas[`${name}Schema`]!)
}

describe('shared protocol schemas', () => {
  it('exports each generated validator under exactly one name', () => {
    const schemas = Object.values(generatedSchemas)
    expect(new Set(schemas).size).toBe(schemas.length)
    expect(CODEX_CLIENT_REQUEST_RESULTS['thread/start']).toBe(
      CODEX_CLIENT_REQUEST_RESULTS['thread/resume'],
    )
  })

  it('shares equivalent definitions through locally named references', async () => {
    const definitions = (name: string): JsonObject => ({
      [name]: {
        type: 'object',
        properties: { count: { type: 'integer', minimum: 0 } },
        required: ['count'],
      },
      Envelope: {
        type: 'object',
        properties: { payload: { $ref: `#/definitions/${name}` } },
        required: ['payload'],
      },
    })
    const schemas = await generateSchemas([
      { definitions: definitions('FirstPayload'), $ref: '#/definitions/Envelope' },
      { definitions: definitions('SecondPayload'), $ref: '#/definitions/Envelope' },
    ])

    expect(schemas[0]).toBe(schemas[1])
    expect(v.safeParse(schemas[0]!, { payload: { count: 1 } }).success).toBe(true)
    expect(v.safeParse(schemas[1]!, { payload: { count: -1 } }).success).toBe(false)
  })

  it('keeps local reference meanings and required fields distinct while sharing matching fields', async () => {
    const document = (type: string, required: string[]): JsonObject => ({
      definitions: { Value: { type } },
      type: 'object',
      properties: {
        alpha: { type: 'string' },
        beta: { type: 'boolean' },
        gamma: { type: 'integer' },
        value: { $ref: '#/definitions/Value' },
      },
      required,
    })
    const schemas = await generateSchemas([
      document('string', ['alpha', 'beta', 'gamma', 'value']),
      document('number', ['alpha', 'beta', 'gamma']),
    ])
    const common = { alpha: 'a', beta: true, gamma: 1, extra: 'preserved' }

    expect(v.safeParse(schemas[0]!, common).success).toBe(false)
    expect(v.parse(schemas[1]!, common)).toEqual(common)
    expect(v.safeParse(schemas[0]!, { ...common, value: 'text' }).success).toBe(true)
    expect(v.safeParse(schemas[1]!, { ...common, value: 'text' }).success).toBe(false)
    expect(v.safeParse(schemas[0]!, { ...common, value: 2 }).success).toBe(false)
    expect(v.safeParse(schemas[1]!, { ...common, value: 2 }).success).toBe(true)
  })
})
