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

Read-only boards remain hidden for now, matching the existing filter in `src/lib/deck.js:128` (`canEdit`). Showing boards the user can only view means more than adding them to the switcher: the UI needs to propagate read-only state through Board → Stack → Card → dnd so drag is disabled, card detail and editors render read-only, and add, archive, and delete affordances disappear. The access model added in `src/lib/permissions.js` already returns `'view'`, so this is UI work only rather than a model change. The live test case for the future feature is board 109, "Antonia Aufgaben", which is shared (`shared:1`) with `PERMISSION_EDIT:false`.
