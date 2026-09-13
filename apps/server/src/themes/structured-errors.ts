import { defineErrorCatalog } from 'evlog'

/** Palette library failures the settings page has to tell apart. */
export const themeErrors = defineErrorCatalog('themes', {
  PALETTE_INVALID: {
    status: 400,
    message: ({ detail }: { detail: string }) => `Palette is not valid: ${detail}`,
    why: 'The document did not match the palette schema, so storing it would persist a file the app cannot render.',
    fix: 'Send every app and terminal role as a CSS color (hex, rgb(), hsl() or oklch()) and a lowercase id.',
  },
  PALETTE_NOT_FOUND: {
    status: 404,
    message: ({ id }: { id: string }) => `No user palette named ${id}`,
    why: 'The id names neither a file in the palette library nor a bundled palette.',
    fix: 'List the library and use one of its ids, or create the palette first.',
  },
  PALETTE_BUNDLED: {
    status: 409,
    message: ({ id }: { id: string }) => `${id} is a bundled palette`,
    why: 'Bundled palettes ship with the app and are read-only; a user palette cannot reuse their id.',
    fix: 'Duplicate the bundled palette under a new id and edit the copy.',
  },
  PALETTE_EXISTS: {
    status: 409,
    message: ({ id }: { id: string }) => `A palette named ${id} already exists`,
    why: 'Create never overwrites: two windows creating the same id would otherwise silently race.',
    fix: 'Pick another id, or update the existing palette instead.',
  },
  PALETTE_ID_MISMATCH: {
    status: 400,
    message: ({ id, bodyId }: { id: string; bodyId: string }) =>
      `Route names ${id} but the document is ${bodyId}`,
    why: 'Renaming a palette by updating it under another id would leave the old file behind.',
    fix: 'Send the document under its own id; create a new palette to change the id.',
  },
  PALETTE_SELECTED_WRITE_REJECTED: {
    status: 409,
    message: ({ id }: { id: string }) => `${id} is selected and the fallback could not be saved`,
    why: 'Deleting the selected palette first moves the selection to Graphite through settings; that write was rejected, so the file stays.',
    fix: 'Select another palette, then delete this one.',
  },
})
