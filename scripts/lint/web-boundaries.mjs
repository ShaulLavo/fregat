import path from 'node:path'

const WEB_SOURCE = '/apps/web/src/'
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

function sourceLocation(filename) {
  const normalized = filename.replaceAll('\\', '/')
  const webIndex = normalized.lastIndexOf(WEB_SOURCE)
  if (webIndex >= 0)
    return {
      root: normalized.slice(0, webIndex),
      relative: normalized.slice(webIndex + WEB_SOURCE.length),
      filename: normalized,
    }
  const helper = PATH_HELPERS.find((entry) => normalized.endsWith(`/${entry}`))
  if (!helper) return null
  return { root: normalized.slice(0, -helper.length - 1), relative: helper, filename: normalized }
}

function isTest(filename) {
  return /\.(?:test|spec|browser|test-d)\.[cm]?[jt]sx?$/.test(filename)
}

function resolvedImport(source, location) {
  if (source.startsWith('@/')) return path.resolve(location.root, `apps/web/src/${source.slice(2)}`)
  if (source.startsWith('.')) return path.resolve(path.dirname(location.filename), source)
  if (source === '@workspace/client-core/files/path')
    return path.resolve(location.root, 'packages/client-core/src/files/path')
  return source
}

function webRelative(filename, root) {
  const relative = path.relative(path.resolve(root, 'apps/web/src'), filename).replaceAll('\\', '/')
  return relative.replace(/\.(?:[cm]?[jt]sx?)$/, '')
}

function importVisitors(check) {
  return {
    ImportDeclaration: check,
    ExportNamedDeclaration(node) {
      if (node.source) check(node)
    },
    ExportAllDeclaration: check,
    ImportExpression: check,
    TSImportType: check,
    TSImportEqualsDeclaration: check,
    CallExpression(node) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return
      check(node)
    },
  }
}

function importValue(node) {
  const source = node.source ?? node.arguments?.[0] ?? node.moduleReference?.expression
  if (typeof source?.value === 'string') return source.value
  return null
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

export default {
  meta: { name: 'platform-boundaries' },
  rules: {
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
