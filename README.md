# Autonomous 21M Token Protocol

A fixed-supply, operator-free token protocol for Robinhood Chain.

> Fixed supply. Fixed rules. No trusted operator. Everything verifiable on-chain.

**Status: Phase 2 — `Token.sol` implemented and tested. Nothing deployed to any
network.**

Design decisions D1–D4 are resolved (see `docs/05-open-decisions.md`): fees come
from a yield/LP management vault, buybacks execute as a reverse Dutch auction,
rewards accrue to a v2-style full-range pool, and the launch is a pro-rata
contribution that seeds the pool atomically.

## Core invariants

```
TOTAL SUPPLY = 21,000,000 FOREVER
```

- 21,000,000 tokens, 8 decimals, entire supply created at deployment
- No `mint()`, no `burn()`, no rebase, no upgrade path, no owner
- No team treasury, no founder allocation, no discretionary withdrawals
- Fee routing, buybacks and reward distribution are automatic and immutable
- The website is a convenience, never a dependency

## Contents

| | |
|---|---|
| [`docs/01-chain-research.md`](docs/01-chain-research.md) | Robinhood Chain network parameters, DEX landscape, what's verified vs. claimed, and the chain-level centralisation that bounds the "nobody controls it" claim |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Contract map, how each invariant is structurally enforced, reward accounting design, supply accounting for the dashboard |
| [`docs/03-economics.md`](docs/03-economics.md) | Revenue and APR at four activity levels, the circularity finding, weighting-model comparison, sustainability |
| [`docs/04-attack-surface.md`](docs/04-attack-surface.md) | Farming, concentrated-liquidity gaming, buyback manipulation, contract-level hazards, invariant test matrix |
| [`docs/05-open-decisions.md`](docs/05-open-decisions.md) | Nine decisions blocking implementation, each with a recommendation |
| [`sim/model.py`](sim/model.py) | Runnable economic model — `python3 sim/model.py`, no dependencies |
| [`contracts/Token.sol`](contracts/Token.sol) | The fixed-supply ERC-20. No owner, no mint, no burn, no upgrade path |
| [`test/Token.test.js`](test/Token.test.js) | Invariant tests, including a bytecode scan for `DELEGATECALL`/`SELFDESTRUCT` |

## Three findings worth reading first

1. **The fee source is unresolved and it blocks everything.** If the protocol's
   fee-generating activity is trading of TOKEN itself, LPs receive 0.40× the fees
   they already earn from those same swaps, funded by taxing those same swaps.
   That is circular, and no fee rate fixes it. See `03-economics.md` §3.4 and
   `05-open-decisions.md` D1.

2. **`sqrt` and capped reward weighting are Sybil-exploitable and make whale
   dominance worse, not better.** A whale that splits across free wallets
   recovers its full share while diluting everyone else. Linear weighting is the
   only Sybil-invariant option. See `03-economics.md` §3.6.

3. **Robinhood Chain has a centralised sequencer and a 7-of-8 multisig that can
   pause the chain.** Contract-layer immutability is real; "unstoppable" is not.
   The claim that survives scrutiny is *the creator retains no privileged control
   over the protocol*. See `01-chain-research.md` §1.2.

## No promises

This protocol guarantees rules, not outcomes. It does not promise token
appreciation, returns, APY, buyback prices, or liquidity growth.

## Build

```bash
npm install
npx hardhat compile
npx hardhat test
python3 sim/model.py
```

Hardhat 2 + npm `solc` (solc-js) + OpenZeppelin 5.x. This environment cannot
reach `binaries.soliditylang.org`, so `hardhat.config.js` points Hardhat at the
local solc-js build rather than letting it download one. Foundry is preferred
for the fuzzing and invariant testing the security plan requires, but its
installer is egress-blocked here — see `05-open-decisions.md` D9.
