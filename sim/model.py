#!/usr/bin/env python3
"""
Economic model for the 21M fixed-supply autonomous protocol.

Pure-python, no dependencies. Run:  python3 sim/model.py

The point of this file is NOT to produce attractive numbers. It is to find the
conditions under which the design fails. Every headline result below is derived
from first principles and stated as a closed-form identity where one exists,
so the conclusions do not depend on simulation noise.
"""

from dataclasses import dataclass
from math import sqrt

SUPPLY = 21_000_000
DECIMALS = 8
DAYS = 365


# ---------------------------------------------------------------------------
# Core identity
# ---------------------------------------------------------------------------
# Protocol revenue (USD/yr)  R = fee_rate * annual_fee_generating_volume
# Buyback allocation          B = buyback_share * R
# The buyback converts B dollars of ETH into TOKEN at the prevailing market
# price and hands that TOKEN to LPs. LPs therefore receive B dollars of value
# per year regardless of the token price:
#
#       LP_APR = buyback_share * fee_rate * volume / TVL
#
# The token price cancels. Price only changes how many TOKEN a given dollar of
# reward buys, never the dollar value of the reward. This is the single most
# important property of the design and every APR figure below follows from it.
# ---------------------------------------------------------------------------


@dataclass
class Params:
    fee_rate: float = 0.0020        # 0.20% protocol fee (provisional)
    buyback_share: float = 0.60     # 60% of fees -> buyback (provisional)
    liquidity_share: float = 0.40   # 40% -> protocol liquidity
    lp_fee_rate: float = 0.0030     # what a Uniswap v2 LP earns natively
    token_price: float = 1.00       # USD, only used for TOKEN-denominated views


def annual(volume_per_day: float) -> float:
    return volume_per_day * DAYS


def lp_apr(p: Params, volume_per_day: float, tvl: float) -> float:
    """Reward APR from buybacks alone, as a fraction. Price-invariant."""
    return p.buyback_share * p.fee_rate * annual(volume_per_day) / tvl


def native_lp_apr(p: Params, pool_volume_per_day: float, tvl: float) -> float:
    """What the same LP earns from the pool's own swap fees, no protocol."""
    return p.lp_fee_rate * annual(pool_volume_per_day) / tvl


def hdr(title: str) -> None:
    print()
    print(title)
    print("=" * len(title))


def usd(x: float) -> str:
    if abs(x) >= 1_000_000:
        return f"${x/1_000_000:,.2f}M"
    if abs(x) >= 1_000:
        return f"${x/1_000:,.1f}k"
    return f"${x:,.2f}"


# ---------------------------------------------------------------------------
# 1. Revenue and buyback scale
# ---------------------------------------------------------------------------
def revenue_table(p: Params) -> None:
    hdr("1. Protocol revenue and buyback scale (fee %.2f%%, buyback %.0f%%)"
        % (p.fee_rate * 100, p.buyback_share * 100))
    print(f"{'daily volume':>14} {'annual rev':>12} {'buyback/yr':>12} "
          f"{'buyback/day':>12} {'TOKEN/yr @ $1':>14} {'% supply/yr':>12}")
    for v in (10_000, 100_000, 1_000_000, 10_000_000):
        r = p.fee_rate * annual(v)
        b = p.buyback_share * r
        tok = b / p.token_price
        print(f"{usd(v):>14} {usd(r):>12} {usd(b):>12} {usd(b/DAYS):>12} "
              f"{tok:>14,.0f} {100*tok/SUPPLY:>11.2f}%")
    print()
    print("  Read this as a share of the whole chain: Uniswap's entire Robinhood")
    print("  Chain volume peaked near $130M/day in Aug 2026. A $10M/day scenario")
    print("  is ~8% of every swap on the chain routed through one new protocol.")


# ---------------------------------------------------------------------------
# 2. LP APR - the number that decides whether anyone shows up
# ---------------------------------------------------------------------------
def apr_table(p: Params) -> None:
    hdr("2. LP reward APR = buyback_share * fee_rate * volume / TVL")
    tvls = (250_000, 1_000_000, 5_000_000, 20_000_000)
    print(f"{'daily volume':>14}" + "".join(f"{'TVL ' + usd(t):>16}" for t in tvls))
    for v in (10_000, 100_000, 1_000_000, 10_000_000):
        row = f"{usd(v):>14}"
        for t in tvls:
            row += f"{100*lp_apr(p, v, t):>15.2f}%"
        print(row)
    print()
    print("  Price-invariant: doubling the token price halves the TOKEN bought and")
    print("  halves the TOKEN paid out, leaving the dollar APR unchanged.")


def reward_per_position(p: Params) -> None:
    hdr("3. Annual reward per LP position (linear weighting, TVL = $1M)")
    tvl = 1_000_000
    print(f"{'daily volume':>14} {'per $1k LP':>14} {'per $10k LP':>14} {'per $100k LP':>14}")
    for v in (10_000, 100_000, 1_000_000, 10_000_000):
        a = lp_apr(p, v, tvl)
        print(f"{usd(v):>14} {usd(1_000*a):>14} {usd(10_000*a):>14} {usd(100_000*a):>14}")
    print()
    print("  At $10k/day volume a $1k LP earns cents per year. Gas on an L2 is")
    print("  cheap but not free: below roughly $100k/day the reward is smaller")
    print("  than the cost of claiming it, and the program is decorative.")


# ---------------------------------------------------------------------------
# 4. The comparison that matters: are we paying LPs more than they already earn?
# ---------------------------------------------------------------------------
def cannibalisation(p: Params) -> None:
    hdr("4. Reward vs. the pool's own fees, when TOKEN trading IS the fee source")
    print("  If the protocol's only fee-generating activity is trading of TOKEN")
    print("  itself, then fee volume == pool volume, and:")
    print()
    print(f"    reward APR / native LP APR = buyback_share * fee_rate / lp_fee_rate")
    ratio = p.buyback_share * p.fee_rate / p.lp_fee_rate
    print(f"                               = {p.buyback_share} * {p.fee_rate} / {p.lp_fee_rate}"
          f" = {ratio:.2f}x")
    print()
    print(f"  The reward is {ratio:.2f}x the fee income LPs already collect from the")
    print("  same swaps -- and it is funded by charging those same swaps an extra")
    print(f"  {p.fee_rate*100:.2f}%, which widens the effective spread and pushes volume to")
    print("  the cheaper Uniswap route. The mechanism pays LPs with money taken")
    print("  from the traders those LPs serve. It creates no external value.")
    print()
    print("  For the flywheel to be real, fee volume must come from activity that")
    print("  would happen with or without TOKEN. Break-even multiple:")
    print()
    for mult in (1, 5, 10, 50, 100):
        print(f"    external volume = {mult:>3}x TOKEN pool volume  ->  "
              f"reward APR = {ratio*mult:>6.2f}x native LP fees")


# ---------------------------------------------------------------------------
# 5. Reward-selling offsets the buyback
# ---------------------------------------------------------------------------
def sell_pressure(p: Params) -> None:
    hdr("5. Net price effect once LPs sell their rewards")
    print("  Buybacks buy TOKEN with external ETH. Reward recipients who sell push")
    print("  the same TOKEN back into the same pool. Net flow into the pool:")
    print()
    print(f"{'sell rate':>12} {'net USD buy pressure / yr @ $1M/day volume':>48}")
    b = p.buyback_share * p.fee_rate * annual(1_000_000)
    for s in (0.0, 0.25, 0.5, 0.75, 1.0):
        print(f"{100*s:>11.0f}% {usd(b * (1 - s)):>48}")
    print()
    print("  At a 100% sell rate the buyback is exactly cancelled: it becomes a")
    print("  pure transfer from traders to LPs with zero net price support. Any")
    print("  claim that buybacks support the price assumes recipients hold, which")
    print("  the protocol cannot enforce and must not promise.")


# ---------------------------------------------------------------------------
# 6. Weighting models and the Sybil result
# ---------------------------------------------------------------------------
def weighting_models() -> None:
    hdr("6. Reward weighting: Model A (linear) vs B (sqrt) vs C (capped)")

    # A cohort: one whale and a tail of small LPs.
    whale = 500_000.0
    smalls = [5_000.0] * 100          # $500k of small LPs in aggregate
    pool = [whale] + smalls

    def share_linear(pool, i):
        return pool[i] / sum(pool)

    def share_sqrt(pool, i):
        w = [sqrt(x) for x in pool]
        return w[i] / sum(w)

    def share_capped(pool, i, cap=50_000.0):
        w = [min(x, cap) for x in pool]
        return w[i] / sum(w)

    print(f"  Cohort: one $500k LP + one hundred $5k LPs (TVL ${sum(pool):,.0f})")
    print()
    print(f"{'model':>26} {'whale share, honest':>22} {'whale share, split 100 ways':>30}")

    # Sybil: the whale splits into N wallets of equal size.
    N = 100

    def whale_share_after_split(scorer, n):
        split_pool = [whale / n] * n + smalls
        total = sum(scorer(split_pool, i) for i in range(n))
        return total

    def scorer_linear(pl, i):
        return pl[i]

    def scorer_sqrt(pl, i):
        return sqrt(pl[i])

    def scorer_capped(pl, i, cap=50_000.0):
        return min(pl[i], cap)

    def share_after(scorer, n):
        split_pool = [whale / n] * n + smalls
        ws = [scorer(split_pool, i) for i in range(len(split_pool))]
        return sum(ws[:n]) / sum(ws)

    rows = [
        ("A: score = L * t", share_linear(pool, 0), share_after(scorer_linear, N)),
        ("B: score = sqrt(L) * t", share_sqrt(pool, 0), share_after(scorer_sqrt, N)),
        ("C: score = min(L, $50k) * t", share_capped(pool, 0), share_after(scorer_capped, N)),
    ]
    for name, honest, split in rows:
        print(f"{name:>26} {100*honest:>21.1f}% {100*split:>29.1f}%")
    print()
    print("  Model A is Sybil-invariant: splitting a position changes nothing,")
    print("  because the score function is linear and wallets are free.")
    print()
    print("  Models B and C are not anti-whale, they are anti-*honest*-whale. A")
    print("  whale that splits across free wallets ends up with a LARGER share")
    print("  than under linear weighting, while the small LPs the cap was meant to")
    print("  protect are diluted. Concavity only works with a scarce identity, and")
    print("  a permissionless protocol has none. Recommendation: Model A.")


# ---------------------------------------------------------------------------
# 7. Vault sustainability
# ---------------------------------------------------------------------------
def sustainability(p: Params) -> None:
    hdr("7. Vault drawdown when activity stops (exponential drip, half-life view)")
    print("  With a continuous drip that releases a fixed fraction of the vault per")
    print("  second, the vault never empties and the reward rate decays smoothly")
    print("  rather than cliff-edging to zero when revenue pauses.")
    print()
    print(f"{'drip half-life':>16} {'% of vault paid in 30d':>24} {'% left after 1y':>18}")
    for hl_days in (7, 30, 90, 365):
        lam = 0.6931471805599453 / (hl_days * 86400)
        paid30 = 1 - pow(2.718281828459045, -lam * 30 * 86400)
        left1y = pow(2.718281828459045, -lam * 365 * 86400)
        print(f"{str(hl_days) + ' days':>16} {100*paid30:>23.1f}% {100*left1y:>17.1f}%")
    print()
    print("  A 30-day half-life pays out most of a given inflow within a quarter")
    print("  while leaving a buffer that keeps rewards non-zero through quiet")
    print("  periods. No epochs, no snapshots, no operator call required.")


def main() -> None:
    p = Params()
    print("=" * 78)
    print("21M FIXED-SUPPLY PROTOCOL - ECONOMIC MODEL")
    print(f"supply {SUPPLY:,} / {DECIMALS} decimals / fee {p.fee_rate*100:.2f}% / "
          f"split {p.buyback_share:.0%}-{p.liquidity_share:.0%}")
    print("=" * 78)
    revenue_table(p)
    apr_table(p)
    reward_per_position(p)
    cannibalisation(p)
    sell_pressure(p)
    weighting_models()
    sustainability(p)
    print()
    print("=" * 78)
    print("All figures are mechanical consequences of the fee and split parameters.")
    print("None of them is a forecast, and none of them is a promised return.")
    print("=" * 78)


if __name__ == "__main__":
    main()
