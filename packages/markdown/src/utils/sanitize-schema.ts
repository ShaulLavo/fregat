import { defaultSchema } from 'rehype-sanitize'

type Schema = typeof defaultSchema

const attributes = defaultSchema.attributes ?? {}
const protocols = defaultSchema.protocols ?? {}

/**
 * GitHub's schema, plus the fence metastring and the streaming marker on an
 * unfinished link, which the pipeline itself sets. Nothing a consumer passes
 * can loosen this; overrides only add rendering. The hast stage has already
 * prefixed ids, so the sanitizer must not prefix them again.
 */
export const MARKDOWN_SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: {
    ...attributes,
    a: [...(attributes.a ?? []), 'dataIncomplete'],
    code: [...(attributes.code ?? []), 'dataMeta'],
  },
  clobberPrefix: '',
  protocols: {
    ...protocols,
    href: [...(protocols.href ?? []), 'tel', 'vscode', 'vscode-insiders', 'ssh'],
  },
}
