# Duckwerks Dashboard

A production inventory and order-management tool for dual-marketplace resale (eBay and Reverb). It runs the listing, order, shipping, and analytics workflow behind Duckwerks Music, and I use it daily to run the business.

Designed and built by Geoff Goss with Claude Code. It started as a single HTML file in Claude Desktop and grew into a full-stack local web app over a few weeks of iterative development. Full case study and build story: [duckwerks.com/work/duckwerks-dashboard](https://duckwerks.com/work/duckwerks-dashboard/).

![Duckwerks v.1 to v2.0](public/v2/images/sidebyside.png)
_side by side comparison of v.1 to v2.0_

---

## Highlights

- **Inventory and lots:** items with cost, status, category, and site; multiple listings per item; bundle low-value items into lots and track cost recovery.
- **Profit math:** site-aware fee calculation for eBay, Reverb, and Facebook; earnings-after-fees per item; estimate vs. actual throughout.
- **Shipping:** EasyPost rates (USPS, UPS, FedEx), one-click label purchase, tracking capture, and auto-mark-shipped. Combine multiple same-buyer orders onto one label with shipping split across items.
- **Marketplace sync:** eBay (OAuth with auto-refresh, orders awaiting shipment, tracking push, listing import and diff) and Reverb (orders, direct ship, listing sync).
- **Comp research:** pulls sold-price comps from eBay (SerpAPI) and Reverb (headless scrape), then has Claude analyze them into a narrative plus a structured CSV.
- **Analytics:** per-listing views, impressions, and CTR, all sortable; a momentum chart showing gross and net by marketplace over a rolling window.
- **Disc-golf intake:** flight-number lookup seeded from a 1,918-disc table auto-fills listings; bulk eBay lister creates Inventory API listings from a catalog.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Alpine.js, no build step |
| Backend | Node 22 + Express (local server) |
| Database | SQLite via `better-sqlite3` |
| Shipping | EasyPost API |
| Marketplaces | Reverb API, eBay Sell Fulfillment + Inventory API |
| Comp research | SerpAPI, Puppeteer, Claude API |

---

## Running locally

```bash
npm install
npm start    # http://localhost:3000
```

Requires a `.env` with EasyPost tokens, eBay OAuth credentials, a from-address, and (for comp research) a SerpAPI key, an Anthropic API key, and a local Chrome path. The full variable list is in [`docs/claude/api-reference.md`](docs/claude/api-reference.md).

---

## Deployment

Runs persistently on an Intel NUC (Fedora) under PM2, served at `dash.duckwerks.com` through a Cloudflare Tunnel with Cloudflare Access auth. Operational notes (PM2, systemd, tunnel) live in [`GOTCHAS.md`](GOTCHAS.md).

---

## Documentation

- Deeper technical docs (codebase map, API and frontend reference): [`docs/index.md`](docs/index.md)
- Case study and build timeline: [duckwerks.com/work/duckwerks-dashboard](https://duckwerks.com/work/duckwerks-dashboard/)

---

## Design

Dark theme · `Space Mono` body · `Bebas Neue` large numbers

Color semantics: **yellow** = estimate/pending · **green** = actual/positive · **red** = cost · **blue** = action

![Duckwerks Forever](public/v2/images/duckwerksheader.jpeg)
