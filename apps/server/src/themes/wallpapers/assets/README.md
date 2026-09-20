These are the twelve original images referenced by `BUNDLED_WALLPAPERS` in
`packages/contracts/src/themes/bundle-wallpapers.ts`, named by their SHA-256 hash.
The table records each source theme and filename from `/usr/share/omarchy/themes`.
Artwork redistribution remains unverified in library metadata and exported archives.

`scripts/package-wallpapers.ts` validates every registered hash before copying the
images into `dist/assets/`. Keep the original bytes so stored theme references and
portable archives retain the same identities. The server generates thumbnails and
display renditions when it installs an image into the user's wallpaper library.
