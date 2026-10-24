# authoring commands

`createMarkdownAuthoringPlugin()` works in plain source and in live preview. it registers these commands

| command                  | does                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `markdown.bold`          | toggles `**`                                                         |
| `markdown.italic`        | toggles `*`                                                          |
| `markdown.strikethrough` | toggles `~~`                                                         |
| `markdown.code`          | toggles backticks                                                    |
| `markdown.link`          | wraps in a link, or selects the destination of the link at the caret |
| `markdown.heading`       | level-two heading                                                    |
| `markdown.bulletList`    | bullet list                                                          |
| `markdown.orderedList`   | numbered list                                                        |
| `markdown.taskList`      | task list                                                            |
| `markdown.toggleTask`    | checks or unchecks a task, bulleted or numbered                      |
| `markdown.quote`         | block quote                                                          |
| `markdown.codeBlock`     | fenced code block                                                    |

the default keymap binds Mod+B, Mod+I and Mod+Shift+K to bold, italic and link. Tab and Shift+Tab indent and outdent list items, outside code blocks

## how they edit

commands run on one selection in a writable markdown document. each one edits the source directly, so the buffer's undo history keeps every change

they read the parser's current records, so a command can remove the mark around the caret or select an existing link destination. a command that runs before the parse is current waits for it. a pending command is dropped if its document, source, selection or writability changes in the meantime

toggling a nonempty selection removes marks that intersect it and leaves formatting outside it alone. an unmarked selection gets marks on each nonblank line. italics use asterisks, so a partial-word selection stays valid markdown

## preview details

pipe tables keep the width of hidden syntax as spacing, so formatted cells stay in their columns. rendered links carry their destination as `href` and as a tooltip
