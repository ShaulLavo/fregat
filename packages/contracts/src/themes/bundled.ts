import tokyoNight from './packs/tokyo-night.json'
import rosePine from './packs/rose-pine.json'
import catppuccin from './packs/catppuccin.json'
import catppuccinLatte from './packs/catppuccin-latte.json'
import gruvbox from './packs/gruvbox.json'
import { parsePalette, type Palette, type PaletteDocument } from './palette'

/**
 * The two palettes that ship. Values are the exact `oklch()` declarations the
 * hand-written `globals.css` blocks carried before palettes became data;
 * `scripts/themes/generate-palette-css.ts` writes Graphite back out as the
 * stylesheet default so a page paints it before any script runs.
 */

const graphiteTerminalLight = {
  foreground: '#3c3c3c',
  cursor: '#1a1a1a',
  'cursor-accent': '#ffffff',
  selection: '#cdd6e3',
  'selection-foreground': '#1a1a1a',
  black: '#3c3c3c',
  red: '#d1453b',
  green: '#3f9a52',
  yellow: '#b07d00',
  blue: '#3b75d1',
  magenta: '#9a4fb0',
  cyan: '#2a8499',
  white: '#b6b6b3',
  'bright-black': '#8a8a86',
  'bright-red': '#e0594f',
  'bright-green': '#54ab68',
  'bright-yellow': '#c79520',
  'bright-blue': '#5a8fe0',
  'bright-magenta': '#b06ac4',
  'bright-cyan': '#3f9fb5',
  'bright-white': '#2a2a2a',
} as const

const graphiteTerminalDark = {
  foreground: '#d7dde5',
  cursor: '#f4f7fb',
  'cursor-accent': '#0a0a0a',
  selection: '#33455a',
  'selection-foreground': '#ffffff',
  black: '#15181c',
  red: '#ff5f57',
  green: '#5fd38d',
  yellow: '#f3c969',
  blue: '#6aa8ff',
  magenta: '#d28bff',
  cyan: '#5fd7e5',
  white: '#d7dde5',
  'bright-black': '#6d7682',
  'bright-red': '#ff8f87',
  'bright-green': '#89e8af',
  'bright-yellow': '#f7d98c',
  'bright-blue': '#93c1ff',
  'bright-magenta': '#e1b0ff',
  'bright-cyan': '#8ce8f0',
  'bright-white': '#ffffff',
} as const

const graphiteLight = {
  background: 'oklch(0.97 0.006 70)',
  foreground: 'oklch(0.145 0.006 70)',
  card: 'oklch(1 0.006 70)',
  'card-foreground': 'oklch(0.145 0.006 70)',
  popover: 'oklch(1 0.006 70)',
  'popover-foreground': 'oklch(0.145 0.006 70)',
  primary: 'oklch(0.24 0.014 70)',
  'primary-foreground': 'oklch(0.985 0.006 70)',
  secondary: 'oklch(0.94 0.006 70)',
  'secondary-foreground': 'oklch(0.205 0.006 70)',
  muted: 'oklch(0.94 0.006 70)',
  'muted-foreground': 'oklch(0.52 0.006 70)',
  accent: 'oklch(0.94 0.006 70)',
  'accent-foreground': 'oklch(0.205 0.006 70)',
  destructive: 'oklch(0.55 0.17 18)',
  info: 'oklch(0.54 0.17 230)',
  'info-foreground': 'oklch(0.985 0.006 70)',
  success: 'oklch(0.54 0.17 165)',
  'success-foreground': 'oklch(0.985 0.006 70)',
  warning: 'oklch(0.7 0.155 92)',
  'warning-foreground': 'oklch(0.205 0.006 70)',
  update: 'oklch(0.55 0.17 300)',
  'update-foreground': 'oklch(0.985 0.006 70)',
  border: 'oklch(0.88 0.006 70)',
  input: 'oklch(0.88 0.006 70)',
  ring: 'oklch(0.62 0.006 70)',
  'chart-1': 'oklch(0.87 0.006 70)',
  'chart-2': 'oklch(0.556 0.006 70)',
  'chart-3': 'oklch(0.439 0.006 70)',
  'chart-4': 'oklch(0.371 0.006 70)',
  'chart-5': 'oklch(0.269 0.006 70)',
} as const

const graphiteDark = {
  background: 'oklch(0.145 0.006 70)',
  foreground: 'oklch(0.985 0.006 70)',
  card: 'oklch(0.205 0.006 70)',
  'card-foreground': 'oklch(0.985 0.006 70)',
  popover: 'oklch(0.205 0.006 70)',
  'popover-foreground': 'oklch(0.985 0.006 70)',
  primary: 'oklch(0.92 0.012 70)',
  'primary-foreground': 'oklch(0.22 0.014 70)',
  secondary: 'oklch(0.269 0.006 70)',
  'secondary-foreground': 'oklch(0.985 0.006 70)',
  muted: 'oklch(0.269 0.006 70)',
  'muted-foreground': 'oklch(0.708 0.006 70)',
  accent: 'oklch(0.269 0.006 70)',
  'accent-foreground': 'oklch(0.985 0.006 70)',
  destructive: 'oklch(0.74 0.145 18)',
  info: 'oklch(0.74 0.145 230)',
  'info-foreground': 'oklch(0.205 0.006 70)',
  success: 'oklch(0.74 0.145 165)',
  'success-foreground': 'oklch(0.205 0.006 70)',
  warning: 'oklch(0.82 0.14 92)',
  'warning-foreground': 'oklch(0.205 0.006 70)',
  update: 'oklch(0.74 0.145 300)',
  'update-foreground': 'oklch(0.205 0.006 70)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.556 0.006 70)',
  'chart-1': 'oklch(0.87 0.006 70)',
  'chart-2': 'oklch(0.556 0.006 70)',
  'chart-3': 'oklch(0.439 0.006 70)',
  'chart-4': 'oklch(0.371 0.006 70)',
  'chart-5': 'oklch(0.269 0.006 70)',
} as const

export const GRAPHITE_PALETTE_DOCUMENT = {
  schemaVersion: 1,
  id: 'graphite',
  name: 'Graphite',
  variants: {
    kind: 'paired',
    light: { app: graphiteLight, terminal: graphiteTerminalLight },
    dark: { app: graphiteDark, terminal: graphiteTerminalDark },
  },
} as const satisfies PaletteDocument

// Warm stone surfaces, cool ink and a sage accent in light; deep slate and a
// muted teal in dark. Borrowed from ellie. Green sits at 150, not 165: the
// primary lives at 170 and a success badge must not read as the brand color.
export const SAGE_PALETTE_DOCUMENT = {
  schemaVersion: 1,
  id: 'sage',
  name: 'Sage',
  variants: {
    kind: 'paired',
    light: {
      app: {
        ...graphiteLight,
        background: 'oklch(0.98 0.003 90)',
        foreground: 'oklch(0.16 0.01 260)',
        card: 'oklch(1 0 0)',
        'card-foreground': 'oklch(0.16 0.01 260)',
        popover: 'oklch(1 0 0)',
        'popover-foreground': 'oklch(0.16 0.01 260)',
        primary: 'oklch(0.47 0.08 170)',
        'primary-foreground': 'oklch(0.98 0.005 170)',
        secondary: 'oklch(0.95 0.005 90)',
        'secondary-foreground': 'oklch(0.22 0.01 260)',
        muted: 'oklch(0.95 0.005 90)',
        'muted-foreground': 'oklch(0.5 0.01 260)',
        accent: 'oklch(0.95 0.008 170)',
        'accent-foreground': 'oklch(0.22 0.01 260)',
        'info-foreground': 'oklch(0.98 0.003 90)',
        success: 'oklch(0.53 0.17 150)',
        'success-foreground': 'oklch(0.98 0.003 90)',
        'warning-foreground': 'oklch(0.22 0.01 260)',
        'update-foreground': 'oklch(0.98 0.003 90)',
        border: 'oklch(0.9 0.005 90)',
        input: 'oklch(0.9 0.005 90)',
        ring: 'oklch(0.47 0.08 170)',
        'chart-1': 'oklch(0.55 0.1 170)',
        'chart-2': 'oklch(0.6 0.12 250)',
        'chart-3': 'oklch(0.5 0.14 310)',
        'chart-4': 'oklch(0.7 0.12 90)',
        'chart-5': 'oklch(0.65 0.15 30)',
      },
      terminal: graphiteTerminalLight,
    },
    dark: {
      app: {
        ...graphiteDark,
        background: 'oklch(0.17 0.01 260)',
        foreground: 'oklch(0.92 0.008 90)',
        card: 'oklch(0.21 0.01 260)',
        'card-foreground': 'oklch(0.92 0.008 90)',
        popover: 'oklch(0.21 0.01 260)',
        'popover-foreground': 'oklch(0.92 0.008 90)',
        primary: 'oklch(0.72 0.1 175)',
        'primary-foreground': 'oklch(0.17 0.03 175)',
        secondary: 'oklch(0.24 0.008 260)',
        'secondary-foreground': 'oklch(0.92 0.008 90)',
        muted: 'oklch(0.24 0.008 260)',
        'muted-foreground': 'oklch(0.65 0.012 260)',
        accent: 'oklch(0.24 0.015 260)',
        'accent-foreground': 'oklch(0.92 0.008 90)',
        'info-foreground': 'oklch(0.17 0.02 260)',
        success: 'oklch(0.74 0.145 150)',
        'success-foreground': 'oklch(0.17 0.02 260)',
        'warning-foreground': 'oklch(0.17 0.02 260)',
        'update-foreground': 'oklch(0.17 0.02 260)',
        border: 'oklch(1 0 0 / 9%)',
        input: 'oklch(1 0 0 / 12%)',
        ring: 'oklch(0.72 0.1 175)',
        'chart-1': 'oklch(0.72 0.1 175)',
        'chart-2': 'oklch(0.68 0.12 250)',
        'chart-3': 'oklch(0.62 0.1 310)',
        'chart-4': 'oklch(0.78 0.12 90)',
        'chart-5': 'oklch(0.72 0.15 30)',
      },
      terminal: graphiteTerminalDark,
    },
  },
} as const satisfies PaletteDocument

export const DEFAULT_PALETTE_ID = 'graphite'

const BUNDLED_PALETTE_DOCUMENTS: readonly unknown[] = [
  GRAPHITE_PALETTE_DOCUMENT,
  SAGE_PALETTE_DOCUMENT,
  tokyoNight,
  rosePine,
  catppuccin,
  catppuccinLatte,
  gruvbox,
]

// A bundled document that fails its own schema is a build defect the test
// `bundled palettes parse` catches; at runtime it is simply absent.
export const BUNDLED_PALETTES: readonly Palette[] = Object.freeze(
  BUNDLED_PALETTE_DOCUMENTS.flatMap((document) => {
    const parsed = parsePalette(document, 'bundled')

    return parsed.success ? [parsed.palette] : []
  }),
)

export function bundledPalette(id: string): Palette | undefined {
  return BUNDLED_PALETTES.find((palette) => palette.id === id)
}

export function isBundledPaletteId(id: string): boolean {
  return bundledPalette(id) !== undefined
}
