import type { SettingsValues } from '@workspace/contracts'

import { fontStack } from '@/lib/default-nerd-font'

/** The keys that change how the app looks the instant they resolve. */
export type AppearanceValues = Pick<
  SettingsValues,
  | 'editor.fontFamily'
  | 'editor.fontSize'
  | 'editor.lineHeight'
  | 'editor.tabSize'
  | 'workbench.colorTheme'
  | 'workbench.density'
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

  root.style.setProperty('--surface-opacity', `${values['workbench.surface.opacity']}%`)
  root.style.setProperty('--content-opacity', `${values['workbench.surface.contentOpacity']}%`)
  root.style.setProperty('--surface-blur', `${values['workbench.surface.blur']}px`)
  root.style.setProperty('--surface-saturation', `${values['workbench.surface.saturation']}%`)
  applyFileTreeIndentGuideVisibility(values['workbench.tree.indentGuides'], root)

  // Editor typography rides CSS rather than editor options. The editor package
  // already reads `--editor-tab-size` and `--editor-row-height` from its own
  // stylesheet, and the app host rule owns font-family and font-size — so these
  // are live with no remount, and without a commit in the separate editor repo.
  //
  // `--font-mono` is deliberately app-wide: the terminal reads the same stack,
  // so one font setting covers both unless the terminal overrides it. The stack
  // is set here so text reflows immediately; fetching and registering the face
  // is a separate, slower job the font loader owns.
  root.style.setProperty('--font-mono', fontStack(values['editor.fontFamily']))
  root.style.setProperty('--editor-font-size', `${values['editor.fontSize']}px`)
  root.style.setProperty('--editor-row-height', `${values['editor.lineHeight']}px`)
  root.style.setProperty('--editor-tab-size', String(values['editor.tabSize']))

  // An attribute rather than a custom property: `globals.css` keys the popover
  // wallpaper off `html[data-wallpaper-hidden]`, and the wallpaper component
  // unmounts the media on the same signal — CSS-hiding it leaves a 2560×1440
  // video decoding forever.
  if (values['workbench.wallpaper'][resolved].kind !== 'none') {
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
