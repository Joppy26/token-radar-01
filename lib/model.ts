// Token Radar — model radar-2.
//
// A protocol "records no token" when DefiLlama lists no CoinGecko id and no
// ticker for it (gecko_id and symbol both null). That is the pre-token test
// used here: a protocol can show a null market cap while still recording a
// token, and such a protocol is not a launch candidate. The snapshot's own
// watchlist (40 slugs) is the authority for the above-floor set; the
// below-floor set is every rankable pre-token protocol under the floor.
//
// Implied value: round(TVL x catMultiple x growthMult x maturityMult x breadthMult)
//   catMultiple  median mcap/TVL of the snapshot's own live-token protocols
//                in the same category (a live token means a recorded, non-zero
//                market cap and positive TVL; a $0 market cap is a dead token
//                and is not a comp). n >= 3 to use a category directly, else a
//                family fallback, else the global median. Clamped [0.03, 1.50].
//   growthMult   1 + clamp(change_7d, -60, 120) / 100 x 0.5 (null change -> 0)
//   maturityMult 0.6 + min(age_days, 1095) / 1095 x 0.4 (unknown age -> 365 days)
//   breadthMult  1 + min(chains - 1, 4) x 0.03 (at most 1.12)
//
// The board is the 40 watchlist rows plus the 186 rankable pre-token rows
// below the $50M floor: 226 rows. The 63 above-floor rankable protocols that
// are not on the watchlist (bridges, liquid staking, wrapped names and other
// infrastructure) are deliberately excluded: they are infrastructure, not
// launch candidates. No protocol name is ever special-cased.
//
// The implied value is this entry's own model claim. It is not a price, not
// make.fun's claim, and it does not predict whether or when a token is issued.

export const MODEL_VERSION = 'radar-2';

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  tvl_usd: number;
  catMultiple: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  ageDays: number;
  compN: number;
  compMedian: number;
  multipleSource: 'direct' | 'family' | 'global';
  multipleCategory: string;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  listed_at: string | null;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  model: ModelBreakdown;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  mcap_tvl: number;
}

export interface CategoryMultiple {
  category: string;
  n: number;
  median: number;
  source: 'direct' | 'family' | 'global';
}

// Family fallbacks: categories whose live-token comps are too few to trust
// (fewer than 3) borrow the median of the family they belong to.
const FAMILY: Record<string, number> = {
  'Risk Curators': 0.151,
  'Onchain Capital Allocator': 0.151,
  'Liquidity Manager': 0.151,
  Derivatives: 0.654,
  'Interest Rate Derivatives': 0.654,
  'Liquid Restaking': 0.041,
  Restaking: 0.041,
  'Staking Pool': 0.041,
  Farm: 0.18,
  'Leveraged Farming': 0.18,
  'CDP Manager': 0.169,
};

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function ageDaysOf(p: SnapshotProtocol, asOf: Date): number {
  if (!p.listed_at) return 365;
  const listed = new Date(`${p.listed_at}T00:00:00Z`);
  const days = Math.round((asOf.getTime() - listed.getTime()) / 86400000);
  return Math.max(0, days);
}

/** A protocol records no token: no CoinGecko id and no ticker. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Rankable: pre-token, not a centralised exchange, name not versioned. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSION_MARKER.test(p.name);
}

/** A live-token comp: a recorded market cap that is not zero, on positive TVL. */
function isLiveComp(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd !== 0 && p.tvl_usd > 0;
}

export interface Multiples {
  direct: Map<string, { n: number; median: number }>;
  globalMedian: number;
  liveCount: number;
}

export function computeMultiples(protocols: SnapshotProtocol[]): Multiples {
  const live = protocols.filter(isLiveComp);
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '(no category)';
    const arr = byCategory.get(key);
    if (arr) arr.push(p.mcap_usd! / p.tvl_usd);
    else byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
  }
  const direct = new Map<string, { n: number; median: number }>();
  for (const [cat, ratios] of byCategory) {
    if (ratios.length >= 3) direct.set(cat, { n: ratios.length, median: median(ratios) });
  }
  const globalMedian = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  return { direct, globalMedian, liveCount: live.length };
}

function multipleFor(
  category: string | null,
  multiples: Multiples,
): { multiple: number; source: 'direct' | 'family' | 'global'; n: number; median: number; usedCategory: string } {
  if (category && multiples.direct.has(category)) {
    const d = multiples.direct.get(category)!;
    return { multiple: clamp(d.median, 0.03, 1.5), source: 'direct', n: d.n, median: d.median, usedCategory: category };
  }
  if (category && category in FAMILY) {
    const f = FAMILY[category]!;
    return { multiple: clamp(f, 0.03, 1.5), source: 'family', n: 0, median: f, usedCategory: category };
  }
  return {
    multiple: clamp(multiples.globalMedian, 0.03, 1.5),
    source: 'global',
    n: 0,
    median: multiples.globalMedian,
    usedCategory: category ?? '(no category)',
  };
}

// ---------------------------------------------------------------- farm plans

function capitalTier(tvlUsd: number): string {
  if (tvlUsd >= 5000000000) return '$250';
  if (tvlUsd >= 1000000000) return '$150';
  if (tvlUsd >= 100000000) return '$100';
  return '$50';
}

function holdDays(ageDays: number): number {
  if (ageDays < 365) return 60;
  if (ageDays < 730) return 45;
  return 30;
}

interface CategoryActions {
  main: string;
  second: string;
}

const ACTIONS: Record<string, CategoryActions> = {
  Dexs: {
    main: 'Swap {capital} through {name} across at least two different trading pairs, keeping every swap on the same fresh wallet.',
    second: 'Add {capital} to a {name} liquidity pool and hold the LP position; removing it the same day does not count.',
  },
  Lending: {
    main: "Supply {capital} of a major asset to {name}'s lending market and leave it supplied; do not withdraw it the same day.",
    second: 'Borrow a small amount against the supplied collateral on {name}, then repay it in full within the same week.',
  },
  Yield: {
    main: 'Deposit {capital} into a {name} yield vault and leave it earning; the deposit itself is the qualifying action.',
    second: "Claim the vault's yield on {name} once and restake it into the same vault.",
  },
  RWA: {
    main: "Hold a {capital} position in {name}'s tokenized real-world asset and keep the position open for the full hold period.",
    second: "Use the {name} position once in the protocol's secondary market or as collateral, if it offers one.",
  },
  'Risk Curators': {
    main: 'Deposit {capital} into a curated vault on {name} and leave it allocated; a single vault deposit is the qualifying action.',
    second: 'Allocate to a second vault or curator strategy on {name} so the activity spans two strategies.',
  },
  'Onchain Capital Allocator': {
    main: 'Deposit {capital} into a curated vault on {name} and leave it allocated; a single vault deposit is the qualifying action.',
    second: 'Allocate to a second vault or curator strategy on {name} so the activity spans two strategies.',
  },
  'Liquidity Manager': {
    main: 'Deposit {capital} into a managed vault on {name} and leave it allocated; a single vault deposit is the qualifying action.',
    second: 'Allocate to a second managed strategy on {name} so the activity spans two strategies.',
  },
  CDP: {
    main: "Open a collateralized debt position on {name} with {capital} of collateral and mint the protocol's stable asset.",
    second: 'Use the minted stable asset in a paired pool, or repay part of the {name} debt to show active management.',
  },
  'Basis Trading': {
    main: 'Open a {capital} basis position on {name} and hold it through at least one funding cycle.',
    second: 'Open a second, smaller basis position on {name} to show the position is managed, not a single trade.',
  },
  Bridge: {
    main: "Bridge {capital} through {name} from one chain to a second chain, using the protocol's own bridge interface.",
    second: 'Bridge back through {name} or onward to a third chain, so the activity shows repeat use.',
  },
  'Canonical Bridge': {
    main: "Bridge {capital} through {name} from one chain to a second chain, using the protocol's own bridge interface.",
    second: 'Bridge back through {name} or onward to a third chain, so the activity shows repeat use.',
  },
  'Cross Chain Bridge': {
    main: "Bridge {capital} through {name} from one chain to a second chain, using the protocol's own bridge interface.",
    second: 'Bridge back through {name} or onward to a third chain, so the activity shows repeat use.',
  },
  'Liquid Staking': {
    main: 'Stake {capital} through {name} and hold the liquid staking token you receive; do not sell it immediately.',
    second: 'Use the liquid staking token from {name} in a lending market or liquidity pool instead of leaving it idle.',
  },
  'Liquid Restaking': {
    main: 'Stake {capital} through {name} and hold the liquid restaking token you receive; do not sell it immediately.',
    second: 'Use the liquid restaking token from {name} in a lending market or liquidity pool instead of leaving it idle.',
  },
  Restaking: {
    main: 'Restake {capital} through {name} and hold the receipt token you receive; do not sell it immediately.',
    second: 'Use the receipt token from {name} in a lending market or liquidity pool instead of leaving it idle.',
  },
  'Staking Pool': {
    main: 'Stake {capital} in a {name} staking pool and hold the receipt token you receive; do not sell it immediately.',
    second: 'Use the receipt token from {name} in a lending market or liquidity pool instead of leaving it idle.',
  },
  'Yield Aggregator': {
    main: 'Deposit {capital} into an auto-compounding vault on {name} and leave it to compound for the full hold period.',
    second: "Harvest the vault's rewards on {name} once and re-deposit them into the same vault.",
  },
  Derivatives: {
    main: "Open a {capital} position on {name}'s derivatives market and hold it through at least one settlement.",
    second: 'Close the first {name} position and open a second one, showing repeat activity rather than a single trade.',
  },
  'Interest Rate Derivatives': {
    main: "Open a {capital} position on {name}'s rates market and hold it through at least one settlement.",
    second: 'Close the first {name} position and open a second one, showing repeat activity rather than a single trade.',
  },
  Indexes: {
    main: 'Buy {capital} of a {name} index token and hold it through at least one rebalance.',
    second: 'Add to the {name} index position a second time with a different amount.',
  },
  Farm: {
    main: 'Open a {capital} farming position on {name}, keeping the health factor comfortably above liquidation.',
    second: 'Top up collateral on the {name} farming position once and check the health factor after.',
  },
  'Leveraged Farming': {
    main: 'Open a {capital} leveraged farming position on {name}, keeping the health factor comfortably above liquidation.',
    second: 'Top up collateral on the {name} farming position once and check the health factor after.',
  },
  'CDP Manager': {
    main: 'Manage a {capital} collateralized position through {name}, opening it with the collateral the front page asks for.',
    second: 'Adjust the collateral ratio on the {name} position once, in either direction.',
  },
};

const DEFAULT_ACTIONS: CategoryActions = {
  main: "Use {name}'s core product with {capital} (deposit, swap or stake, whichever its front page offers) and keep the position open.",
  second: 'Repeat the core action on {name} a second time with a different asset or amount.',
};

function fill(template: string, name: string, capital: string): string {
  return template.replaceAll('{name}', name).replaceAll('{capital}', capital);
}

export function farmStepsFor(p: SnapshotProtocol, ageDays: number): string[] {
  const capital = capitalTier(p.tvl_usd);
  const days = holdDays(ageDays);
  const actions = (p.category && ACTIONS[p.category]) || DEFAULT_ACTIONS;
  return [
    'Create a fresh wallet just for this farm and write its seed phrase on paper, stored offline. Never reuse a wallet that already holds other funds.',
    fill(actions.main, p.name, capital),
    fill(actions.second, p.name, capital),
    'Repeat the qualifying action once a week until the hold ends, on the same wallet, so the activity reads as sustained use rather than a single visit.',
    `Hold the position for at least ${days} days from the first deposit; do not withdraw early, since short holds are the easiest to filter out.`,
    'When a claim opens, use only the claim link the protocol publishes on its own site or official account. Never pay anyone to claim for you, and never sign a transaction you do not understand.',
    'Keep a farm log with dates, amounts and transaction links, and decide the exit in advance: what to sell, what to keep, and the price or date that triggers each.',
  ];
}

// ---------------------------------------------------------------- board

export interface BoardBuild {
  rows: BoardRow[];
  liveRows: LiveRow[];
  multiples: CategoryMultiple[];
  globalMedian: number;
  liveCount: number;
  watchlistCount: number;
  belowFloorCount: number;
  excludedAboveFloor: number;
  asOf: string;
  floorUsd: number;
}

export function buildBoard(snapshot: Snapshot): BoardBuild {
  const asOf = new Date(`${snapshot.as_of}T00:00:00Z`);
  const multiples = computeMultiples(snapshot.protocols);
  const watchSet = new Set(snapshot.watchlist);

  const scored: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    const onWatchlist = watchSet.has(p.slug);
    const belowFloor = isRankable(p) && p.tvl_usd < snapshot.floor_usd;
    if (!onWatchlist && !belowFloor) continue;

    const age = ageDaysOf(p, asOf);
    const m = multipleFor(p.category, multiples);
    const growthMult = 1 + (clamp(p.change_7d ?? 0, -60, 120) / 100) * 0.5;
    const maturityMult = 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
    const breadthMult = 1 + Math.min((p.chains?.length ?? 1) - 1, 4) * 0.03;
    const implied = Math.round(p.tvl_usd * m.multiple * growthMult * maturityMult * breadthMult);

    scored.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains ?? [],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      listed_at: p.listed_at,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmStepsFor(p, age),
      model: {
        tvl_usd: p.tvl_usd,
        catMultiple: m.multiple,
        growthMult,
        maturityMult,
        breadthMult,
        ageDays: age,
        compN: m.n,
        compMedian: m.median,
        multipleSource: m.source,
        multipleCategory: m.usedCategory,
      },
    });
  }

  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  const liveRows: LiveRow[] = snapshot.protocols
    .filter(isLiveComp)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains ?? [],
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      mcap_tvl: p.mcap_usd! / p.tvl_usd,
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 24);

  const multiplesTable: CategoryMultiple[] = [...multiples.direct.entries()]
    .map(([category, d]) => ({ category, n: d.n, median: d.median, source: 'direct' as const }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));

  const belowFloorCount = snapshot.protocols.filter((p) => isRankable(p) && p.tvl_usd < snapshot.floor_usd).length;
  const excludedAboveFloor = snapshot.protocols.filter(
    (p) => isRankable(p) && p.tvl_usd >= snapshot.floor_usd && !watchSet.has(p.slug),
  ).length;

  return {
    rows: scored,
    liveRows,
    multiples: multiplesTable,
    globalMedian: multiples.globalMedian,
    liveCount: multiples.liveCount,
    watchlistCount: watchSet.size,
    belowFloorCount,
    excludedAboveFloor,
    asOf: snapshot.as_of,
    floorUsd: snapshot.floor_usd,
  };
}

/** Recompute a row's implied value from its stored full-precision model. */
export function recomputeImplied(row: BoardRow): number {
  const m = row.model;
  return Math.round(m.tvl_usd * m.catMultiple * m.growthMult * m.maturityMult * m.breadthMult);
}
