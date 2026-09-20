// Filename suffixes such as sh, md, ts and rs deliberately remain eligible as paths.
const HOSTNAME_TLDS = new Set([
  'ai',
  'app',
  'biz',
  'cloud',
  'co',
  'com',
  'dev',
  'edu',
  'gov',
  'info',
  'io',
  'me',
  'net',
  'org',
  'site',
  'tech',
  'xyz',
])

export function looksLikeHostname(path: string) {
  if (path.startsWith('/') || path.startsWith('.')) return false
  const host = path.split('/')[0] ?? path
  const labels = host.toLowerCase().split('.')
  return labels.length > 1 && HOSTNAME_TLDS.has(labels.at(-1) ?? '')
}
