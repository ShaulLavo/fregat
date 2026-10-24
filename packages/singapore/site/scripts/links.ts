import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'

export async function checkInternalLinks(root: string, base = '/') {
  const files = new Map<string, { ids: Set<string>; links: string[] }>()
  async function collect(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await collect(path)
        continue
      }
      if (!entry.name.endsWith('.html')) continue
      const page = { ids: new Set<string>(), links: [] as string[] }
      visit(fromHtml(await readFile(path, 'utf8')), 'element', (node) => {
        if (typeof node.properties.id === 'string') page.ids.add(node.properties.id)
        if (node.tagName === 'a' && typeof node.properties.href === 'string')
          page.links.push(node.properties.href)
      })
      files.set(relative(root, path).replaceAll('\\', '/'), page)
    }
  }
  await collect(root)
  const prefix = base === '/' ? '' : `/${base.replace(/^\/+|\/+$/g, '')}`
  const problems: string[] = []
  let checked = 0
  for (const [path, page] of files) {
    for (const href of page.links) {
      const url = new URL(href, `https://docs.invalid${prefix}/${path}`)
      if (url.origin !== 'https://docs.invalid') continue
      const pathname = decodeURIComponent(url.pathname)
      if (prefix && !pathname.startsWith(`${prefix}/`)) {
        problems.push(`${path}: ${href} leaves the configured base path`)
        continue
      }
      const targetPath = pathname.slice(prefix.length).replace(/^\//, '')
      const target =
        files.get(targetPath) ??
        files.get(`${targetPath.replace(/\/$/, '')}/index.html`) ??
        (targetPath === '' ? files.get('index.html') : undefined)
      if (!target) {
        problems.push(`${path}: missing page ${href}`)
        continue
      }
      const anchor = decodeURIComponent(url.hash.slice(1))
      if (anchor && !target.ids.has(anchor)) problems.push(`${path}: missing anchor ${href}`)
      checked++
    }
  }
  return { pages: files.size, checked, problems }
}
