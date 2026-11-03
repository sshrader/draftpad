// Builds a curve and creates the DBC config (the "partner" config every Draftpad launch will use).
// Usage: node 01-create-config.mjs [--sheet ../launch-sheet.json]
//   env THRESHOLD_SOL (default 5)   SOL raised on the curve before migration. Kept small so devnet SOL is enough.
//   env SUPPLY_ON_MIGRATION (default 20)   percent of supply sold on the curve before migration
import { Keypair } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { client, loadKey, send, writeState, arg, fromSheet } from './lib.mjs';

const partner = loadKey('partner');
const { sdk, dbc } = await client();
const terms = fromSheet(arg('sheet'));
terms.ignored.forEach(x => console.log('Not applied in this run: ' + x));

// Meteora renamed a few options between SDK versions. Try the names from the current docs first.
const pick = (obj, ...names) => { for (const n of names) if (obj && obj[n] !== undefined) return obj[n]; return undefined; };
const authority = pick(sdk.TokenAuthorityOption, 'PartnerUpdateAuthority', 'Immutable');
const updateAuthority = pick(sdk.TokenUpdateAuthorityOption, 'PartnerUpdateAuthority', 'Immutable');

const thresholdSol = Number(process.env.THRESHOLD_SOL || 5);
const supplyOnMigration = Number(process.env.SUPPLY_ON_MIGRATION || 20);

const curve = sdk.buildCurve({
  token: {
    tokenType: pick(sdk.TokenType, 'SPLToken', 'SPL'),
    tokenBaseDecimal: sdk.TokenDecimal.SIX,
    tokenQuoteDecimal: sdk.TokenDecimal.NINE,
    ...(authority !== undefined ? { tokenAuthorityOption: authority } : {}),
    ...(updateAuthority !== undefined ? { tokenUpdateAuthority: updateAuthority } : {}),
    totalTokenSupply: 1_000_000_000,
    leftover: 1_000
  },
  fee: {
    baseFeeParams: {
      baseFeeMode: sdk.BaseFeeMode.FeeSchedulerExponential,
      feeSchedulerParam: {
        // Anti-sniper: starts high and decays to the steady fee. Same shape as Meteora's example.
        startingFeeBps: Number(process.env.START_FEE_BPS || 5000),
        endingFeeBps: terms.steadyFeeBps,
        numberOfPeriod: 60,
        totalDuration: 60
      }
    },
    dynamicFeeEnabled: true,
    collectFeeMode: sdk.CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: terms.creatorSharePct,
    poolCreationFee: 0,
    enableFirstSwapWithMinFee: false
  },
  migration: {
    migrationOption: sdk.MigrationOption.MET_DAMM_V2,
    migrationFeeOption: sdk.MigrationFeeOption.FixedBps25,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 }
  },
  liquidityDistribution: {
    partnerLiquidityPercentage: 0,
    partnerPermanentLockedLiquidityPercentage: 100,
    creatorLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 0
  },
  lockedVesting: {
    totalLockedVestingAmount: 0,
    numberOfVestingPeriod: 0,
    cliffUnlockAmount: 0,
    totalVestingDuration: 0,
    cliffDurationFromMigrationTime: 0
  },
  activationType: sdk.ActivationType.Timestamp,
  percentageSupplyOnMigration: supplyOnMigration,
  migrationQuoteThreshold: thresholdSol
});

const config = Keypair.generate();
// SDK 2.x uses createConfig2; older builds only have createConfig.
const create = (dbc.partner.createConfig2 || dbc.partner.createConfig).bind(dbc.partner);
const tx = await create({
  config: config.publicKey,
  feeClaimer: partner.publicKey,
  leftoverReceiver: partner.publicKey,
  payer: partner.publicKey,
  quoteMint: NATIVE_MINT,
  ...curve
});

await send(tx, [partner, config], 'create config');
writeState({ config: config.publicKey.toBase58(), thresholdSol });
console.log('Config: ' + config.publicKey.toBase58());
console.log('Steady fee ' + terms.steadyFeeBps + ' bps, creator share ' + terms.creatorSharePct + '%, migrates at ' + thresholdSol + ' SOL.');
