export function languageForPath(path: string) {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  const languages: Readonly<Record<string, string>> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'jsonc',
    md: 'markdown',
    css: 'css',
    html: 'html',
    htm: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sh: 'bash',
    bash: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    java: 'java',
    rb: 'ruby',
    xml: 'xml',
  }
  return languages[extension] ?? 'text'
}

export function lspLanguageForPath(path: string) {
  const language = languageForPath(path)
  if (language === 'tsx') return 'typescriptreact'
  if (language === 'jsx') return 'javascriptreact'
  return language
}
