# Draftpad

Prototype front end for a Solana launchpad. It ranks the top 10 trending tokens over a 24-hour window, screens them with range-safety limits (liquidity, age, holder concentration, mint and freeze authority, and more), and lets a creator stage a launch inspired by one of them with their own name, ticker, artwork, fees, and pairing.

**Status:** prototype. Nothing touches a blockchain, and the launch form only stages a settings sheet. With no API key the page shows 15 fictional sample tokens. With a key it shows live tokens.

## Run locally

```bash
npm start            # sample data, http://localhost:3000
JUPITER_API_KEY=your-key npm start   # live data
npm test             # unit and server tests, no dependencies
```

Requires Node 20 or newer. There are no dependencies to install.

## Live feed

The server calls Jupiter's Tokens API v2 (`/tokens/v2/toptrending/24h`), keeps the key private, caches the result for 5 minutes, and serves it at `/api/trending`. The page falls back to sample data if the feed is off or failing, and says which.

| Variable | Purpose |
|---|---|
| `JUPITER_API_KEY` | Required for live data. Get one from Jupiter's developer portal (portal.jup.ag) and check the plan limits. |
| `FEED_TTL_SECONDS` | Cache lifetime, default 300. |
| `JUPITER_BASE` | Override the API base URL, default `https://api.jup.ag`. |
| `PORT` | Set by Railway. |

`/healthz` returns `{"ok":true,"liveFeed":true}` so you can confirm the key is set without exposing it. `/api/trending?window=1h|6h|24h` (default `24h`) returns the candidate pool for that window. Each pool merges Jupiter's trending list, its most-traded list and its newest listings (up to 100 each), then drops duplicates, so fresh launches are not buried under older tokens. The page's 1H / 6H / 24H toggle drives it, and the Maximum age filter (default 7 days) keeps the board to young tokens.

What the feed provides and what it does not:

| Signal | Source |
|---|---|
| Liquidity, 24h volume and price change, volume windows (1h, 6h, 24h), organic buyers, holder count | Jupiter |
| Mint and freeze authority, top-holder share, dev balance, suspicious flag | Jupiter audit object |
| Bundled-buy share | Not in this feed. Shown as no data and left out of the score. |
| Hourly candles | Not in this feed. The panel shows average volume per hour by window instead. |

Token names and symbols come from the market and are untrusted text. The server strips control and bidirectional characters, and the page escapes everything it renders.

## Deploy to Railway

1. In Railway, choose **New Project**, then **Deploy from GitHub repo**, and pick this repository.
2. Railway detects the Node app from `package.json` and runs `npm start`. It sets `PORT` itself.
3. Open the service's **Variables** tab and add `JUPITER_API_KEY`.
4. Open **Settings**, then **Networking**, and generate a public domain.
5. Optional: set the health check path to `/healthz`.

## Layout

| Path | What it is |
|---|---|
| `server.js` | HTTP server: static files, `/healthz`, `/api/trending` |
| `feed.js` | Jupiter client: fetch, normalize, cache, stale fallback |
| `public/index.html` | Page markup and styles |
| `public/app.js` | Rendering, filters, live-feed loading, launch form |
| `public/logic.js` | Scoring and screening rules, shared with the tests |
| `public/sample.js` | Fictional sample tokens |
| `test/` | Tests for the scoring, the feed, and the server |

## How the pad score works

Each token scores out of 100: 35 for unique buyers in the chosen window (full marks at 5,000 for sample data; for live data 60, 200 or 500 for 1h, 6h or 24h, since Jupiter's organic-buyer counts are small), 30 for volume momentum (the last 6 hours against the 18 before, full marks at 3x), 20 for holder spread, and 15 for bundle cleanliness. A signal with no data is left out and the total is scaled over the rest. Range safety is separate: a token that misses a limit is held back however high it would score.

Fixed checks that are not sliders: tokens Jupiter flags as suspicious fail, a dev balance above 10% is a warning, and above 25% fails.

## Vamp offer and contract addresses

Every row shows a shortened contract address with a Copy button (the full address goes to the clipboard) and a Solscan link. Sample tokens have no address, so they say so.

**Vamp this token** switches the launch form to a vamp offer. Your token keeps its own name, ticker and artwork, with a "Vamp of X" badge and a listing credit that says it is not affiliated and the original token is unchanged. You set a holder bonus (0 to 15% of supply) and a claim window (7, 14 or 30 days). Holders of the original token opt in to claim, and unclaimed bonus tokens are burned. A comparison table sets the original's liquidity, top holders, authorities, dev holding and fees beside your planned terms, and the staged launch sheet includes all of it. Nothing is deployed. The snapshot, claim and burn mechanics need on-chain programs that are not built yet.

## Next

- Bundled-buy data from a second source, so the last signal can be scored.
- Vamp offer mode: migration bonus for holders of the original token, plus an original-versus-new terms comparison.
- Devnet spike on Meteora's Dynamic Bonding Curve, with a migration vault as the one custom program.

## Notes

- Launches never reuse the original token's name, ticker, or artwork. The form rejects names and tickers that are too close to the source token and requires the creator's own image.
- Not legal or financial advice. Get a Solana-specialist audit before any program holds real funds.
