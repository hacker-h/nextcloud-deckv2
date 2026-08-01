2026-08-01 Wave 1:
- Live proxy proof initially returned `401` when seeding the session file after server startup because `SessionStore` is in-memory after boot. Seed before boot or add explicit test-only session minting in later E2E work.
- Live proxied `/api/deck/boards` returned 19 boards through raw proxy, while plan research mentioned 16 editable visible boards. This is not a Wave 1 backend failure: filtering/hiding read-only boards remains client-side in current `deck.js` and is untouched in Wave 1.

2026-08-01 Flow binding fix:
- Rejected Wave 1 bug: `/auth/poll` read a single global pending flow and could mint Alice's session for a second browser polling without having initiated Alice's flow. Fixed by requiring a matching `flow` cookie and allowing concurrent map entries.
