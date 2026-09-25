# File and folder picker

The web picker (`components/file-picker-dialog.tsx`, `features/file-picker/**`) opens from the project menu's **Open folder…**; the desktop shell uses the native dialog instead. A folder list with sortable headers, a places sidebar, and a preview pane that shows content: an image through `/fs/blob`, the first lines of a text file in the code theme's colours, or a folder's first children from the cached listing. The preview follows the selection only once it rests. The footer counts the listing ("N items", "N results" while searching). ⌘[ and ⌘] go back and forward, ⌘↑ goes up and ⌘↓ opens.

`scenario file-picker` checks the list's single focus target and row semantics. `scenario file-picker-browse` builds a fixture folder, requires the code, image and folder previews and the item count, and drives the three chords.
