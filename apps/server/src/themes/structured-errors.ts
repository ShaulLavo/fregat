import { defineErrorCatalog } from 'evlog'

/** Palette library failures the settings page has to tell apart. */
export const themeErrors = defineErrorCatalog('themes', {
  BUNDLE_INVALID: {
    status: 400,
    message: ({ detail }: { detail: string }) => `Theme bundle: ${detail}`,
    why: 'The theme could not be checked or added. A partial import is left out of the library.',
    fix: 'Check the theme’s parts, use a theme name that is not taken, and import a complete Platform theme file.',
  },
  PALETTE_INVALID: {
    status: 400,
    message: ({ detail }: { detail: string }) => `Palette is not valid: ${detail}`,
    why: 'The palette is missing colors or has values the app cannot draw, so saving it would break the theme.',
    fix: 'Give every app and terminal color a CSS color (hex, rgb(), hsl() or oklch()) and use a lowercase name.',
  },
  PALETTE_NOT_FOUND: {
    status: 404,
    message: ({ id }: { id: string }) => `No user palette named ${id}`,
    why: 'No saved or built-in palette has this name.',
    fix: 'Pick a palette from the library, or create it first.',
  },
  PALETTE_BUNDLED: {
    status: 409,
    message: ({ id }: { id: string }) => `${id} is a bundled palette`,
    why: 'Built-in palettes come with the app and cannot be changed, and a new palette cannot take their name.',
    fix: 'Duplicate the built-in palette under a new name and edit the copy.',
  },
  PALETTE_EXISTS: {
    status: 409,
    message: ({ id }: { id: string }) => `A palette named ${id} already exists`,
    why: 'Creating a palette never replaces an existing one, so two windows cannot overwrite each other.',
    fix: 'Pick another name, or edit the existing palette.',
  },
  PALETTE_ID_MISMATCH: {
    status: 400,
    message: ({ id, bodyId }: { id: string; bodyId: string }) =>
      `Route names ${id} but the document is ${bodyId}`,
    why: 'Renaming a palette by updating it under another id would leave the old file behind.',
    fix: 'Save the palette under its own name. To rename it, create a new palette.',
  },
  PALETTE_SELECTED_WRITE_REJECTED: {
    status: 409,
    message: ({ id }: { id: string }) => `${id} is selected and the fallback could not be saved`,
    why: 'Deleting the palette in use first switches to Graphite, and saving that switch failed, so the palette was kept.',
    fix: 'Select another palette, then delete this one.',
  },
})
