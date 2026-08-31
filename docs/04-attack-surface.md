# 4. Attack surface

Ordered by how much of the design each one threatens, not by exploit glamour.
Items marked **structural** are eliminated by a design choice rather than
mitigated by a parameter — always prefer those.

## 4.1 Reward farming

| Attack | Status |
|---|---|
| Deposit immediately before an epoch snapshot | **Structural** — continuous accounting has no snapshot to front-run. |
| Withdraw immediately after a snapshot | **Structural** — earning stops the second liquidity leaves. |
| Flash-loaned liquidity | **Structural** — a one-block position earns one block's share of the rate. Dust. |
| Repeated deposit/withdraw cycling | **Structural** — strictly worse than staying staked; every second unstaked earns zero. |
| Sybil splitting across wallets | **Structural, given linear weighting** — see `03-economics.md` §3.6. Adding sqrt/caps *creates* this attack rather than preventing it. |
| Wash trading to inflate fee revenue | Partially mitigated. A wash trader pays the full protocol fee plus LP fee plus gas to recycle 60% of their own fee back to themselves as an LP — strictly loss-making. Model the exact break-even before launch. |
| Just-in-time liquidity around a large swap | Not applicable to a staked, full-range v2-style pool. **Becomes applicable** if we reward v3/v4 concentrated positions — see §4.2. |

The blueprint's §10 candidate mitigations — minimum LP duration, withdrawal
cooldown, reward vesting — are **not needed** once accounting is continuous, and
should be rejected. Each is a parameter requiring justification and testing, each
degrades the LP experience, and each solves a problem that no longer exists. Ship
fewer knobs.

## 4.2 Concentrated-liquidity gaming — the reason to use a v2-style pool

If rewards are paid on Uniswap **v3/v4** positions, "liquidity contribution"
stops being a scalar and becomes gameable in a way that is genuinely hard to fix
on-chain:

- A position in an ultra-narrow range **away from spot** carries an enormous
  `liquidity` value for very little capital, provides no usable depth to any
  trader, and takes no inventory risk. Pure reward extraction.
- A narrow range **at spot** earns rewards while being adversely selected on
  every tick move — the LP hedges elsewhere and farms the difference.
- Ranges can be shifted every block, so any "in-range" check is a per-block race.

This is why real v3 incentive programs lean on off-chain computation (Merkl et
al.) or Uniswap's own staker with tight range constraints. Both add either a
trusted computation or a large pile of parameters, and both fight the blueprint's
"no operator, immutable rules" requirement.

**Recommendation: reward a v2-style full-range pool**, whose LP token is a
fungible ERC-20 with a single scalar meaning. Uniswap v2 is deployed on
Robinhood Chain (§1.3), it sees minimal volume there, which is irrelevant to us
since we would be creating our own pool. The cost is capital inefficiency; the
benefit is that the reward accounting becomes provably simple and the entire
class of attacks above disappears. For an immutable contract that can never be
patched, that trade is correct.

## 4.3 Buyback manipulation

Applies to the **market-buy** design (`02-architecture.md` §2.4, candidate 1):

- **Sandwiching.** Buybacks are predictable in size and timing. An attacker
  moves the pool up, lets us buy at our slippage bound, and sells back. Every
  dollar of our slippage tolerance is their profit margin.
- **Oracle manipulation.** The slippage bound derives from a TWAP of the pool we
  are trading against. Longer window ⇒ costlier to manipulate but staler during
  real volatility.
- **Sequencer-level MEV.** Robinhood operates a centralised sequencer with
  ordering priority (§1.2). Multi-block TWAP manipulation is materially cheaper
  for whoever orders the blocks. This is not hypothetical on this chain.
- **Griefing the trigger.** If anyone can call `buyback()`, an attacker calls it
  at the worst moment, repeatedly, in dust amounts.

Mitigations if we keep the market buy: TWAP-bounded `minAmountOut`, a cap on
buyback size as a fraction of pool reserves, a minimum interval between
executions, a minimum executable size, and a keeper reward calibrated so honest
callers outbid grief callers.

**Or eliminate the class:** the reverse Dutch auction (candidate 2) has no
oracle to manipulate, no pool to sandwich, and gains nothing from ordering
control — a sequencer that delays it only lets the price decay further in the
protocol's favour. This is the strongest argument for candidate 2 and the reason
I'd default to it.

## 4.4 Contract-level

Standard, but each must have a named test in Phase 7:

- **Reentrancy** on claim/stake/unstake and on any ETH-receiving path. Use CEI
  plus a reentrancy guard; assume any external token or router is hostile.
- **Rounding and truncation.** 8-decimal TOKEN against 18-decimal LP tokens is
  the specific hazard: the accumulator's precision multiplier must be `1e30` or
  dust accruals silently truncate to zero and are lost. Test with 1-wei stakes
  and 1-second intervals.
- **Reward-vs-principal confusion.** If `RewardVault` ever holds TOKEN that is
  both stake and reward, an accounting bug lets one be claimed as the other.
  Keep the staked asset (LP token) and the reward asset (TOKEN) in distinct
  balances and assert `rewardBalance ≤ token.balanceOf(vault)` as an invariant.
- **First-depositor / empty-pool division.** `totalStaked == 0` must not divide
  by zero and must not let the first staker claim the entire accrued pot.
- **Fee-on-transfer / rebasing tokens** in any path that assumes
  `balanceAfter - balanceBefore == amount`. Our TOKEN is neither, but the LP
  token and any routed asset should be checked, not assumed.
- **Force-fed ETH.** `selfdestruct` and coinbase payments can push ETH into
  `FeeRouter` outside `receive()`. Never let logic depend on `address(this).balance`
  matching an internal accumulator.
- **Unbounded loops.** No iteration over holders or stakers anywhere; the
  accumulator pattern exists precisely to avoid it.

## 4.5 Launch-phase

- **Sniping the initial pool.** The first block after liquidity is added is a
  free option for whoever the sequencer serves first. Standard mitigations
  (gradual price discovery, an auction rather than a fixed-price pool seed) sit
  with the launch-mechanism decision in `02-architecture.md` §2.6.
- **Gas auction at sale open.** A fixed-price sale with a hard cap creates a
  race the sequencer operator sees before anyone else. Prefer a mechanism where
  being early is not mechanically profitable.
- **Whale capture of a fair launch.** No permissionless mechanism prevents
  capital from taking most of a sale. Do not claim otherwise; publish the
  resulting distribution on the dashboard and let people judge it.

## 4.6 Chain-level, and the limits of the claim

Not fixable by us, and therefore something to state rather than mitigate:

- A **7-of-8 multisig can pause Robinhood Chain.** Our protocol stops when the
  chain stops. Immutability at the contract layer does not survive that.
- **System contracts are upgradeable with no delay and no exit window.**
- **Only two allowlisted actors can challenge state updates.**
- The **sequencer is centralised** and can reorder or delay.

The blueprint's philosophy line — *the creator writes the rules, the blockchain
enforces them, nobody controls the money afterward* — is accurate about the
creator's power and inaccurate about the chain's. The claim that survives
scrutiny is: **the creator retains no privileged control over the protocol.**
Say that; do not say "unstoppable."

## 4.7 Regulatory — flagged once, factually

A token marketed on the basis that protocol revenue is automatically used to buy
it and distribute it to people who supply capital has the shape US regulators
examine under *Howey*: money invested, common enterprise, expectation of profit
from the efforts of others. The "no operator after deployment" design genuinely
weakens the fourth prong, and blueprint §21's refusal to promise returns is the
right instinct. Robinhood Chain is a US-operated chain, and the dashboard, the
launch mechanism, and every piece of marketing copy are the artefacts that would
be read.

This is not a reason not to build it, and it is your call, not mine. It is a
reason to get a lawyer's read on the launch mechanism and the marketing before
Phase 14, not after — and a reason to keep §21 enforced with real discipline in
copy, including on the dashboard's APR display.

## 4.8 Test matrix for Phase 7

Invariants that must hold under every operation, ideally as stateful fuzz
handlers:

```
token.totalSupply() == 21_000_000e8                       # always, no exceptions
Σ balanceOf(all touched addresses) == totalSupply()       # nothing unaccounted
cumulative minted after genesis == 0
cumulative burned == 0
vault.rewardBalance <= token.balanceOf(vault)             # can't owe what it lacks
Σ earned(users) <= rewardsDistributed                     # no over-issuance
staked[u] round-trips: stake(x); unstake(x) returns x     # no principal leak
no path transfers TOKEN to a deployer/EOA                 # no founder drain
```

Plus targeted cases: reentrant claim, 1-wei stake, 1-second accrual, zero-TVL
drip, buyback with an empty pool, buyback at maximum slippage, router reverting,
force-fed ETH, and a stake/unstake in the same block.
