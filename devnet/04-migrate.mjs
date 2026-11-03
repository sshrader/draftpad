// Migrates a full curve to a DAMM v2 pool. On devnet the automatic keeper does not run, so this is manual.
// Usage: DAMM_V2_CONFIG=<address> node 04-migrate.mjs
// DAMM_V2_CONFIG is the DAMM v2 config account the migration pool should use. Look up the devnet
// value in Meteora's docs (DAMM v2 config keys). If you are unsure, send me the error text.
import { PublicKey } from '@solana/web3.js';
import { client, loadKey, send, readState } from './lib.mjs';

const state = readState();
if (!state.pool) { console.error('No pool yet. Run: npm run pool'); process.exit(1); }
if (!process.env.DAMM_V2_CONFIG) { console.error('Set DAMM_V2_CONFIG to the devnet DAMM v2 config address.'); process.exit(1); }

const payer = loadKey('partner');
const { dbc } = await client();

const res = await dbc.migration.migrateToDammV2({
  payer: payer.publicKey,
  pool: new PublicKey(state.pool),
  dammConfig: new PublicKey(process.env.DAMM_V2_CONFIG)
});
// The SDK returns { transaction, ... }. Some migration steps may need extra signers.
const tx = res.transaction || res;
const extra = (res.signers || []).filter(Boolean);
await send(tx, [payer, ...extra], 'migrate to DAMM v2');
console.log('Migrated. Check the pool and token on https://explorer.solana.com/?cluster=devnet');
