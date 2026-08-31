# 2. Technical architecture

Scope: the contract set, what each one may and may not do, and the specific
design choices that make the blueprint's invariants enforceable rather than
aspirational. No production Solidity is written yet — this document is the thing
to argue with before that happens.

## 2.1 Contract map

```
                         ┌──────────────┐
                         │  Token.sol   │  immutable ERC-20, 21,000,000 * 1e8
                         │  no mint     │  minted once in the constructor
                         │  no burn     │  no owner, no upgrade path
                         └──────┬───────┘
                                │ genesis supply
                                ▼
                       ┌────────────────────┐
                       │ Distributor.sol    │  the public launch mechanism
                       │ (§2.6, undecided)  │  holds 100% of supply at t=0
                       └────────┬───────────┘
                                │ seeds the pool + distributes
                                ▼
   fee-paying activity ──▶ ┌──────────────┐
                           │ FeeRouter.sol│  splits ETH by immutable ratio
                           └──┬────────┬──┘
                    buyback % │        │ liquidity %
                              ▼        ▼
                    ┌──────────────┐  ┌─────────────────┐
                    │ Buyback.sol  │  │ LiquiditySink   │
                    │ ETH -> TOKEN │  │ (§2.5)          │
                    └──────┬───────┘  └─────────────────┘
                           │ TOKEN
                           ▼
                    ┌──────────────────┐        ┌──────────────────────┐
                    │ RewardVault.sol  │───────▶│ LPRewardController   │
                    │ holds TOKEN      │  drip  │ staked LP accounting │
                    │ never mints/burns│        │ continuous, linear   │
                    └──────────────────┘        └──────────────────────┘
                                                          ▲
                                                          │ stake LP tokens
                                                    liquidity providers
```

`RewardVault` and `LPRewardController` can and probably should be **one
contract**. Splitting them adds an external call and a trust boundary between
two contracts that are deployed together, immutable, and useless apart. The
blueprint lists them separately; I'd merge them unless there's a reason to keep
the vault's balance readable by something else. Flagged in `05-open-decisions.md`.

## 2.2 Token.sol — making the invariant structural

The blueprint asks for `totalSupply() == 21_000_000e8` to be *mathematically
impossible* to change. Concretely:

```solidity
contract Token is ERC20 {
    uint256 public constant MAX_SUPPLY = 21_000_000 * 10 ** 8;

    constructor(address recipient) ERC20("<name>", "<symbol>") {
        _mint(recipient, MAX_SUPPLY);
    }

    function decimals() public pure override returns (uint8) { return 8; }
}
```

The properties that matter, and why each holds:

| Requirement | How it is enforced |
|---|---|
| No mint after genesis | `_mint` is `internal` in OZ ERC20 and called exactly once, in the constructor. No external path reaches it. |
| No burn, ever | Do **not** inherit `ERC20Burnable`. OZ's `_burn` is `internal` and never called. |
| No owner | Do not inherit `Ownable`/`AccessControl` at all — not "renounce later". |
| No upgrade | Deploy directly. No proxy, no `delegatecall`, no `selfdestruct`. |
| No rebase / elastic supply | Plain `ERC20`, no balance-scaling override. |

Two things to be precise about, because both get miscommunicated constantly:

- **Transfers to `0x0` are blocked** by OZ 5.x (`ERC20InvalidReceiver`). A user
  *can* still send to `0x…dead`, which is a normal address — those tokens are
  unreachable but `totalSupply()` is unchanged. That is consistent with the
  invariant: supply is 21,000,000 forever, some of it may become unspendable by
  user error. The dashboard must count `0xdead` as a holder, not subtract it.
- **Locked LP tokens are not burned TOKEN.** Blueprint §12 is right to insist on
  this. If we lock LP, the underlying TOKEN is still in the pool and still part
  of the 21M. The dashboard's accounting identity (§2.7) makes this visible.

Decimals of 8 is a deliberate Bitcoin echo and it is fine, but note the friction:
almost every EVM tool, aggregator and frontend assumes 18. Nothing breaks, but
integer maths in the reward accumulator needs a larger precision multiplier than
usual to avoid truncation (see §2.4).

## 2.3 FeeRouter.sol — immutable split

```solidity
contract FeeRouter {
    uint256 public immutable buybackBps;   // set at construction, e.g. 6000
    address public immutable buyback;
    address public immutable liquiditySink;

    receive() external payable {}

    function distribute() external { /* permissionless, splits balance */ }
}
```

Design notes:

- **Configurable in tests, immutable in production.** The blueprint wants the
  0.20% fee and the 60/40 split tunable during development but frozen at
  deployment. Constructor `immutable`s give exactly that: the test suite
  parameterises freely, and the deployed bytecode has no setter. There is no
  admin function to remove later.
- `distribute()` must be **permissionless and idempotent** — anyone can call it,
  calling it twice in a block is harmless, and it must not revert on a zero
  balance (a reverting no-op invites griefing of any keeper that batches it).
- **Push vs. pull.** `FeeRouter` should *not* call into `Buyback` synchronously
  on receipt of ETH. A `receive()` that does work makes every fee-paying user
  transaction pay for it and creates a reentrancy surface into the DEX. Accrue,
  then let a separate permissionless call move funds.
- No `sweep()`, no `rescueToken()`, no owner. Any "recover stuck tokens" helper
  is an admin lever with a friendly name and must not exist in production.

## 2.4 Buyback and the reward accumulator

### The buyback mechanism — two candidates

**Candidate 1: market buy via Uniswap router.** `Buyback` swaps its ETH for
TOKEN through the v2/v3 router with a `minAmountOut` derived from an on-chain
TWAP. Simple, familiar, and it is the blueprint's stated model.

Its problem on this chain specifically: the slippage bound has to come from an
oracle, the only available oracle is the pool we are about to trade against, and
**the sequencer is centralised** (§1.2). An operator that can order transactions
can move the pool, let our buyback execute at the bound, and move it back. A
long TWAP window raises the cost of that attack but never eliminates it, and it
also makes the bound stale during genuine volatility.

**Candidate 2: a reverse Dutch auction.** `Buyback` holds ETH and continuously
offers it for TOKEN at a price that decays from "clearly too expensive" toward
"clearly cheap." Anyone may fill, in whole or part. Whoever fills sources the
TOKEN however they like — Uniswap, their own inventory, anywhere.

```
    ETH offered ──▶ [ auction: price decays over time ] ──▶ filler supplies TOKEN
                                                                    │
                                                                    ▼
                                                              RewardVault
```

Why I prefer this:

- **No oracle.** The clearing price is discovered by competition, not read from
  a manipulable source. Nothing to manipulate.
- **No DEX dependency.** No router address to hard-code, no pool to be drained,
  no failure mode when a router is deprecated or a pool migrates from v3 to v4.
  The blueprint's §18 "DEX failure testing" mostly evaporates.
- **Ordering-independent.** A sequencer that delays the auction only lets the
  price decay further, which is *worse* for the sequencer and better for us.
- **Cheaper to make immutable**, because it has no external integration whose
  address could go stale over the protocol's whole life.

Its cost: it needs an active arbitrageur to fill, so at very low revenue the
auction may sit unfilled until the decay makes it worth someone's gas. That is a
soft failure (delay), not a hard one (loss).

I'd build candidate 2 and keep candidate 1 as a comparison in the test suite.
This is the single biggest architecture decision — `05-open-decisions.md` §2.

### The reward accumulator

Use the **Synthetix `StakingRewards` accumulator pattern**, which is the
best-audited implementation of exactly what blueprint §8/§9 describe:

```
rewardPerTokenStored += rewardRate * dt * PRECISION / totalStaked
earned(u) = staked[u] * (rewardPerToken - userPaid[u]) / PRECISION + rewards[u]
```

This is *continuous* `liquidity × time` accounting, O(1) per user, with no
epochs and no snapshots. It gives the blueprint several of its §10 requirements
for free, structurally rather than by patch:

- Depositing right before a snapshot — **no snapshots exist**; a deposit earns
  from the second it lands.
- Withdrawing right after — you stop earning the second you leave.
- Flash liquidity — a position held for one block earns one block's share of the
  rate, which is dust. Nothing to cap, nothing to cooldown.
- Repeated deposit/withdraw cycling — strictly worse than staying staked, since
  every second out of the pool earns zero.

So `minimum LP duration`, `withdrawal cooldown` and `reward vesting` from the
blueprint's list are **not needed** and should not be added: each one is a
parameter that has to be justified, tested and defended, and each one worsens
the LP experience to solve a problem continuous accounting already solved.

`PRECISION` should be `1e30`, not the customary `1e18`, because the staked
denominator is LP tokens (18 decimals) and the numerator is TOKEN (8 decimals);
the standard multiplier truncates small accruals to zero.

### Feeding the accumulator without an operator

Synthetix's `notifyRewardAmount` is permissioned, and making it permissionless
naively creates a known griefing vector: anyone can call it with dust to restart
the period and dilute the rate. Instead, **stream continuously**:

```
rewardRate = vaultBalance * λ        (a fixed fraction per second)
```

The vault pays out a constant proportion of whatever it holds. Inflows raise the
rate automatically; no `notify` call exists to grief. The vault asymptotically
approaches empty but never cliffs to zero, so rewards degrade smoothly when
activity stops. §7 of the simulator shows the drawdown for several half-lives; a
**30-day half-life** pays out ~50% of an inflow in the first month and ~79% in
the first quarter, which is responsive without being a faucet.

## 2.5 The liquidity share, and what "LiquiditySink" actually is

The blueprint sends 40% of fees to "protocol liquidity / designated protocol
function" but doesn't say what that contract does. This is under-specified and
it matters, because a contract holding ETH with vague rules is exactly the
"treasury" §3 forbids.

The honest options:

- **(a) Single-sided liquidity add.** The 40% buys TOKEN and pairs it with ETH
  into the pool, with the resulting LP tokens held by an ownerless contract
  forever. Deepens the market permanently. Nobody can withdraw it — including
  us, which is the point.
- **(b) Fold it into the buyback.** Route 100% to LP rewards. Simpler, one fewer
  contract, one fewer thing to audit, and it puts all the revenue where the
  blueprint says the flywheel needs it.
- **(c) Public-goods style burn of the ETH.** Rejected: destroying ETH creates
  no value for anyone and just shrinks the protocol.

I lean (b) for v1 and (a) for v2, because (a) requires a swap-and-add path with
its own slippage and just-in-time-liquidity attack surface, and shipping less
immutable code is the correct bias when the code can never be fixed.

## 2.6 Distribution and launch — the unsolved part

Blueprint §2 mints 100% at genesis; §11 forbids a hidden team allocation and
requires public bootstrapping. Those are compatible only if the genesis
recipient is a **contract with public rules**, not a wallet. So `Token`'s
constructor mints to `Distributor`, and `Distributor`'s rules *are* the launch.

The mechanisms worth evaluating, with their real tradeoffs:

| Mechanism | How liquidity forms | Main risk |
|---|---|---|
| **LBP / descending-price auction** | Participants send ETH over a window at a decaying price; proceeds + unsold TOKEN seed the pool | Complex; needs a price curve nobody can game; low participation leaves a thin pool |
| **Fixed-price open sale, hard cap** | Anyone sends ETH at a fixed rate until cap; all proceeds auto-seed the pool | Gas auction at open; sequencer sees the queue first |
| **Liquidity bootstrapping via pro-rata claim** | Contributors get pro-rata TOKEN *and* the pool is seeded from the same pot | Fairest, but a whale can still take most of it — permissionlessness has no answer to capital |
| **Uniswap v4 launchpad (`pools.trade`, Pons)** | Use existing, audited infrastructure | Cedes control of the mechanism; must read their terms; may not permit our custom fee routing |

What is **not** acceptable under the blueprint, and I want to be explicit because
it is the most common way projects quietly violate their own rules: a "small"
allocation to a deployer wallet "for initial liquidity." §11 forbids it. If the
creator wants TOKEN, the creator participates in the public mechanism on the
same terms as everyone else, from a publicly disclosed address, and the
dashboard shows that address.

Unresolved: **who pays for the initial ETH side of the pool.** A fair launch that
raises ETH solves it. One that airdrops does not, and then the pool has no ETH
and the buyback has nothing to buy against. This constrains the launch choice
more than anything else and needs a decision — `05-open-decisions.md` §4.

## 2.7 Supply accounting for the dashboard

The identity the frontend must display and continuously check:

```
totalSupply (21,000,000.00000000, constant)
  = Σ user-held
  + pool-held (TOKEN reserve of the TOKEN/ETH pool)
  + RewardVault balance (bought back, not yet claimed)
  + LiquiditySink-held
  + Distributor balance (undistributed, → 0 after launch)
  + unreachable (0xdead and friends, counted, never subtracted)
```

Computed purely from `balanceOf` reads plus one `totalSupply()` read, with the
residual displayed. If the residual is ever non-zero, either the frontend is
wrong or something is very wrong; either way the user should see it rather than
have it silently netted out. The dashboard should render this as a single stacked
bar whose total never changes — that is the clearest possible expression of the
project's core claim.

## 2.8 Frontend architecture

Static app, no backend, no database, no indexer dependency for anything on the
critical path. Reads go straight to an RPC via viem; writes are wallet-signed
calls to the contracts. Built output pins to IPFS/Arweave.

Two practical constraints the blueprint's §15 diagram glosses over:

- **Historical data** (every buyback, with tx hash, price, and destination) is
  not readable from contract state. It comes from event logs. `eth_getLogs` over
  a long range against a public RPC is slow and often rate-limited. Either the
  contracts emit rich enough events and the frontend paginates lazily, or we run
  an optional indexer that is a *convenience*, never a dependency — the page must
  render correct live state with the indexer down.
- **RPC is a single point of failure** even for a static site. Ship a
  user-editable RPC field defaulting to a list of the endpoints in §1.1, so the
  site keeps working if one provider drops the chain.

The "if the website disappears" test should be an actual documented procedure:
contract addresses, ABIs and a `cast`/`viem` snippet for stake, claim and unstake,
published in the repo and mirrored in the deployed contracts' verified source.
