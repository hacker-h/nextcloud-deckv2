# Roadmap

## Multi-server connections

The current login work deliberately targets one operator-configured Nextcloud instance. Connecting several instances at once and mixing their boards in one view is deferred because it changes the session model: every stored session must be bound to the exact instance that minted it, and the proxy must guarantee that a token for one server can never be replayed against a different server. That binding is security-sensitive enough to deserve its own design and test pass rather than being folded into the first auth migration.

## User-supplied instance URL

Letting users type the Nextcloud URL at login is also deferred. It requires a real SSRF guard before the backend can safely make requests to arbitrary user-provided hosts: HTTPS-only URLs, rejection of private, link-local, and loopback address ranges, re-validation after redirects to defeat DNS rebinding, and optionally an operator allowlist. Without those protections, this backend would become an open proxy into the deploying host's network.

## Per-server keep-me-signed-in toggles

The first auth wave keeps sessions persistent across restarts for the single configured server. Per-server "keep me signed in" toggles belong with the multi-server model, because the preference has to be stored and enforced per connection rather than globally. Deferring it keeps the initial session behavior simple while leaving room for different retention choices once multiple instances exist.

## Planner view and Proton Calendar integration

Shipped. The Planner presents a seven-day view with Proton events, recurring occurrences, dated and unscheduled Deck cards, and every checklist item. Scheduling creates protected events through the operator-owned `proton-calendar-cli` sidecar; recurrence, reminders, all-day checklist dates, durable mappings, idempotent synchronization, explicit conflicts, and Deck↔Proton title/due-date changes are covered. See `docs/proton-calendar.md` for deployment and security boundaries.

## Read-only board support

Read-only boards are included in the switcher and search, marked with a leading lock. Cards open for inspection and attachment download; moving, editing, adding and planning are disabled. Board order can be changed between recent and alphabetical in Options.

## Flexible planning and workflow

See [workflow plan](docs/workflow-plan.md) for the requested defaults, architecture and regression coverage. The sidebar stores personal day/week/month plans independently of Deck deadlines; optional time suggestions consider loaded calendar events and the current board's plans. Timed plans are currently Deck v2 planning records, not new Proton events; the existing Planner remains the explicit Proton scheduling surface.

## Low-priority requests

- [Full offline startup and persistent mutation queue](https://github.com/hacker-h/nextcloud-deckv2/issues/4): after the current workflow features.
- [Multiple instances](https://github.com/hacker-h/nextcloud-deckv2/issues/5): recorded, not part of this implementation.
