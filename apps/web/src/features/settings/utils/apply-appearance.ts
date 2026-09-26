import type { SettingsValues } from '@workspace/contracts'

import { fontStack } from '@/lib/fonts/utils/stack'

/** The keys that change how the app looks the instant they resolve. */
export type AppearanceValues = Pick<
  SettingsValues,
  | 'editor.fontFamily'
  | 'workbench.colorTheme'
  | 'workbench.density'
  | 'workbench.feel'
  | 'workbench.fontFamily'
  | 'workbench.surface.blur'
  | 'workbench.surface.contentOpacity'
  | 'workbench.surface.opacity'
  | 'workbench.surface.saturation'
  | 'workbench.tree.indentGuides'
  | 'workbench.wallpaper'
>

type Root = Pick<HTMLElement, 'classList' | 'style' | 'setAttribute' | 'removeAttribute'>

export function resolveColorTheme(
  theme: SettingsValues['workbench.colorTheme'],
  prefersDark: boolean,
): 'dark' | 'light' {
  if (theme !== 'system') return theme

  return prefersDark ? 'dark' : 'light'
}

/**
 * Writes appearance settings onto the document element.
 *
 * A plain function over a root element rather than a React effect, because it
 * has to run twice in two different worlds: once at module scope in `main.tsx`
 * before the first paint, and again in React's insertion phase whenever
 * settings change. The insertion phase runs before descendant layout effects
 * such as the terminal's CSS-variable snapshot.
 *
 * The pre-paint call is the primary path; the React one is a correction.
 */
export function applyAppearance(values: AppearanceValues, root: Root, prefersDark: boolean) {
  const resolved = resolveColorTheme(values['workbench.colorTheme'], prefersDark)
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)

  // The palette is not written here: it is a stylesheet, owned by
  // `applyPaletteStylesheet`, so the same root can carry both modes at once.
  root.setAttribute('data-density', values['workbench.density'])
  root.setAttribute('data-feel', values['workbench.feel'])

  root.style.setProperty('--surface-opacity', `${values['workbench.surface.opacity']}%`)
  root.style.setProperty('--content-opacity', `${values['workbench.surface.contentOpacity']}%`)
  root.style.setProperty('--surface-blur', `${values['workbench.surface.blur']}px`)
  root.style.setProperty('--surface-saturation', `${values['workbench.surface.saturation']}%`)
  applyFileTreeIndentGuideVisibility(values['workbench.tree.indentGuides'], root)

  // The editor and terminal take the code font as options; these are for the rest of the app.
  // Fetching and registering the faces is the font loader's job.
  root.style.setProperty('--font-ui', fontStack(values['workbench.fontFamily'], 'ui'))
  root.style.setProperty('--font-code', fontStack(values['editor.fontFamily'], 'code'))

  if (values['workbench.wallpaper'].enabled) {
    root.removeAttribute('data-wallpaper-hidden')

    return
  }

  root.setAttribute('data-wallpaper-hidden', '')
}

function applyFileTreeIndentGuideVisibility(
  visibility: AppearanceValues['workbench.tree.indentGuides'],
  root: Root,
) {
  root.style.setProperty(
    '--trees-indent-guide-opacity-override',
    visibility === 'always' ? '1' : '0',
  )
  root.style.setProperty(
    '--trees-indent-guide-hover-opacity-override',
    visibility === 'none' ? '0' : '1',
  )
  root.style.setProperty(
    '--trees-indent-guide-active-opacity-override',
    visibility === 'none' ? '0' : '1',
  )
}
