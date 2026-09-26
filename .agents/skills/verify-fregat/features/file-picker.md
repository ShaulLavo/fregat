# File and folder picker

The web picker (`components/file-picker-dialog.tsx`, `features/file-picker/**`) opens from the project menu's **Open folder…**; the desktop shell uses the native dialog instead. Columns (the default when choosing a folder, setting `files.picker.view`), a list with sortable headers, or an icons grid, a places sidebar, and a preview pane that shows content: an image through `/fs/blob`, the first lines of a text file in the code theme's colours, or a folder's first children from the cached listing. The preview follows the selection only once it rests. The footer counts the listing ("N items", "N results" while searching). ⌘[ and ⌘] go back and forward, ⌘↑ goes up and ⌘↓ opens.

`scenario file-picker` checks the list's single focus target and row semantics. `scenario file-picker-browse` builds a fixture folder, walks the columns with → ↓ ←, switches to List and requires the code, image and folder previews, the item count and the three chords, then moves through the icons grid.

When a file caller supplies accepted types, **File type** lists their combined set and individual types. The caller constraint remains in force; folders stay navigable, and changing the type clears a hidden file selection. List, icons, columns and search share the constraint. No type dropdown appears in folder mode or without an accept list.

`type-filter.browser.tsx` uses a real fixture server and Chromium at desktop width. It switches all three views, checks hidden-file selection and unsupported files, enters a nested folder, and checks keyboard opening/Escape with a nonempty search. The screenshot captures the native-style dropdown. Pure type-filter tests cover stale caller constraints and column trail pruning.
