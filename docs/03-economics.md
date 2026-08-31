# 3. Economic model

Run `python3 sim/model.py` to reproduce every number here. The model is
deliberately built to find the conditions under which the design fails, not to
produce an attractive brochure. Parameters used throughout: 0.20% protocol fee,
60/40 buyback/liquidity split — both provisional, per blueprint §4 and §5.

## 3.1 The governing identity

Everything reduces to one line:

```
LP reward APR = buyback_share × fee_rate × fee_generating_volume / TVL
```

The **token price cancels out**. A higher price means the buyback's dollars buy
fewer TOKEN, and those fewer TOKEN are worth proportionally more; the dollar
value delivered to LPs is unchanged. This is worth internalising because it
kills a whole class of reasoning: "the price goes up, so rewards get better, so
more LPs come, so the price goes up" is not a mechanism this design contains.
Reward value is a function of **volume and TVL only**.

## 3.2 Revenue at the blueprint's four activity levels

| Daily volume | Annual revenue | Buyback/yr | Buyback/day | TOKEN/yr @ $1 | % of supply/yr |
|---|---|---|---|---|---|
| $10k | $7.3k | $4.4k | $12 | 4,380 | 0.02% |
| $100k | $73.0k | $43.8k | $120 | 43,800 | 0.21% |
| $1M | $730.0k | $438.0k | $1.2k | 438,000 | 2.09% |
| $10M | $7.30M | $4.38M | $12.0k | 4,380,000 | 20.86% |

Calibration: Uniswap's **entire** Robinhood Chain volume hit an all-time high
near $130M/day in August 2026. The $10M/day row is ~8% of all trading on the
chain flowing through one new protocol. Treat it as a ceiling scenario, not a
base case. The realistic planning range for a successful launch is the
$100k–$1M/day band.

## 3.3 LP reward APR

| Daily volume | TVL $250k | TVL $1M | TVL $5M | TVL $20M |
|---|---|---|---|---|
| $10k | 1.75% | 0.44% | 0.09% | 0.02% |
| $100k | 17.52% | 4.38% | 0.88% | 0.22% |
| $1M | 175.20% | 43.80% | 8.76% | 2.19% |
| $10M | 1752.00% | 438.00% | 87.60% | 21.90% |

Per-position, at $1M TVL:

| Daily volume | per $1k LP | per $10k LP | per $100k LP |
|---|---|---|---|
| $10k | $4.38 | $43.80 | $438 |
| $100k | $43.80 | $438 | $4.4k |
| $1M | $438 | $4.4k | $43.8k |
| $10M | $4.4k | $43.8k | $438k |

The bottom-left corner is where the design dies quietly: at $10k/day a $1k LP
earns $4.38 a year. L2 gas is cheap but not zero, and a reward smaller than the
cost of claiming it is a decorative feature. **The program needs roughly
$100k/day of fee-generating volume to be worth a user's attention at all.**

Note also that this APR competes against a hard floor: a passive LP on Uniswap
earns the pool's own fees with no protocol involvement. Beating that is the bar.

## 3.4 The finding that should change the design

Suppose — as blueprint §4 and §11 read most naturally — the protocol's
fee-generating activity **is trading of TOKEN itself**. Then fee volume equals
pool volume, and the reward an LP receives relative to the fees that same LP
already earns from those same swaps is:

```
reward APR / native LP APR = buyback_share × fee_rate / lp_fee_rate
                           = 0.60 × 0.0020 / 0.0030
                           = 0.40×
```

**The reward is 40% of what LPs already earn from the pool's own fees.** And it
is funded by charging those same swaps an extra 0.20%, which widens the
effective spread and pushes volume toward the cheaper Uniswap route. Round-trip:
we tax traders, keep 60% of the tax, hand it to the LPs who serve those traders,
and lose volume to a competitor for the privilege. No value enters the system
from outside. This is precisely the circular structure blueprint §20 rules out —
and §20 is right to rule it out.

The break-even is straightforward. Let *m* be the ratio of external (non-TOKEN)
fee-generating volume to TOKEN pool volume:

| external volume | reward vs. native LP fees |
|---|---|
| 1× | 0.40× |
| 5× | 2.00× |
| 10× | 4.00× |
| 50× | 20.00× |
| 100× | 40.00× |

**The protocol needs fee revenue from activity roughly 3× larger than its own
token's trading volume just to break even against doing nothing**, and ~10× to
be compelling. That is the real design requirement hiding inside blueprint §4,
and it is not a tuning problem — no choice of fee rate or split fixes it, because
both sides of the ratio scale together. It is answered by choosing a different
fee source, which is `05-open-decisions.md` §1.

## 3.5 Buybacks and price: what can and cannot be claimed

Buybacks buy TOKEN with external ETH. Reward recipients who sell push the same
TOKEN back into the same pool. At $1M/day volume:

| LP sell rate | net annual buy pressure |
|---|---|
| 0% | $438.0k |
| 25% | $328.5k |
| 50% | $219.0k |
| 75% | $109.5k |
| 100% | $0 |

At a 100% sell rate the buyback is **exactly cancelled** and the mechanism is a
pure transfer from traders to LPs with zero net price effect. Since the reward
asset and the staked asset are the same token, and rational LPs harvest, the
realistic sell rate is high.

This does not make the design bad — transferring fee revenue to liquidity
providers is a legitimate and useful thing to do. It makes one specific *claim*
about the design false. "Buybacks support the price" is only true to the extent
recipients hold, which the protocol cannot enforce and, per blueprint §21, must
never promise. The defensible claim is: **fee revenue is converted to TOKEN and
delivered to liquidity providers, automatically and verifiably.**

## 3.6 Reward weighting: linear wins, and not for the usual reason

Blueprint §8 asks us to compare linear, sqrt, and capped weighting because "pure
linear weighting may allow extremely large holders to dominate." Simulating a
cohort of one $500k LP and one hundred $5k LPs ($1M TVL):

| Model | whale share, honest | whale share, split across 100 wallets |
|---|---|---|
| A: `L × t` | 50.0% | **50.0%** |
| B: `√L × t` | 9.1% | **50.0%** |
| C: `min(L, $50k) × t` | 9.1% | **50.0%** |

Models B and C look like they suppress whales. They don't. They suppress
*honest* whales. Wallets are free and permissionless, so a whale splits into 100
addresses and recovers the full 50% share, while the small LPs the cap was meant
to protect have been diluted in the meantime by everyone else's splitting too.
Concavity in a reward function is only meaningful when the input is a scarce
identity, and a permissionless protocol has no scarce identity to bind to.

**Model A is the only Sybil-invariant option of the three** — splitting a
position changes nothing, because the function is linear. Adopt Model A. Do not
add sqrt or caps: they cost complexity, they cost gas, they cost audit surface,
and they deliver the opposite of their stated purpose. If limiting whale
dominance is a genuine goal, the honest tools are proof-of-personhood (out of
scope, and a trust dependency) or accepting it.

This conveniently coincides with the best-tested implementation available: the
Synthetix accumulator is exactly `L × t` in O(1). See `02-architecture.md` §2.4.

## 3.7 Sustainability

With the continuous exponential drip described in `02-architecture.md` §2.4, the
vault pays a fixed fraction of its balance per second:

| Drip half-life | paid within 30d | remaining after 1y (no inflows) |
|---|---|---|
| 7 days | 94.9% | ~0% |
| 30 days | 50.0% | ~0% |
| 90 days | 20.6% | 6.0% |
| 365 days | 5.5% | 50.0% |

A 30-day half-life is responsive without being a faucet, and the reward rate
decays smoothly to near-zero when revenue stops rather than cliff-edging. There
is no epoch, no snapshot, and no operator call anywhere in this — which is the
blueprint's §12 requirement met structurally.

## 3.8 What the model does not cover

Stated plainly so nobody mistakes the above for completeness:

- **Impermanent loss is not modelled.** For a volatile new token, IL routinely
  exceeds fee income. A 20% APR that comes with a 40% IL drawdown is a loss. Any
  APR figure shown on the dashboard without this caveat is misleading.
- **Volume is exogenous here.** The model takes volume as an input; the whole
  question of whether the flywheel generates volume is assumed away, and that is
  exactly the question §3.4 says is unresolved.
- **No price path, no reflexivity, no adversarial agents.** Phase 10 needs an
  agent-based version with informed traders and arbitrageurs before mainnet.
- **Gas and MEV costs are ignored**, including what an auction filler or keeper
  must be paid to keep the buyback running at low revenue.
