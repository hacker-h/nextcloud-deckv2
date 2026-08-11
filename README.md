# Nextcloud Deck v2 🚀

[![Build and Publish Docker Image](https://github.com/hacker-h/nextcloud-deckv2/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/hacker-h/nextcloud-deckv2/actions/workflows/docker-publish.yml)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io-blue.svg)](https://github.com/hacker-h/nextcloud-deckv2/pkgs/container/nextcloud-deckv2)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A ultra-fast, modern, responsive **Trello-inspired web client for Nextcloud Deck**, engineered for performance, clean UI aesthetics, and instant keyboard navigation.

---

## ✨ Features

- 🎨 **Trello Dark Theme Aesthetics**: Crafted using official Atlassian design tokens (`#1D2125` canvas, `#101204` list surfaces, `#242528` card tiles).
- 🧭 **Bottom Navigation Dock**: Quick tab access (`Posteingang`, `Planer`, `Board`, `Boards wechseln`).
- ⚡ **Instant Board Switcher**: Instant search & board switching drawer with access permission badges.
- 📝 **Full Card Lifecycle Management**: Edit descriptions, due dates, labels, assignees, sub-card comments, file attachments, and lifecycle actions (`Archivieren`, `Wiederherstellen`, `Löschen`).
- 📦 **Batch Selection & Bulk Actions**: Select multiple cards to move or manage across lists.
- 🔒 **Secure Auth Bridge**: Authenticated server proxy communicating directly with your Nextcloud Deck REST APIs.

---

## 🐳 Quick Start with Docker

You can deploy `nextcloud-deckv2` in seconds using Docker or Docker Compose.

### Docker CLI

```bash
docker run -d \
  --name deckv2 \
  -p 3000:3000 \
  -e NC_URL="https://your-nextcloud-instance.com" \
  -e SESSION_SECRET="change-this-to-a-secure-random-string" \
  ghcr.io/hacker-h/nextcloud-deckv2:latest
```

### Docker Compose

```yaml
version: '3.8'

services:
  deckv2:
    image: ghcr.io/hacker-h/nextcloud-deckv2:latest
    container_name: deckv2
    restart: always
    ports:
      - "3000:3000"
    environment:
      NC_URL: "https://your-nextcloud-instance.com"
      SESSION_SECRET: "your-durable-random-secret-key"
      SESSION_FILE: "/app/.data/sessions.json"
    volumes:
      - deckv2-data:/app/.data

volumes:
  deckv2-data:
```

---

## 🛠️ Local Development

### Prerequisites
- Node.js 22+
- npm 10+

### Setup

```bash
# Clone repository
git clone https://github.com/hacker-h/nextcloud-deckv2.git
cd nextcloud-deckv2

# Install dependencies
npm install

# Run local development server
npm run dev
```

### Testing & Verification

```bash
# Run unit & component test suite (Vitest)
npm test

# Fail on Svelte diagnostics, including accessibility warnings
npm run check

# Fail on high-severity dependency vulnerabilities
npm run test:audit

# Run bundle security scan
npm run test:security

# Run end-to-end browser tests (Playwright)
npm run test:e2e
```

### Production release

After the release commit is pushed to `origin/main`, one command verifies the
successful GitHub Actions image publish, deploys that exact image on Alice,
checks its immutable digest and revision label, and runs the production smoke
suite:

```bash
npm run deploy:production
```

The command fails closed for a dirty worktree, an unpushed commit, a missing or
failed publish run, a revision mismatch, or a failed production smoke test.

---

## 📄 License

MIT License. Free and open source software.
