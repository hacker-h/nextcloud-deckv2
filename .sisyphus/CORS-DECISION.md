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

### Prerequisites (DNS, TLS, LAN resolution)

1. **DNS** — `deckv2.xhacker.de` CNAME → `alice.xhacker.de`, `proxied = false`,
   TTL 60, via the terraform snippet in PLAN.md §13.
2. **SPA vhost** — a static-file container with `VIRTUAL_HOST=deckv2.xhacker.de` and
   `LETSENCRYPT_HOST=deckv2.xhacker.de`; nginx-proxy and acme-companion pick it up
   automatically and issue the certificate.
3. **FritzBox rebind exception** — the `fritzbox` CLI now ships a `dns-rebind`
   subcommand (`list / add / remove / import / export`, with automatic backups).
   Verified: **191** exceptions exist, `nextcloud-alice.xhacker.de` is already
   among them, `deckv2.xhacker.de` is **not**. So after the DNS record exists:

   ```sh
   .venv/bin/python3 fritzbox_cli.py --address 192.168.0.1 --tls false \
     dns-rebind add deckv2.xhacker.de
   ```

   **Gotcha:** `fritz.env` points `URL` at the remote MyFRITZ endpoint
   (`…myfritz.net:47883`), which serves an HTML login page rather than TR-064 XML;
   the CLI then dies with `xml.etree.ElementTree.ParseError`. From the LAN, override
   with `--address 192.168.0.1 --tls false`. Verified working.

4. Confirm `dig @192.168.0.1 deckv2.xhacker.de` matches `dig @1.1.1.1 …`.

### Measured: which paths need headers, and which must be left alone

| Path | Nextcloud's own `Access-Control-Allow-Origin` |
|---|---|
| `/index.php/apps/deck/api/v1.0/...` | **1 header, already correct** |
| `/ocs/v2.php/apps/activity/...` | **0 headers** |

**This is the decisive safety constraint.** Deck's API already emits a correct ACAO
for our origin. Adding another at nginx would send the header **twice**, and every
browser rejects a duplicated `Access-Control-Allow-Origin` outright — which would
break the API path that currently works.

> **Rule: add CORS headers only on the activity path. Never touch `/index.php/`.**

`add_header` also silently drops inherited headers when redefined in a nested
`location`, so scoping is doubly important.

### Safe defaults chosen

| Decision | Value | Why |
|---|---|---|
| Header scope | `location ^~ /ocs/` only | The only path lacking CORS; avoids duplication |
| Allowed origin | literal `https://deckv2.xhacker.de` | No regex, no `$http_origin` reflection, no wildcard |
| `Allow-Credentials` | **not set** | We use `Authorization`, not cookies. Omitting it keeps the header set minimal |
| Allowed headers | `Authorization, Content-Type, Accept, OCS-APIRequest` | Exactly what the client sends; OCS *does* require `OCS-APIRequest` |
| Allowed methods | `GET, OPTIONS` | History is read-only. No write methods exposed |
| `always` flag | yes | Headers must survive 304/4xx, and activity returns 304 often |
| Preflight | `OPTIONS` → 204, no body | Standard, cheap |
| ACME block | copied verbatim from `default` | Mandatory (see trap above) |

Least privilege throughout: one origin, one path prefix, read-only methods.

### Config to install as `/etc/nginx/vhost.d/nextcloud-alice.xhacker.de`

```nginx
## MUST be kept: vhost.d/<host> REPLACES vhost.d/default, which holds this block.
## Removing it breaks Let's Encrypt renewal (cert expires ~60 days later).
location ^~ /.well-known/acme-challenge/ {
    auth_basic off;
    auth_request off;
    allow all;
    root /usr/share/nginx/html;
    try_files $uri =404;
    break;
}

## CORS for the SPA — ONLY on /ocs/ (activity API).
## Deliberately NOT applied to /index.php/, where Deck already sets ACAO itself;
## a second header there would be a duplicate and browsers would reject it.
location ^~ /ocs/ {
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin  "https://deckv2.xhacker.de" always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Accept, OCS-APIRequest" always;
        add_header Access-Control-Max-Age       1728000 always;
        add_header Content-Length 0;
        return 204;
    }
    add_header Access-Control-Allow-Origin  "https://deckv2.xhacker.de" always;
    add_header Access-Control-Expose-Headers "ETag" always;

    proxy_pass http://nextcloud-alice.xhacker.de;
    set $upstream_keepalive false;
}
```

`Expose-Headers: ETag` is required — without it JS cannot read the ETag, and §3.4
polling depends on it.

### Verification (all must pass before relying on it)

1. `diff` the generated `default.conf` before/after — the `nextcloud.xhacker.de`
   server block must be **byte-identical**.
2. Preflight on `/ocs/` returns 204 with exactly **one** ACAO.
3. `/index.php/apps/deck/api/v1.0/boards` still returns exactly **one** ACAO
   (regression check for duplication).
4. `curl http://nextcloud-alice.xhacker.de/.well-known/acme-challenge/probe`
   still routes to the ACME handler (404 from the challenge root, not a proxy pass).
5. `nginx -t` before reload; reload rather than restart.
6. Production smoke test: `nextcloud.xhacker.de` still serves 200.

### Rollback

Delete the vhost.d file, `nginx -t`, reload. Production config is never touched and
the alias carries no traffic, so rollback is immediate and observable.

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
