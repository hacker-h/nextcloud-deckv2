# Proton Calendar integration

Deck v2's Planner uses the private, server-side `proton-calendar-cli` bridge. Browser code never receives Proton cookies, credentials, calendar IDs, or the bridge bearer token.

## What synchronizes

- A dated Deck card becomes a protected Proton event.
- Every checklist item is independently schedulable; date-only checklist items become all-day events.
- Daily, weekly, monthly, and yearly recurrence supports an interval plus either a count or end date.
- Planner shows expanded recurring occurrences and existing Proton events in a seven-day range.
- Title and due-date changes synchronize in both directions. Simultaneous edits are reported as conflicts instead of being overwritten.
- Clearing a Deck due date removes only the Proton event linked by Deck's durable mapping.

## Sidecar deployment

Run `pc login` in `proton-calendar-cli` once. It creates an owner-only cookie bundle and server env file. Mount that secret directory into the bridge container and load the same env file into Deck so the bearer token is not duplicated:

```yaml
services:
  proton-calendar:
    image: ghcr.io/hacker-h/proton-calendar-cli:latest
    env_file: ./proton-secrets/pc-server.env
    environment:
      HOST: 0.0.0.0
      COOKIE_BUNDLE_PATH: /app/secrets/proton-cookies.json
    volumes:
      - ./proton-secrets:/app/secrets
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:8787/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

  deckv2:
    image: ghcr.io/hacker-h/nextcloud-deckv2:latest
    env_file: ./proton-secrets/pc-server.env
    environment:
      PROTON_CALENDAR_API_URL: http://proton-calendar:8787
      PROTON_CALENDAR_DECK_USERS: your-nextcloud-login
      PROTON_CALENDAR_TIMEZONE: Europe/Berlin
      CALENDAR_SYNC_FILE: /app/.data/calendar-sync.json
    depends_on:
      proton-calendar:
        condition: service_healthy
```

`PROTON_CALENDAR_API_TOKEN` and `PROTON_CALENDAR_ID` may be set explicitly. For a sidecar deployment, Deck also accepts the bridge-native `API_BEARER_TOKEN` and `TARGET_CALENDAR_ID`/`DEFAULT_CALENDAR_ID` names.

Keep the secret directory mode `0700` and its files `0600`. Do not publish it as a CI artifact. Restrict `PROTON_CALENDAR_DECK_USERS` to exact Nextcloud login names. The integration fails closed if its URL/token pair or user allowlist is incomplete.

## Verification

The normal suite covers configuration, authorization, same-origin mutations, redaction, mappings, synchronization/conflicts, recurrence UI, drag scheduling, and mocked browser flows. `npm run test:proton:live` is an opt-in destructive canary: it requires `RUN_LIVE_PROTON_INTEGRATION=1`, creates uniquely named test events, validates recurring expansion and updates, and removes all mappings/events in a `finally` cleanup.
