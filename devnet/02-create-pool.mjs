// Launches a test token on the config from step 1.
// Usage: node 02-create-pool.mjs [--name "Salt Lantern"] [--symbol LNTRN] [--uri https://.../token.json]
// The uri must point at public JSON metadata ({"name","symbol","image"}). Any public URL works on devnet.
import { Keypair } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { client, loadKey, send, readState, writeState, arg } from './lib.mjs';

const state = readState();
if (!state.config) { console.error('No config yet. Run: npm run config'); process.exit(1); }

const creator = loadKey('partner');
const { dbc } = await client();
const baseMint = Keypair.generate();

// Meteora's docs put createPool under client.creator; older builds used client.pool.
const createPool = ((dbc.creator && dbc.creator.createPool) ? dbc.creator : dbc.pool).createPool.bind(dbc.creator && dbc.creator.createPool ? dbc.creator : dbc.pool);
const tx = await createPool({
  baseMint: baseMint.publicKey,
  config: new PublicKey(state.config),
  name: arg('name', 'Draftpad Test'),
  symbol: arg('symbol', 'DPTEST'),
  uri: arg('uri', 'https://example.com/draftpad-test.json'),
  payer: creator.publicKey,
  poolCreator: creator.publicKey
});

await send(tx, [creator, baseMint], 'create pool');

const { deriveDbcPoolAddress } = await import('@meteora-ag/dynamic-bonding-curve-sdk');
const { NATIVE_MINT } = await import('@solana/spl-token');
const pool = deriveDbcPoolAddress(NATIVE_MINT, baseMint.publicKey, new PublicKey(state.config));
writeState({ baseMint: baseMint.publicKey.toBase58(), pool: pool.toBase58() });
console.log('Token mint: ' + baseMint.publicKey.toBase58());
console.log('Pool:       ' + pool.toBase58());
