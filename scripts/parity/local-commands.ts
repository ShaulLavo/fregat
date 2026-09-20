import assert from 'node:assert/strict'
import {
  clientOrchestrationCommandSchema,
  internalOrchestrationCommandSchema,
} from '../../packages/contracts/src/orchestration-commands'

function commandTypes(schema: unknown): string[] {
  assert(schema !== null && typeof schema === 'object', 'Expected a command schema')
  if ('options' in schema) {
    assert(Array.isArray(schema.options), 'Expected variant options')
    return schema.options.flatMap(commandTypes)
  }
  assert('entries' in schema && schema.entries !== null && typeof schema.entries === 'object')
  assert('type' in schema.entries)
  const discriminator = schema.entries.type
  assert(discriminator !== null && typeof discriminator === 'object')
  assert('literal' in discriminator && typeof discriminator.literal === 'string')
  return [discriminator.literal]
}

process.stdout.write(
  JSON.stringify({
    client: [...new Set(commandTypes(clientOrchestrationCommandSchema))].sort(),
    internal: [...new Set(commandTypes(internalOrchestrationCommandSchema))].sort(),
  }) + '\n',
)
