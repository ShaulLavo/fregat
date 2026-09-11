# Filesystem boundaries

Platform gives you normal access to files on your computer by default. The file server starts at the system root, `/` on Linux and macOS, subject to operating-system permissions. Opening a project selects the scope for its file index. It does not restrict the file server to that project. See [server startup](../apps/server/src/index.ts) and [file-service scope](../apps/server/src/fs/service.ts).

The distinction matters when you edit files from several projects or follow a symlink to another directory. A symlink is a filesystem entry that points to another path. With the default server root, both paths can be accessible even when the target is outside your open project.

`FS_WORKSPACE_ROOT` is an optional server startup restriction. When it is set to `/work/projects/demo`, the filesystem API accepts paths beneath that directory and checks their physical destinations. The configured root can itself be a symlink. Its resolved destination defines the physical boundary. This existing startup option does not add a user setting or a folder-trust prompt.

For example, consider these entries under a restricted root:

```text
/work/projects/demo/notes.txt -> /work/private/notes.txt
/work/projects/demo/current.txt -> /work/projects/demo/draft.txt
/work/projects/demo/shared -> /work/private
```

The operations have different meanings:

- Reading or saving `notes.txt` would access outside content, so the server refuses it. Saving cannot create a temporary file beside the outside target first.
- Reading or saving `current.txt` is allowed because its physical target remains inside the root.
- Creating `shared/new.txt` is refused because its parent leads outside the root. The same check applies when additional parent directories do not exist yet.
- Deleting, renaming, or copying `notes.txt` acts on the symlink entry inside the root. It does not delete, rename, or read the outside target. These operations also support dangling links, whose targets do not exist.

Source and destination paths are checked before a copy or rename removes an existing destination. Traversal through an outside parent is refused for every mutation, including operations on symlink entries. Recursive copy preserves the links it encounters instead of following them into other directories. See [mutation path checks](../apps/server/src/fs/mutation-target.ts), [writes](../apps/server/src/fs/write.ts), and [copy operations](../apps/server/src/fs/copy.ts).

[Workspace-edit transactions](../apps/server/src/fs/workspace-edit.ts) have stricter rules because they must validate and recover a sequence of changes. They reject symlinks in operation paths and recheck their workspace root before mutation. Ordinary editor operations retain the symlink behavior described above.

Agent permissions are selected separately. The application-scoped [`chat.defaultRuntimeMode` setting](../packages/contracts/src/settings/keys.ts) defaults to `full-access` for new sessions. Platform translates the session's mode into [Codex options](../apps/server/src/provider/adapters/codex.ts) or [Claude options](../apps/server/src/provider/adapters/utils/claude-query-options.ts). Each provider applies those options to its own tools. A restricted filesystem API does not confine a provider's shell commands, and changing an agent's permission mode does not narrow your manual editor access.

Repository trust answers another question: whether project contents may cause programs to execute. For example, VS Code limits extensions and project-driven execution in Restricted Mode while still allowing text editing. That is separate from the physical file boundary described here. [VS Code Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust) explains that policy.

The file-server checks validate paths as they exist when checked. They are not an operating-system sandbox against another process swapping paths during an operation. They also provide no inode, hard-link, or mount isolation. Provider processes, terminals, and external MCP servers have their own access rules. Tools that call this filesystem API receive its checks, but separate tools do not inherit them automatically.
