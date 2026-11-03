# Draftpad devnet spike

Proves the Meteora Dynamic Bonding Curve lifecycle on **devnet**: create config, launch a token, buy until the curve is full, migrate to DAMM v2. Nothing here touches the website or real money.

**Status: untested.** These scripts were written from Meteora's docs without being able to install the SDK, so expect to fix a name or parameter on the first run. Each script prints the full error. Send it to Claude and it gets fixed.

## Setup (your computer)

You need Node 20 or newer.

```bash
cd devnet
npm install
export RPC_URL=https://api.devnet.solana.com   # or a free Helius / QuickNode devnet URL
```

The scripts refuse to run if `RPC_URL` looks like mainnet.

## Run it

```bash
npm run keys      # makes two throwaway wallets in devnet/keys/ and tries an airdrop
```

Fund both addresses at https://faucet.solana.com (pick devnet). The partner wallet needs about 1 SOL. The buyer needs a bit more than the migration threshold (default 5 SOL, so ask for 6+; the faucet is rate limited, so a Helius or QuickNode devnet key helps).

```bash
npm run config    # builds the curve and creates the config
npm run pool      # launches a test token (--name, --symbol, --uri to change it)
npm run buy       # buys 1 SOL at a time until the curve is full (--step, --max)
npm run migrate
npm run claim     # shows fees earned on the curve and claims the platform and creator shares
```

Use a launch sheet from the page: stage a launch, press **Copy settings**, save it as `launch-sheet.json`, then run `npm run config -- --sheet ../launch-sheet.json`.

State (config, pool, token mint) is saved in `devnet/state.json`. Keys are in `devnet/keys/`. Both are git-ignored. Never paste a key file into chat or commit it.

## How the page's settings map to DBC

| Page setting | DBC | Note |
|---|---|---|
| Platform + creator fee | Fee scheduler ends at the total (bps); creator gets a share of it | Approximation. DBC has one fee curve, not two flat fees, and Meteora keeps a protocol share. The page wording will change once this is tested. |
| Anti-sniper | Fee scheduler starts at 50% and decays | `START_FEE_BPS` to change |
| Pairs against | Quote mint | SOL only for now |
| Wallet cap, first 10 min | Not applied | No native DBC feature found |
| Creator allocation and vesting | Removed | Decided: no creator allocation. Creators buy on the curve like everyone else, so there is nothing to vest. DBC's `lockedVesting` is left at zero. |
| Holder offer | Not applied | Needs the separate claim program |

## Not done yet

- Fees earned after migration (they come from the DAMM v2 pool's locked liquidity, not the curve).
- Migration needs the devnet DAMM v2 config address, which I did not find in the docs I read.
- A mainnet review. Do not point any of this at mainnet.
