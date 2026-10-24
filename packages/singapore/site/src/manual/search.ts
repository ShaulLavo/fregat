/** Search over Pagefind's index of the static pages, loaded on first use. */
type PagefindResult = {
  readonly url: string
  readonly excerpt: string
  readonly meta: { readonly title?: string }
}
type Pagefind = {
  debouncedSearch(
    query: string,
    options: object,
    delay: number,
  ): Promise<{ results: { data(): Promise<PagefindResult> }[] } | null>
}

const base = import.meta.env.BASE_URL
let pagefind: Promise<Pagefind> | null = null
let dialog: HTMLDialogElement | null = null

function createDialog() {
  const element = document.createElement('dialog')
  element.className = 'search'
  element.setAttribute('aria-label', 'Search the docs')
  element.innerHTML =
    '<input type="search" placeholder="Search docs" aria-label="Search docs"><ol aria-live="polite"></ol>'
  document.body.append(element)
  const input = element.querySelector('input')!
  const list = element.querySelector('ol')!
  element.addEventListener('click', (event) => {
    if (event.target === element) element.close()
  })
  input.addEventListener('input', async () => {
    pagefind ??= import(/* @vite-ignore */ `${base}pagefind/pagefind.js`) as Promise<Pagefind>
    const query = input.value.trim()
    const search = await (await pagefind).debouncedSearch(query, {}, 120)
    if (!search) return
    const results = await Promise.all(search.results.slice(0, 8).map((result) => result.data()))
    if (input.value.trim() !== query) return
    list.replaceChildren(
      ...results.map((data) => {
        const item = document.createElement('li')
        const link = document.createElement('a')
        link.href = data.url
        const title = document.createElement('b')
        title.textContent = data.meta.title ?? data.url
        const excerpt = document.createElement('span')
        // Pagefind escapes page text and marks matches with <mark>.
        excerpt.innerHTML = data.excerpt
        link.append(title, excerpt)
        item.append(link)
        return item
      }),
    )
    if (query && !results.length) {
      const empty = document.createElement('li')
      empty.className = 'empty'
      empty.textContent = 'No matches'
      list.replaceChildren(empty)
    }
    list.dataset.query = query
  })
  return element
}

export function setUpSearch(): void {
  const open = () => {
    dialog ??= createDialog()
    dialog.showModal()
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.search-open')) {
    button.hidden = false
    button.addEventListener('click', open)
  }
  window.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as Element | null
    if (target?.closest?.('input, textarea, [contenteditable], .editor')) return
    event.preventDefault()
    open()
  })
}
