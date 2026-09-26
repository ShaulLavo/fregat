import { defineErrorCatalog } from 'evlog'

export const wallpaperErrors = defineErrorCatalog('wallpapers', {
  BUNDLED_INVALID: {
    status: 500,
    message: ({ assetId }: { assetId: string }) =>
      `Bundled wallpaper ${assetId} is missing or damaged.`,
    why: 'The server package does not contain the expected wallpaper bytes.',
    fix: 'Rebuild and deploy the server with its wallpaper assets.',
  },
  BUNDLED: {
    status: 400,
    message: 'Bundled wallpapers cannot be deleted.',
    why: 'Built-in themes reference this artwork.',
    fix: 'Select another wallpaper or turn the wallpaper off.',
  },
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
  // A 4xx logs at warn: an offline machine or a GitHub outage is degraded, and the next pick retries.
  DOWNLOAD: {
    status: 424,
    message: 'Omarchy wallpaper could not be downloaded.',
    why: 'GitHub did not return the pinned wallpaper file in time.',
    fix: 'Check the network connection and pick the wallpaper again.',
  },
  DOWNLOAD_MISMATCH: {
    status: 502,
    message: 'Downloaded Omarchy wallpaper does not match the pinned file.',
    why: 'GitHub returned bytes whose size or sha256 differs from the catalog.',
    fix: 'Regenerate the catalog with `bun run themes:omarchy-catalog` and redeploy the server.',
  },
  DIRECTORY: {
    status: 400,
    message: 'Wallpaper directory could not be imported.',
    why: 'The server could not read a theme directory.',
    fix: 'Choose a readable directory containing theme/backgrounds folders.',
  },
})
