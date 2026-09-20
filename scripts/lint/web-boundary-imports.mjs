import path from 'node:path'

const WEB_SOURCE = '/apps/web/src/'
const PATH_HELPERS = ['lib/path-formatters.ts', 'packages/client-core/src/files/path.ts']

export function sourceLocation(filename) {
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

export function isTest(filename) {
  return /\.(?:test|spec|browser|test-d)\.[cm]?[jt]sx?$/.test(filename)
}

export function resolvedImport(source, location) {
  if (source.startsWith('@/')) return path.resolve(location.root, `apps/web/src/${source.slice(2)}`)
  if (source.startsWith('.')) return path.resolve(path.dirname(location.filename), source)
  if (source === '@workspace/client-core/files/path')
    return path.resolve(location.root, 'packages/client-core/src/files/path')
  return source
}

export function webRelative(filename, root) {
  const relative = path.relative(path.resolve(root, 'apps/web/src'), filename).replaceAll('\\', '/')
  return relative.replace(/\.(?:[cm]?[jt]sx?)$/, '')
}

export function importVisitors(check) {
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

export function importValue(node) {
  const source = node.source ?? node.arguments?.[0] ?? node.moduleReference?.expression
  if (typeof source?.value === 'string') return source.value
  if (source?.type !== 'TemplateLiteral' || source.expressions.length > 0) return null
  return source.quasis[0]?.value.cooked ?? null
}
