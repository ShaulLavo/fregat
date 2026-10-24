# Reach Fregat from a phone or another computer

The Fregat server listens on `127.0.0.1` only. It refuses to start on any other host (`FS_HOST=0.0.0.0` stops with "FS RPC server must bind to a loopback host"), so a second device can never connect to its port directly. You put something in front of it: an SSH tunnel, or an HTTPS reverse proxy.

Two checks decide whether a device gets in:

1. **Origin.** The page's origin must be in the server's exact allowlist. The server reads extra origins from `SERVER_ALLOWED_ORIGINS` (comma-separated) and from nowhere else. A request from an unlisted origin gets `403`.
2. **Pairing.** A browser that is not on the machine itself pairs once with a code, then holds a device cookie. A code works once and expires after 5 minutes.

Access to the server is access to your files, terminals and agents. Pair only devices you trust, and keep the address private.

## Before you start

Run a built release. A release serves the web page and the API from one origin, so one address works for every device. `bun run dev` serves the page from Vite on `127.0.0.1:5173`, while the page calls the API on `127.0.0.1:3001`, so a phone cannot use it.

```sh
bun run build-release --output=./fregat-release
```

On a warm checkout the build took about half a minute and ended with `[release] built ./fregat-release`.

## From a phone: HTTPS through Tailscale Serve

[Tailscale Serve](https://tailscale.com/kb/1312/serve) puts an HTTPS address on your tailnet in front of a local port. Your phone needs Tailscale signed in to the same tailnet. HTTPS must be enabled for the tailnet.

1. Find the machine's name with `tailscale status --json` (the `Self.DNSName` field, without the trailing dot). The steps below use `my-machine.tailnet-name.ts.net`.
2. Start the server from the release, naming the address your phone will open:

   ```sh
   cd fregat-release
   NODE_ENV=production PORT=3012 WEB_ROOT="$PWD/web" \
     SERVER_ALLOWED_ORIGINS=https://my-machine.tailnet-name.ts.net:8443 \
     ./bin/bun server/index.js
   ```

   This uses your normal state home, `~/.platform`. Add `PLATFORM_HOME=<folder>` to try it in an isolated one. The first origin in `SERVER_ALLOWED_ORIGINS` becomes the address in pairing links.

3. In another terminal, publish the port on the tailnet:

   ```sh
   tailscale serve --bg --https=8443 3012
   ```

4. Make a pairing code on the machine:

   ```sh
   bun run pair --address=http://127.0.0.1:3012
   ```

   Run this from your checkout. In a release folder, run `./bin/bun server/pair.js --address=http://127.0.0.1:3012` instead. It prints a code and a link, for example `https://my-machine.tailnet-name.ts.net:8443/pair#token=2SSUFU63RJNM`.

5. Open the link on the phone, or open the address and type the code. The phone now has access until you remove it in Settings › Machines.

Stop sharing with `tailscale serve --https=8443 off`, and stop the server with Ctrl-C.

Verified on 2026-10-24 on macOS with Tailscale 1.102 and a release built from `main`: the page loaded over the tailnet address, an unpaired request was refused, a pairing code paired the device, and the status then showed it as paired. Not verified: terminals and chat sockets through Serve, and a phone browser (the checks used `curl`).

## From another computer: an SSH tunnel

If you have SSH access to the machine, forward the server's port and open it as a local address. SSH makes the connection from the machine's own loopback, so the server treats you as the machine and asks for no pairing.

```sh
ssh -L 3012:127.0.0.1:3012 you@machine
```

Then open `http://127.0.0.1:3012` on your computer. Use the same port number on both sides: the page's origin must match the server's own loopback address, and any other local port gets `403`. This route is read from the server code and was not run over a real SSH session. Start the server as in the Tailscale steps, leaving out `SERVER_ALLOWED_ORIGINS`.

To use another machine's Fregat from your own app instead, add it under Settings › Machines. It connects over SSH or an HTTPS address. [Federated environments](federated-environments.md) explains that connection.

## Other reverse proxies

Any HTTPS proxy on the same machine can replace Tailscale Serve. It must forward to `127.0.0.1:<port>` and keep the public `Host`, or add a forwarding header such as `X-Forwarded-For`. List its public origin in `SERVER_ALLOWED_ORIGINS`. [Reverse proxy device trust](development.md#reverse-proxy-device-trust) lists the rules and the unsafe configuration. No proxy other than Tailscale Serve was tested.

## What does not work yet

- **The installed machine service.** `app:mac` and the machine service start the server with a fixed environment that sets no `SERVER_ALLOWED_ORIGINS`, and the server has no setting for extra origins. A proxy address in front of it gets `403`. No supported option exists today.
- **`bun run dev`.** See [Before you start](#before-you-start).
- **Skipping pairing for your own tailnet devices.** `environments.tailnetOwnerDevices` is on by default, but it only applies when a trusted proxy supplies the client address (`environments.trustedProxyHosts`, an `X-Forwarded-For` the proxy verified). In the test above, a request through Tailscale Serve from the machine itself still showed as unpaired. Whether Serve sends the header was not checked.
- **Tailscale Funnel and other public addresses.** Not tested. Anyone who reaches a public address can try to pair.
- **The owner's Mesh setup.** `developer.deployTarget` and `bun run install-release` publish through Mesh and user systemd on Linux. They are the owner's integration, described in [Owner-only setup](development.md#owner-only-setup).

If a phone shows the pairing screen or a `403`, see [troubleshooting](troubleshooting.md#a-phone-or-second-computer-shows-a-pairing-screen).
