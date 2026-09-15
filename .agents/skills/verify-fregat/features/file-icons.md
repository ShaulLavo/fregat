# File icons

Tabs, breadcrumbs, the file tree, the command palette, search results, Git rows,
chat file references, and the file picker render the bundled file artwork.

Run `bun run agent:browser scenario file-icons` to open files, reload restored
tabs, open the palette, and search while standalone icon requests are blocked.
The screenshots must retain the file glyphs. Each step's JSON records SVG paths,
dimensions, colors and masks; file icons must have paths and no external mask.

Use `trace file-icons --compare <baseline>` for the same drive before and after.
