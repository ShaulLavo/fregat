import path from 'node:path'
import {
  importValue,
  importVisitors,
  isTest,
  resolvedImport,
  sourceLocation,
  webRelative,
} from './web-boundary-imports.mjs'
import { featureImport, readFeatureAllowance } from './web-feature-imports.mjs'

const DOCUMENTS = 'lib/documents/utils/'
const PATH_HELPERS = ['lib/path-formatters.ts', 'packages/client-core/src/files/path.ts']
const RESERVED_PREFIXES = [
  'git-ref:',
  'git-diff:',
  'compare-saved:',
  'conflict-diff:',
  'search-buffer:',
  'settings-json:',
  'settings:',
]
const PUBLIC_SCHEMAS = new Set(['sessionIdSchema'])

function containsDocumentPrefix(value) {
  const withoutContainerVariants = value.replace(/@[\w.-]+\/settings:/g, '')
  return RESERVED_PREFIXES.some((prefix) => withoutContainerVariants.includes(prefix))
}

function isProtected(location) {
  return location.relative.startsWith(DOCUMENTS) || PATH_HELPERS.includes(location.relative)
}

function pureDependencyAllowed(node, source, location) {
  if (source === 'valibot') return true
  if (source === '@workspace/contracts') return contractsImportAllowed(node)
  const resolved = resolvedImport(source, location)
  const relative = webRelative(resolved, location.root)
  if (relative.startsWith(DOCUMENTS)) return true
  if (relative === 'lib/path-formatters') return true
  return (
    resolved.replace(/\.ts$/, '') ===
    path.resolve(location.root, 'packages/client-core/src/files/path')
  )
}

function contractsImportAllowed(node) {
  if (node.type === 'TSImportType' || node.importKind === 'type' || node.exportKind === 'type')
    return true
  if (node.type !== 'ImportDeclaration' || node.specifiers.length === 0) return false
  return node.specifiers.every(
    (specifier) =>
      specifier.importKind === 'type' ||
      (specifier.type === 'ImportSpecifier' && PUBLIC_SCHEMAS.has(specifier.imported.name)),
  )
}

function rule(description, create) {
  return {
    meta: {
      type: 'problem',
      docs: { description },
      schema: [],
      messages: { boundary: description },
    },
    create,
  }
}

function featureImportsRule(context) {
  const location = sourceLocation(context.filename ?? context.getFilename())
  if (!location || isTest(location.filename)) return {}
  const allowance = readFeatureAllowance(location.root)
  return {
    Program(node) {
      if (allowance.reported) return
      allowance.reported = true
      for (const message of allowance.problems) context.report({ node, message })
    },
    ...importVisitors((node) => {
      const entry = featureImport(node, location)
      if (!entry || allowance.keys.has(entry.key)) return
      context.report({
        node,
        message: `Feature import ${entry.from} → ${entry.to}: ${entry.module} is not allow-listed. Move shared code below features.`,
      })
    }),
  }
}

export default {
  meta: { name: 'platform-boundaries' },
  rules: {
    'feature-imports': rule(
      'Features cannot import another feature without an exact allowance.',
      featureImportsRule,
    ),
    'lib-imports': rule('Production shared modules cannot import feature modules.', (context) => {
      const location = sourceLocation(context.filename ?? context.getFilename())
      if (!location?.relative.startsWith('lib/') || isTest(location.filename)) return {}
      return importVisitors((node) => {
        const source = importValue(node)
        if (!source) return
        const relative = webRelative(resolvedImport(source, location), location.root)
        if (relative.startsWith('features/')) context.report({ node, messageId: 'boundary' })
      })
    }),
    'document-dependencies': rule(
      'The document domain and its path helpers may depend only on protected pure modules and public contract types/schemas.',
      (context) => {
        const location = sourceLocation(context.filename ?? context.getFilename())
        if (!location || !isProtected(location)) return {}
        return importVisitors((node) => {
          const source = importValue(node)
          if (
            node.type === 'ImportExpression' ||
            node.type === 'CallExpression' ||
            node.type === 'TSImportEqualsDeclaration' ||
            !source ||
            !pureDependencyAllowed(node, source, location)
          )
            context.report({ node, messageId: 'boundary' })
        })
      },
    ),
    'document-codecs': rule(
      'Decode document identities only in the document codec or address/storage adapters.',
      (context) => {
        const location = sourceLocation(context.filename ?? context.getFilename())
        if (!location || isTest(location.filename) || location.relative.startsWith('test/'))
          return {}
        if (/^lib\/documents\/utils\/(?:codec|storage-codec)\.ts$/.test(location.relative))
          return {}
        if (
          location.relative === 'features/address/utils/document-token.ts' ||
          location.relative === 'features/workspace/state/cache.ts'
        )
          return {}
        return {
          Literal(node) {
            const value = typeof node.value === 'string' ? node.value : node.regex?.pattern
            if (typeof value !== 'string') return
            if (containsDocumentPrefix(value)) context.report({ node, messageId: 'boundary' })
          },
          TemplateElement(node) {
            if (containsDocumentPrefix(node.value.raw))
              context.report({ node, messageId: 'boundary' })
          },
        }
      },
    ),
  },
}
