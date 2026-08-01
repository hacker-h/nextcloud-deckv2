2026-08-01 Wave 1:
- Implemented Wave 1 as small dependency-free ESM modules under `server/`: config, cookie helpers, encrypted session store, Login Flow v2 client, app/router, and `server/index.js` wiring.
- Kept proxy as a strict allowlist: Deck REST via `/api/deck/*`; OCS proxy only for Deck comments and the activity filter already represented in tests. `/ocs/v2.php/core/apppassword` is used internally for logout revocation, not exposed as a browser proxy path.
- Did not edit the plan checkboxes despite the user request, because Work_Context says the plan file is read-only and managed by the orchestrator.

2026-08-01 Flow binding fix:
- Chose `flow=<random 32-byte base64url>` as a short-lived httpOnly cookie. The server stores pending flows by this id, clears it after session minting, and evicts expired entries on login/poll. Missing, forged, or expired flow ids return 410 and never call Nextcloud poll.
