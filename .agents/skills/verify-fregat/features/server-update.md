# Server update

The titlebar's right cell shows "Update available" with a Restart button once `deploy --server` has staged a release (`<production root>/pending`) and told the server. The item reads only the `server.update` frames the orchestration socket pushes; it never polls `/release`.

- Restart with nothing running restarts at once and the item turns to "Restarting…".
- Restart with sessions running opens the "Restart server" alertdialog, which lists each session by title with its state. Cancel changes nothing; confirming sends the listed ids, and a session that became busy meanwhile comes back as a new list in place.
- A failed post-restart live check newer than the page toasts the server's message with the rollback command as its fix.

`scenario server-update` stages a release into the throwaway server's `PLATFORM_PRODUCTION_ROOT` and sends SIGUSR2, starts a native turn, opens and cancels the confirmation, answers the idle Restart through `page.route` (so the unsupervised server keeps running), then points `current` at a release with a failed `live-check.json`. Steps: `update-available`, `restart-confirmation`, `restarting`, `live-check-failed`. The real exit and promotion are owner checks on the mesh.
