# CORS / deployment decision

Chosen: **(a)** inject CORS headers at nginx-proxy, with **(b)** same-origin as fallback.

This document records how (a) is implemented safely, because the naive
implementation would take down the production Nextcloud.

---

## Constraint that dominates everything

`nextcloud.xhacker.de` is **production**, serving `antonia` and other family
accounts, 4058 live cards. Every request in the sampled proxy log (748/748) targets
this host. Any config change to it risks a live outage.

Therefore: **the `nextcloud.xhacker.de` vhost is not modified.**

---

## Critical trap in nginx-proxy (would break TLS renewal)

`nginx.tmpl` (lines 738–741) includes per-vhost config as an **if/else**:

```
{{- if (exists (printf "/etc/nginx/vhost.d/%s" $host)) }}
include /etc/nginx/vhost.d/{{ $host }};
{{- else if (exists "/etc/nginx/vhost.d/default") }}
include /etc/nginx/vhost.d/default;
```

`/etc/nginx/vhost.d/default` is **not** merged with a host-specific file — it is
**replaced** by it. And `default` currently contains the only ACME challenge block:

```
location ^~ /.well-known/acme-challenge/ { ... }
```

So creating `/etc/nginx/vhost.d/nextcloud.xhacker.de` to add CORS headers would
silently remove the ACME challenge handler for that host. Let's Encrypt renewal
would fail ~60 days later, the certificate would expire, and **the entire family's
Nextcloud would become unreachable** — with no obvious link back to this change.

**Any host-specific vhost.d file must therefore re-include the ACME block.**

---

## Chosen implementation

Nextcloud already answers on **`nextcloud-alice.xhacker.de`** — an existing alias
to the *same* container:

- already in `trusted_domains`
- already has a valid TLS certificate
- serves the Deck API and the Activity API correctly (verified: `/boards` → 200,
  activity filter → 304)
- **carries zero traffic** (0 of 748 sampled requests)

The SPA therefore talks to the **alias host**, and CORS headers are added only
there. Production stays untouched.

```
Browser (https://deckv2.xhacker.de)          <- static SPA, new vhost
    |
    |  XHR + Basic Auth (app password)
    v
https://nextcloud-alice.xhacker.de           <- CORS headers added here only
    |                                            (zero-traffic alias)
    v
nextcloud-nextcloud-1                        <- same container as production
```

Blast radius of a mistake: a host nothing currently uses.

### Steps

1. **DNS** — `deckv2.xhacker.de` → alice, via Cloudflare (nameservers
   `delilah/garret.ns.cloudflare.com`). Match the proxy mode of the existing
   `xhacker.de` records.
2. **SPA vhost** — new container (static file server) with
   `VIRTUAL_HOST=deckv2.xhacker.de` + `LETSENCRYPT_HOST`, picked up automatically
   by nginx-proxy and acme-companion.
3. **CORS on the alias** — create
   `/etc/nginx/vhost.d/nextcloud-alice.xhacker.de` containing:
   - the **ACME challenge block copied verbatim from `default`** (mandatory, see
     above), and
   - CORS headers for `deckv2.xhacker.de` on the OCS/activity paths, including
     `OPTIONS` preflight handling returning 204.
4. **Verify before relying on it**: preflight returns
   `access-control-allow-origin: https://deckv2.xhacker.de`; the ACME path still
   resolves on the alias; `nextcloud.xhacker.de` is byte-identical in the generated
   config (`diff` before/after).

### Rollback

Delete the vhost.d file and reload nginx. Since production config is never touched
and the alias is unused, rollback is immediate and observable.

---

## Fallback (b)

If the alias approach proves unworkable — e.g. Nextcloud emits absolute URLs bound
to `overwrite.cli.url` that break the SPA, or Cloudflare complicates the new
hostname — serve the SPA same-origin under `https://nextcloud.xhacker.de/board/`.
That removes every CORS question permanently, at the cost of a location block on
the production vhost (which carries the ACME trap above and needs a maintenance
window).

---

## Note on auth

Cross-origin means **no session cookies**: authentication is app-password Basic Auth
via the `Authorization` header. `Access-Control-Allow-Credentials: false` is
therefore irrelevant — it only governs cookie-bearing requests.

Consequence: the app password is a **long-lived credential held in the browser**.
It must live in a scoped store, never in `localStorage` alongside cached board data,
and must be revocable from Nextcloud settings without touching the account password.
Revisit at M1 when auth is wired up.
