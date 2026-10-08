# Plan 337: Pairing a new device

## Status and ownership

- Status: APPROVED, 2026-10-08. Owner decisions after reviewing the first-run mocks (B1 and B2,
  see [Plan 315](315-local-remote-onboarding.md#owners-choice-2026-10-08)).
- Order: B1 and Tailscale sign-in now, in parallel. B2 is scheduled after B1.
- Builds on the pairing that [Plan 143](143-phone-layout.md#phase-4-implemented-2026-09-26-wave-2-lane-p)
  shipped: one-time codes, the `/pair` screen, paired devices in Settings › Machines, revocation
  that closes live sockets. That section stays the record of what exists; this plan owns changes.
- Server code: `apps/server/src/devices/`. Push: `apps/server/src/push/`.

## Outcome

A person who opens Fregat on a new device knows which machine it is, why it is asking, and where
to get a code. Devices that already prove who they are through the owner's Tailscale account skip
pairing. Later, a new device can be approved from a phone notification without typing a code.

## Today

An unpaired device gets a pairing screen with a code field. It does not name the machine or say
where a code comes from. Only the machine's own browser can make a code (`issueLink` throws
`HOST_ONLY` for anyone else). `bun run pair` prints a link, but only from a source checkout with a
deploy target configured.

## B1: a pairing screen that explains itself (now)

The unpaired screen says "Pair this phone with <machine>", one line on why it is showing (this
device has not been paired with that machine yet), and where to get a code:

- on the machine, or on any device already paired with it: Settings › Machines › Pair a device;
- over SSH on the machine: one command that prints a code.

Constraints:

- `/pairing/status` returns the machine's display name. It is reachable before pairing, so it
  returns the name only: no paths, users, addresses or other machine facts.
- Any paired device may issue codes, with the same lifetime, single use and claim limits as today.
  The host-only rule goes away. Codes still never widen access: one trust level, as in Plan 143.
- The command ships with the installed server, needs no source checkout or deploy config, and
  talks to the local server over loopback. It prints the code and the link, and nothing else
  records them.

Checklist:

- [ ] Add the machine display name to `/pairing/status` and its schema. Test that an unpaired,
      forwarded request gets the name and nothing more.
- [ ] Let a paired device's cookie issue codes. Test: a paired device issues a code that a second
      device claims; an unpaired forwarded request is still refused.
- [ ] Show Pair a device in Settings › Machines on paired devices, not only on the host.
- [ ] Add the machine-side command that prints a code and link. Retire `bun run pair` or make it
      call the same command.
- [ ] Rewrite the unpaired screen: machine name, one-line reason, the two places to get a code,
      the code field. Phone and desktop widths.
- [ ] Extend the `device-pairing` scenario: the unpaired screen names the machine; a paired phone
      issues a code that pairs a second device. Read the screenshots back.

## Tailscale sign-in (now)

A device on the owner's tailnet that belongs to the same Tailscale user as the machine is trusted
without pairing. Everyone else pairs as today: devices shared into the tailnet from another
account, other users on the same tailnet, and any setup without Tailscale.

Constraints:

- Identity comes from Tailscale itself, verified by the server. A forwarded header or anything the
  client sends cannot claim it.
- Without Tailscale, or when the identity check fails or is unavailable, the request is treated as
  unpaired. Nothing fails open.
- A device trusted this way appears in the paired-devices list, marked as signed in through
  Tailscale, and losing the Tailscale identity removes its access the same way revocation does.
- `environments.devicePairing` still turns the whole requirement off; a separate setting may turn
  Tailscale sign-in off.
- The mechanism follows the study of how T3 Code (`references/t3code`) handles this. Record the
  chosen mechanism and what was copied in this section when it lands.

T3 Code findings (2026-10-08, `references/t3code` at 12069eefd): T3 Code never trusts Tailscale
identity. `t3 pair --tailscale` publishes the server with Tailscale Serve and prints a one-time
pairing URL and QR code (`/pair#token=…`, valid 5 minutes); claiming it sets a 30-day session
cookie. Its desktop app bootstraps its own window with a separate desktop token. Pairing there is
one scan per device, which is the step this section removes, so nothing was copied.

Mechanism (PR #1035): the server runs `tailscale whois --json` on the single `X-Forwarded-For`
address mesh sets (the server listens only on loopback, so that hop is local), and on its own
tailnet address. Same `UserProfile.LoginName`, no tags on either side and no `Sharer` gives trust
`tailnet`. Verdicts are cached per address for a minute (5 s after a failure) and every failure
pairs. Sockets admitted this way are checked again every minute and on settings changes, and close
when the check fails. `environments.tailnetOwnerDevices` (machine scope, on by default) turns it off.

Checklist:

- [x] Record the T3 Code findings and the chosen mechanism here.
- [x] Trust same-user tailnet devices without pairing; refuse shared-in nodes and other tailnet
      users. Tests for each case, plus the no-Tailscale and failed-lookup cases.
- [ ] Show Tailscale-trusted devices in the paired-devices list.
- [ ] Owner check: the phone on the tailnet opens the app without pairing; a shared-in device still
      gets the pairing screen.

## B2: approve from a notification (later)

TV-style pairing. The new device shows a short code. Every paired device gets a push notification
naming the request; approving it on one of them pairs the new device. The code shown is for
matching, so the approver can check it is the device in front of them.

Constraints:

- Approval requests are rate limited per source and overall, and expire like codes do. A flood of
  requests cannot bury paired devices in notifications.
- Push uses the existing server push (`apps/server/src/push/`). A device without push still pairs
  through B1.
- Approval grants the same single trust level; denial or expiry leaves the new device unpaired.

Checklist:

- [ ] Request and approve endpoints, with expiry and rate limits. Tests for flood, expiry, double
      approval and denial.
- [ ] Push to paired devices with an approve action; the new device's screen updates when approved.
- [ ] Scenario covering request, approval and the refused cases; owner check on a real phone.

## Out of scope

Accounts, hosted relays and third-party pairing services, as in Plan 143.
