// Shows the trading fees earned on the curve and claims the partner (platform) and creator shares.
// Usage: node 05-claim-fees.mjs
// Both roles use the "partner" wallet in this spike, so the two shares land in the same place.
// Only fees earned on the curve (before migration) are covered here. Fees after migration come from
// the DAMM v2 pool's locked liquidity position, which is a separate step.
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { client, connection, loadKey, send, readState, sol } from './lib.mjs';

const state = readState();
if (!state.pool) { console.error('No pool yet. Run the earlier steps first.'); process.exit(1); }

const wallet = loadKey('partner');
const pool = new PublicKey(state.pool);
const { dbc } = await client();
const MAX = new BN('18446744073709551615');

const show = (v) => (v && typeof v.toString === 'function') ? v.toString() : String(v);

// The breakdown call and its field names come from Meteora's docs; print whatever it returns.
try {
  const b = await dbc.state.getPoolFeeBreakdown(pool);
  console.log('Fee breakdown (lamports for SOL-quoted fees):');
  console.log(JSON.stringify(b, (k, v) => (v && v.type === 'BN') || (v && v._bn) || (v && typeof v.toString === 'function' && v.constructor && v.constructor.name === 'BN') ? v.toString() : v, 2));
} catch (err) {
  console.log('Could not read the fee breakdown: ' + (err.message || err));
}

const before = await connection.getBalance(wallet.publicKey);

async function claim(label, build) {
  try {
    const tx = await build();
    await send(tx, [wallet], label);
  } catch (err) {
    console.log(label + ' failed: ' + (err.message || err));
  }
}

await claim('claim partner (platform) fees', () => dbc.partner.claimPartnerTradingFeeToReceiver({
  feeClaimer: wallet.publicKey, payer: wallet.publicKey, pool,
  maxBaseAmount: MAX, maxQuoteAmount: MAX, receiver: wallet.publicKey
}));

await claim('claim creator fees', () => dbc.creator.claimCreatorTradingFeeToReceiver({
  creator: wallet.publicKey, payer: wallet.publicKey, pool,
  maxBaseAmount: MAX, maxQuoteAmount: MAX, receiver: wallet.publicKey
}));

const after = await connection.getBalance(wallet.publicKey);
console.log('Partner wallet SOL: ' + sol(before).toFixed(6) + ' -> ' + sol(after).toFixed(6) + ' (network fees are included in the change)');
console.log('If the fees came back as wrapped SOL, they sit in a token account instead of the SOL balance. Check the explorer links above.');
