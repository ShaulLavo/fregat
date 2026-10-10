export function documentOptions(host: HTMLElement, file: string, text: string) {
  const css = getComputedStyle(host)
  let languageId = 'typescript'
  if (file.endsWith('.md')) languageId = 'markdown'
  if (file.endsWith('.sh')) languageId = 'shellscript'
  return {
    documentId: file,
    languageId,
    text,
    lineHeight: 22,
    fontSize: parseFloat(css.fontSize),
    fontFamily: css.fontFamily,
    gutterWidth: parseFloat(getComputedStyle(document.body).getPropertyValue('--gw')),
    label: `${file}, editable source`,
    background: file.endsWith('.md') ? ('bg' as const) : ('code-bg' as const),
  }
}
