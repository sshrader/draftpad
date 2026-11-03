# Draftpad

Prototype front end for a Solana launchpad. It ranks the top 10 trending tokens over a 24-hour window, screens them with range-safety limits (liquidity, age, holder concentration, bundled buys, mint and freeze authority), and lets a creator stage a launch inspired by one of them with their own name, ticker, artwork, fees, and pairing.

**Status:** prototype. All 15 tokens are fictional sample data. Nothing touches a blockchain, and the launch form only stages a settings sheet.

## Run locally

```bash
npm start
# open http://localhost:3000
```

Requires Node 20 or newer. There are no dependencies to install.

## Deploy to Railway

1. In Railway, choose **New Project**, then **Deploy from GitHub repo**, and pick this repository.
2. Railway detects the Node app from `package.json` and runs `npm start`. It sets `PORT` itself.
3. Open the service's **Settings**, then **Networking**, and generate a public domain.
4. Optional: set the health check path to `/healthz`.

No environment variables are needed yet.

## Layout

| Path | What it is |
|---|---|
| `public/index.html` | The whole front end: styles, sample data, scoring, filters, launch form |
| `server.js` | Static file server with a `/healthz` route |

## How the pad score works

Each token scores out of 100: 35 for unique buyers (full marks at 5,000), 30 for volume momentum (last 6 hours against the 18 before, full marks at 3x), 20 for holder spread, and 15 for bundle cleanliness. Range safety is separate: a token that misses a limit is held back however high it would score.

## Next

- Live feed: a server-side endpoint that pulls trending Solana tokens from a market-data API or an indexer and replaces the sample data.
- Vamp offer mode: migration bonus for holders of the original token, plus an original-versus-new terms comparison.
- Devnet spike on Meteora's Dynamic Bonding Curve, with a migration vault as the one custom program.

## Notes

- Launches never reuse the original token's name, ticker, or artwork. The form rejects names and tickers that are too close to the source token and requires the creator's own image.
- Not legal or financial advice. Get a Solana-specialist audit before any program holds real funds.
