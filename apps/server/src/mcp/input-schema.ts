import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import type * as v from 'valibot'

/**
 * A valibot schema the SDK can list and validate: valibot supplies the Standard Schema check,
 * and the JSON schema agents read is written beside it.
 */
export function toolInput<Output>(
  schema: v.GenericSchema<unknown, Output>,
  jsonSchema: Record<string, unknown>,
): StandardSchemaWithJSON<unknown, Output> {
  return {
    '~standard': {
      ...schema['~standard'],
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    },
  }
}
