
## 2026-07-31 T4
- Exposed DeckClient.deck() and DeckClient.ocs() as the reusable transport surface for upcoming card detail clients.
- Error bodies are parsed at transport boundary and redact the Basic Authorization value before entering DeckError.
