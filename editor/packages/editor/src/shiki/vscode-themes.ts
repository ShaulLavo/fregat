import type { EditorTheme } from '../theme'
import { editorThemeFromShikiTheme, type ShikiThemeLike } from './theme-extract'

export type VscodeThemeRegistration = ShikiThemeLike & {
  readonly name?: string
  readonly displayName?: string
  readonly type?: 'dark' | 'light'
}

export type VscodeThemeDefinition = {
  readonly id: string
  readonly label: string
  readonly shikiName: string
  readonly type: 'dark' | 'light'
}

export const VSCODE_THEMES = [
  { id: 'andromeeda', label: 'Andromeeda', shikiName: 'andromeeda', type: 'dark' },
  { id: 'aurora-x', label: 'Aurora X', shikiName: 'aurora-x', type: 'dark' },
  { id: 'ayu-dark', label: 'Ayu Dark', shikiName: 'ayu-dark', type: 'dark' },
  { id: 'ayu-light', label: 'Ayu Light', shikiName: 'ayu-light', type: 'light' },
  { id: 'ayu-mirage', label: 'Ayu Mirage', shikiName: 'ayu-mirage', type: 'dark' },
  {
    id: 'catppuccin-frappe',
    label: 'Catppuccin Frappé',
    shikiName: 'catppuccin-frappe',
    type: 'dark',
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    shikiName: 'catppuccin-latte',
    type: 'light',
  },
  {
    id: 'catppuccin-macchiato',
    label: 'Catppuccin Macchiato',
    shikiName: 'catppuccin-macchiato',
    type: 'dark',
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    shikiName: 'catppuccin-mocha',
    type: 'dark',
  },
  { id: 'dark-plus', label: 'Dark Plus', shikiName: 'dark-plus', type: 'dark' },
  { id: 'dracula', label: 'Dracula Theme', shikiName: 'dracula', type: 'dark' },
  { id: 'dracula-soft', label: 'Dracula Theme Soft', shikiName: 'dracula-soft', type: 'dark' },
  { id: 'everforest-dark', label: 'Everforest Dark', shikiName: 'everforest-dark', type: 'dark' },
  {
    id: 'everforest-light',
    label: 'Everforest Light',
    shikiName: 'everforest-light',
    type: 'light',
  },
  { id: 'github-dark', label: 'GitHub Dark', shikiName: 'github-dark', type: 'dark' },
  {
    id: 'github-dark-default',
    label: 'GitHub Dark Default',
    shikiName: 'github-dark-default',
    type: 'dark',
  },
  {
    id: 'github-dark-dimmed',
    label: 'GitHub Dark Dimmed',
    shikiName: 'github-dark-dimmed',
    type: 'dark',
  },
  {
    id: 'github-dark-high-contrast',
    label: 'GitHub Dark High Contrast',
    shikiName: 'github-dark-high-contrast',
    type: 'dark',
  },
  { id: 'github-light', label: 'GitHub Light', shikiName: 'github-light', type: 'light' },
  {
    id: 'github-light-default',
    label: 'GitHub Light Default',
    shikiName: 'github-light-default',
    type: 'light',
  },
  {
    id: 'github-light-high-contrast',
    label: 'GitHub Light High Contrast',
    shikiName: 'github-light-high-contrast',
    type: 'light',
  },
  {
    id: 'gruvbox-dark-hard',
    label: 'Gruvbox Dark Hard',
    shikiName: 'gruvbox-dark-hard',
    type: 'dark',
  },
  {
    id: 'gruvbox-dark-medium',
    label: 'Gruvbox Dark Medium',
    shikiName: 'gruvbox-dark-medium',
    type: 'dark',
  },
  {
    id: 'gruvbox-dark-soft',
    label: 'Gruvbox Dark Soft',
    shikiName: 'gruvbox-dark-soft',
    type: 'dark',
  },
  {
    id: 'gruvbox-light-hard',
    label: 'Gruvbox Light Hard',
    shikiName: 'gruvbox-light-hard',
    type: 'light',
  },
  {
    id: 'gruvbox-light-medium',
    label: 'Gruvbox Light Medium',
    shikiName: 'gruvbox-light-medium',
    type: 'light',
  },
  {
    id: 'gruvbox-light-soft',
    label: 'Gruvbox Light Soft',
    shikiName: 'gruvbox-light-soft',
    type: 'light',
  },
  { id: 'horizon', label: 'Horizon', shikiName: 'horizon', type: 'dark' },
  { id: 'horizon-bright', label: 'Horizon Bright', shikiName: 'horizon-bright', type: 'light' },
  { id: 'houston', label: 'Houston', shikiName: 'houston', type: 'dark' },
  { id: 'kanagawa-dragon', label: 'Kanagawa Dragon', shikiName: 'kanagawa-dragon', type: 'dark' },
  { id: 'kanagawa-lotus', label: 'Kanagawa Lotus', shikiName: 'kanagawa-lotus', type: 'light' },
  { id: 'kanagawa-wave', label: 'Kanagawa Wave', shikiName: 'kanagawa-wave', type: 'dark' },
  { id: 'laserwave', label: 'LaserWave', shikiName: 'laserwave', type: 'dark' },
  { id: 'light-plus', label: 'Light Plus', shikiName: 'light-plus', type: 'light' },
  { id: 'material-theme', label: 'Material Theme', shikiName: 'material-theme', type: 'dark' },
  {
    id: 'material-theme-darker',
    label: 'Material Theme Darker',
    shikiName: 'material-theme-darker',
    type: 'dark',
  },
  {
    id: 'material-theme-lighter',
    label: 'Material Theme Lighter',
    shikiName: 'material-theme-lighter',
    type: 'light',
  },
  {
    id: 'material-theme-ocean',
    label: 'Material Theme Ocean',
    shikiName: 'material-theme-ocean',
    type: 'dark',
  },
  {
    id: 'material-theme-palenight',
    label: 'Material Theme Palenight',
    shikiName: 'material-theme-palenight',
    type: 'dark',
  },
  { id: 'min-dark', label: 'Min Dark', shikiName: 'min-dark', type: 'dark' },
  { id: 'min-light', label: 'Min Light', shikiName: 'min-light', type: 'light' },
  { id: 'monokai', label: 'Monokai', shikiName: 'monokai', type: 'dark' },
  { id: 'night-owl', label: 'Night Owl', shikiName: 'night-owl', type: 'dark' },
  { id: 'night-owl-light', label: 'Night Owl Light', shikiName: 'night-owl-light', type: 'light' },
  { id: 'nord', label: 'Nord', shikiName: 'nord', type: 'dark' },
  { id: 'one-dark-pro', label: 'One Dark Pro', shikiName: 'one-dark-pro', type: 'dark' },
  { id: 'one-light', label: 'One Light', shikiName: 'one-light', type: 'light' },
  { id: 'plastic', label: 'Plastic', shikiName: 'plastic', type: 'dark' },
  { id: 'poimandres', label: 'Poimandres', shikiName: 'poimandres', type: 'dark' },
  { id: 'red', label: 'Red', shikiName: 'red', type: 'dark' },
  { id: 'rose-pine', label: 'Rosé Pine', shikiName: 'rose-pine', type: 'dark' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', shikiName: 'rose-pine-dawn', type: 'light' },
  { id: 'rose-pine-moon', label: 'Rosé Pine Moon', shikiName: 'rose-pine-moon', type: 'dark' },
  { id: 'slack-dark', label: 'Slack Dark', shikiName: 'slack-dark', type: 'dark' },
  { id: 'slack-ochin', label: 'Slack Ochin', shikiName: 'slack-ochin', type: 'light' },
  { id: 'snazzy-light', label: 'Snazzy Light', shikiName: 'snazzy-light', type: 'light' },
  { id: 'solarized-dark', label: 'Solarized Dark', shikiName: 'solarized-dark', type: 'dark' },
  { id: 'solarized-light', label: 'Solarized Light', shikiName: 'solarized-light', type: 'light' },
  { id: 'synthwave-84', label: "Synthwave '84", shikiName: 'synthwave-84', type: 'dark' },
  { id: 'tokyo-night', label: 'Tokyo Night', shikiName: 'tokyo-night', type: 'dark' },
  { id: 'vesper', label: 'Vesper', shikiName: 'vesper', type: 'dark' },
  { id: 'vitesse-black', label: 'Vitesse Black', shikiName: 'vitesse-black', type: 'dark' },
  { id: 'vitesse-dark', label: 'Vitesse Dark', shikiName: 'vitesse-dark', type: 'dark' },
  { id: 'vitesse-light', label: 'Vitesse Light', shikiName: 'vitesse-light', type: 'light' },
] satisfies readonly VscodeThemeDefinition[]

export function editorThemeFromVscodeTheme(registration: VscodeThemeRegistration): EditorTheme {
  return editorThemeFromShikiTheme({
    bg: registration.bg ?? registration.colors?.['editor.background'],
    fg: registration.fg ?? registration.colors?.['editor.foreground'],
    colors: registration.colors,
    tokenColors: registration.tokenColors ?? registration.settings,
    type: registration.type,
  })
}
