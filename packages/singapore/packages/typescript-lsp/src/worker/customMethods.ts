/** Methods this worker adds to LSP. Kept free of imports: the main-thread plugin reads them too. */

/** Notification: replaces every workspace file. */
export const SET_WORKSPACE_FILES = 'editor/typescript/setWorkspaceFiles'
/** Notification: adds or changes workspace files in place. */
export const UPSERT_WORKSPACE_FILES = 'editor/typescript/upsertFiles'
/** Notification: removes workspace files by path. */
export const DELETE_WORKSPACE_FILES = 'editor/typescript/deleteFiles'
/** Request, worker to host: library files by name, when the host supplies them. */
export const LIBRARY_FILES_REQUEST = 'editor/typescript/libraryFiles'
