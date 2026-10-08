/**
 * Light or dark. The page follows `prefers-color-scheme` until the reader picks one; the inline
 * script in the layout applies a stored pick before first paint.
 */
// Shared with Starlight's theme picker, so one choice holds on every page.
const KEY = 'starlight-theme'
const root = document.documentElement
const system = matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : system.matches)

export function onThemeChange(listener: () => void): void {
  listeners.add(listener)
}

function changed() {
  for (const button of document.querySelectorAll('.theme-toggle'))
    button.setAttribute('aria-pressed', String(isDark()))
  for (const listener of listeners) listener()
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.theme-toggle')) {
  button.hidden = false
  button.addEventListener('click', () => {
    const theme = isDark() ? 'light' : 'dark'
    root.dataset.theme = theme
    try {
      localStorage.setItem(KEY, theme)
    } catch {}
    changed()
  })
}
system.addEventListener('change', () => {
  if (!root.dataset.theme) changed()
})
changed()
