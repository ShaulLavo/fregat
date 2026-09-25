import type { FontRole } from './ref'

export type CuratedFont = { readonly ref: string; readonly label: string }

/**
 * What a picker offers before anything is typed. Every code font is a Nerd Font build, so
 * terminal glyphs keep working; Commit Mono and Martian Mono are the nearest free fonts to
 * Berkeley Mono, which is commercial and reachable only as an installed font.
 */
export const CURATED_FONTS: Readonly<Record<FontRole, readonly CuratedFont[]>> = {
  ui: [
    { ref: 'bundled:inter', label: 'Inter' },
    { ref: 'fontsource:geist', label: 'Geist' },
    { ref: 'fontsource:inter-tight', label: 'Inter Tight' },
    { ref: 'fontsource:ibm-plex-sans', label: 'IBM Plex Sans' },
    { ref: 'fontsource:google-sans-flex', label: 'Google Sans Flex' },
    { ref: 'fontsource:figtree', label: 'Figtree' },
    { ref: 'fontsource:manrope', label: 'Manrope' },
    { ref: 'fontsource:instrument-sans', label: 'Instrument Sans' },
    { ref: 'fontsource:public-sans', label: 'Public Sans' },
    { ref: 'local:system-ui', label: 'System' },
  ],
  code: [
    { ref: 'bundled:jetbrains-mono', label: 'JetBrains Mono' },
    { ref: 'nerd:GeistMono', label: 'Geist Mono' },
    { ref: 'nerd:CommitMono', label: 'Commit Mono' },
    { ref: 'nerd:MartianMono', label: 'Martian Mono' },
    { ref: 'nerd:IBMPlexMono', label: 'IBM Plex Mono' },
    { ref: 'nerd:FiraCode', label: 'Fira Code' },
    { ref: 'nerd:Iosevka', label: 'Iosevka' },
    { ref: 'nerd:CascadiaCode', label: 'Cascadia Code' },
    { ref: 'nerd:Monaspace', label: 'Monaspace' },
    { ref: 'nerd:0xProto', label: '0xProto' },
    { ref: 'nerd:ZedMono', label: 'Zed Mono' },
    { ref: 'nerd:VictorMono', label: 'Victor Mono' },
  ],
}
