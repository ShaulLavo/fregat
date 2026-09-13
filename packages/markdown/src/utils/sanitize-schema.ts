import { defaultSchema } from 'rehype-sanitize'

type Schema = typeof defaultSchema

const attributes = defaultSchema.attributes ?? {}

/**
 * GitHub's schema, plus the two properties the pipeline itself sets: the
 * streaming marker on an unfinished fence and on an unfinished link. Nothing
 * a consumer passes can loosen this; overrides only add rendering.
 */
export const MARKDOWN_SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: {
    ...attributes,
    a: [...(attributes.a ?? []), 'dataIncomplete'],
    code: [...(attributes.code ?? []), 'dataIncomplete'],
  },
}
