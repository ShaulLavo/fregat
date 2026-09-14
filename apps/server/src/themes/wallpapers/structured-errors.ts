import { defineErrorCatalog } from 'evlog'

export const wallpaperErrors = defineErrorCatalog('wallpapers', {
  INVALID: {
    status: 400,
    message: 'Wallpaper must be a valid JPEG, PNG or WebP still within the image limits.',
    why: 'The input could not be safely decoded.',
    fix: 'Use a still image under 20 MiB, 16384 pixels per side and 40 megapixels.',
  },
  TOO_LARGE: {
    status: 413,
    message: 'Wallpaper exceeds 20 MiB.',
    why: 'The upload exceeds the byte limit.',
    fix: 'Resize or compress the image before uploading.',
  },
  NOT_FOUND: {
    status: 404,
    message: 'Wallpaper asset not found.',
    why: 'The asset is absent from the library.',
    fix: 'Refresh the library and select an existing image.',
  },
  DIRECTORY: {
    status: 400,
    message: 'Wallpaper directory could not be imported.',
    why: 'The server could not read a theme directory.',
    fix: 'Choose a readable directory containing theme/backgrounds folders.',
  },
})
