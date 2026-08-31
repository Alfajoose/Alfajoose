# 5. Open decisions

Each item blocks a later phase. My recommendation is given for every one; where
I think the blueprint's stated position is wrong, I say so and why. Nothing here
is implemented yet.

---

## D1. What activity generates the fees? — **blocks everything**

**The blueprint says** (§4): "a trading/liquidity protocol. Users interact with
the protocol and generate fees," at 0.20%.

**The problem.** Uniswap v2, v3, v4 and UniswapX have been live on Robinhood
Chain since day one, they are the primary public AMM, and they charge no
protocol fee on top of the LP fee. A new venue charging 0.20% more for the same
swap loses every price comparison and every aggregator route. Meanwhile, if the
fee-generating activity is trading of TOKEN itself, `03-economics.md` §3.4 shows
the reward LPs receive is **0.40× the fees they already earn from those same
swaps** — funded by taxing those same swaps. That is the circular system
blueprint §20 explicitly forbids, and no fee rate or split fixes it, because both
sides of the ratio scale together. The protocol needs external fee volume of
roughly **3× its own token's volume to break even** and ~10× to be compelling.

**Options:**

- **(a) Yield/LP management vault.** Charge a performance fee (say 10%) on yield
  harvested from Uniswap positions the vault manages on users' behalf. Revenue
  is a cut of *real* Uniswap LP fees earned on stock-token and WETH/USDG pairs —
  genuinely external, genuinely useful (v3 range management is hard and most
  people do it badly), and it competes on service rather than on price.
- **(b) Swap aggregator with a fee.** Route across v2/v3/v4 and take a cut.
  Honest, but Splitshot and LiquidSwap already do this on the chain, and 0.20% is
  high — aggregators typically take 0–0.15%. Thin margins, real competition.
- **(c) Accept the circularity.** Fee only on TOKEN trades. Simplest to build,
  and many live protocols are exactly this. But then §20 must be struck from the
  blueprint, and the marketing must not describe it as a flywheel — it is a
  redistribution from traders to liquidity providers, which is a real thing but
  not a value-creating one.
- **(d) Something else you have in mind that I don't know about.** If there is a
  specific product idea behind "trading/liquidity protocol," it changes this
  entire analysis and I'd rather hear it than guess.

**My recommendation: (a).** It is the only option that satisfies §20 as written,
it doesn't require beating Uniswap on price, and its revenue scales with the
chain's real activity rather than with speculation on our own token. It is also
the most work.

**If you pick (c), that's a legitimate call** — but I'd want us to change the
project's own documentation to describe it accurately rather than ship a
flywheel diagram the mechanism doesn't implement.

---

## D2. Buyback mechanism: reverse Dutch auction, or market buy?

**The blueprint says** (§6): swap through a supported DEX with slippage
protection.

**The problem.** A market buy needs a slippage bound, the only oracle is the pool
we're about to trade against, and the sequencer is centralised and run by
Robinhood (§1.2). Every dollar of slippage tolerance is an attacker's margin,
and a party with ordering priority is well placed to collect it.

**Options:**
- **(a) Reverse Dutch auction.** The contract offers ETH for TOKEN at a decaying
  price; anyone fills. No oracle, no DEX dependency, no address to go stale over
  the protocol's lifetime, and delay by a sequencer only improves our price.
  Cost: at low revenue an auction may sit unfilled until it's worth someone's
  gas — a delay, not a loss.
- **(b) Router market buy** with TWAP-bounded `minAmountOut`, size caps, minimum
  interval, keeper reward. Familiar, matches the blueprint, more moving parts and
  a permanent hard-coded router dependency in immutable code.

**My recommendation: (a)**, with (b) built in the test suite as a comparison so
we can measure realised execution quality on testnet before committing.

---

## D3. Which pool type do we reward — v2-style full-range, or v3/v4?

**The problem.** Concentrated liquidity has no honest scalar for "contribution."
A narrow range away from spot yields huge `liquidity` for little capital, offers
no usable depth, and takes no inventory risk. Ranges move every block, so any
in-range check is a per-block race. Real v3 incentive programs solve this with
off-chain computation or a large pile of parameters — both fight "immutable, no
operator."

**Options:**
- **(a) v2-style full-range pool, fungible LP token, staked.** One scalar, one
  meaning. The entire gaming class in `04-attack-surface.md` §4.2 disappears.
  Cost: capital inefficiency vs. concentrated liquidity.
- **(b) v4 pool with a custom hook** doing the accounting in-protocol. Most
  elegant if it works, most novel code, most audit surface, and hooks are the
  newest and least battle-tested surface in the ecosystem.

**My recommendation: (a) for v1.** For contracts that can never be patched,
provable simplicity beats capital efficiency. Revisit v4 in a second, separately
audited deployment.

---

## D4. Launch mechanism — and who funds the ETH side of the pool?

**The constraint.** §2 mints 100% of supply at genesis; §11 forbids any hidden
team allocation. Both hold only if the genesis recipient is a **contract with
public rules**, not a wallet. So the launch mechanism *is* the distribution.

**The unresolved part is the ETH.** A pool needs both sides. A pure airdrop
distributes TOKEN and leaves the pool with no ETH, so the buyback has nothing to
buy against and the whole engine is inert. Whatever we choose has to raise ETH
publicly, or the design doesn't start.

**Options:** descending-price auction (LBP); fixed-price open sale with a hard
cap; pro-rata contribution with proceeds auto-seeding the pool; or using an
existing launchpad (`pools.trade`, Pons) and accepting its rules.

**My recommendation: pro-rata contribution auto-seeding the pool.** Everyone gets
the same price, there is no gas race to win, the ETH raised becomes the pool's
ETH side atomically, and nobody — including us — touches the proceeds. It does
not prevent a whale from taking a large share; nothing permissionless does, and
we should publish the resulting distribution rather than claim otherwise.

**Non-negotiable either way:** no deployer allocation "for initial liquidity."
If you want TOKEN, participate in the public mechanism on the same terms from a
publicly disclosed address, and let the dashboard show it.

---

## D5. Does the 40% "protocol liquidity" allocation exist in v1?

**The blueprint says** (§5): 60% buyback / 40% protocol liquidity, both
provisional.

"Protocol liquidity" is under-specified, and a contract holding ETH with vague
rules is the treasury §3 forbids, wearing a different hat. Either it does
something precise — buy TOKEN, pair with ETH, add to the pool, hold the LP tokens
in an ownerless contract forever — or it shouldn't exist yet.

**My recommendation: route 100% to the reward vault in v1.** One fewer immutable
contract, one fewer swap-and-add path with its own slippage and JIT-liquidity
surface, and it puts all revenue where §20 says the flywheel needs it. Add the
liquidity sink in v2 once there's a reason.

---

## D6. Final fee rate and split

Not decidable yet: it depends entirely on D1. A performance fee on managed yield
(10–20% of yield) and a swap fee (0.05–0.20% of notional) are different units and
different competitive landscapes. **Set these after D1, from simulation, and
freeze them as constructor immutables at deployment** — configurable in tests,
no setter in the deployed bytecode, per §4.

---

## D7. Merge `RewardVault` and `LPRewardController`?

They're deployed together, immutable, and useless apart. Splitting them adds an
external call and a trust boundary for no benefit I can see. **Recommendation:
one contract**, unless you want the vault balance readable by something external
that I don't know about yet.

---

## D8. Name, symbol, branding

Required by §24 to be fully independent of SATO. Currently unnamed — the repo is
`Alfajoose`, which may or may not be the intended protocol name. Needed before
`Token.sol` is written, since the name and symbol are baked into immutable
bytecode and cannot be changed afterward.

Worth checking before committing: no existing token with the same symbol on
Robinhood Chain or major chains, and a domain and social handle available.

---

## D9. Environment: get Foundry unblocked

`foundry.paradigm.xyz` and `github.com/foundry-rs/foundry/releases` are
egress-blocked in this session, as is `binaries.soliditylang.org`. Hardhat plus
the npm `solc` package works (verified), so we are not blocked from building —
but Foundry's fuzzing and invariant testing are precisely what §18 asks for and
Hardhat has no direct equivalent.

**Recommendation: add those hosts to the environment's egress allowlist before
Phase 7.** Also worth allowlisting: `docs.robinhood.com`, `developers.uniswap.org`,
and the Robinhood Chain RPC endpoints, all of which are currently blocked and all
of which we need to verify the §1.4 addresses.
