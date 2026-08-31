# 1. Robinhood Chain — network research

Status: **researched, partially unverified.** Everything below is sourced, but
this session's network egress blocks `docs.robinhood.com`, `l2beat.com`,
`developers.uniswap.org` and all Robinhood Chain RPC endpoints. Nothing here has
been confirmed by an `eth_call` against the chain. Per the blueprint's rule —
*never hard-code unverified network information* — every address and endpoint in
this document is treated as a **claim to be verified on-chain before use**, and
the contracts are designed to take them as constructor arguments rather than
constants.

## 1.1 Network parameters

Source: the `ethereum-lists/chains` registry, fetched directly (the same data
that populates Chainlist and wallet network pickers).

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | `4663` | `46630` |
| Name | Robinhood Chain | Robinhood Chain Testnet |
| Native gas token | ETH (18 decimals) | Sepolia ETH |
| Settles to | Ethereum mainnet (`eip155-1`) | Sepolia (`eip155-11155111`) |
| Primary RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com/rpc` |
| Alternate RPC | `https://robinhood-rpc.publicnode.com` (+ `wss://`) | `https://robinhood-sepolia-rpc.publicnode.com` (+ `wss://`) |
| Explorer | `https://robinscan.io`, `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Bridge | Arbitrum portal | Arbitrum portal |
| Faucet | — (none listed) | — (none listed; testnet ETH must be bridged from Sepolia) |

Note the testnet RPC path: the registry lists a `/rpc` suffix that several
third-party guides omit. Verify before wiring it into a deploy script.

**Stack:** Arbitrum Orbit L2, ETH as the gas token, Ethereum blobs for data
availability. Mainnet went live 1 July 2026. Standard Solidity/Vyper deploys
unmodified; Hardhat, Foundry, ethers, viem and wagmi all work.

**Deployment is permissionless.** No allowlist, no partnership, no Robinhood
account — you need ETH on the chain for gas. (Becoming a *validator* is
allowlisted and bonded; that is a separate thing and does not affect us.)

## 1.2 The part that constrains the project's philosophy

The blueprint's closing line is *"Nobody controls the money afterward."* On this
chain that is true of the protocol and not true of the substrate. Per L2BEAT's
July 2026 assessment:

- The **sequencer is centralised and run by Robinhood.** It has priority in
  ordering and batching. Forced inclusion via L1 exists, but the operator is in
  a position to front-run or sandwich any transaction it can see — including our
  buyback.
- **Core system contracts are upgradeable with no delay**, and users get **no
  exit window** before an upgrade takes effect.
- A **7-of-8 multisig can pause and unpause the chain** and set system roles and
  parameters.
- Only **two allowlisted actors** could challenge incorrect state updates.

Consequences we have to accept and state plainly:

1. An immutable, ownerless contract set on this chain is *still* subject to a
   chain-level pause by an 8-person multisig. "No trusted operator" describes
   our protocol layer, not the whole stack.
2. Any marketing claim of the form "unstoppable" or "nobody can freeze this"
   would be **false** on Robinhood Chain. The honest claim is narrower and still
   worth making: *the protocol's rules cannot be changed by its creator.*
3. Sequencer-level MEV is a design input for the buyback, not a tail risk. See
   `04-attack-surface.md` §3, and the Dutch-auction alternative in
   `02-architecture.md` §4, which removes the need to trust ordering at all.

## 1.3 Liquidity infrastructure

Uniswap deployed its full suite on Robinhood Chain from day one: **v2, v3, v4
and UniswapX**, with support in the Uniswap web app, wallet and API. Uniswap's
own `pools.trade` launchpad (v4-based) went live in early August 2026, and at
least one third-party launchpad (Pons) and DEX aggregators (Splitshot,
LiquidSwap) are operating.

Observed usage, mid-to-late August 2026:
- Cumulative tokenised-stock volume through Uniswap on the chain passed **$1B**.
- Daily volume reached an all-time high near **$130M/day**.
- Volume splits roughly evenly between **v3 and v4**; **v2 sees minimal volume**.
- `WETH/USDG` is the highest-volume pool (~$46M/24h on 16 Aug 2026).
- DexPaprika tracked ~17,000 pools on the chain.

Two things follow. First, `$130M/day` chain-wide is the ceiling to calibrate the
economic model against — the blueprint's "$10M/day" scenario means ~8% of every
swap on the chain routing through one new protocol. Second, **Uniswap is already
the incumbent venue with zero protocol fee on top of the LP fee.** Any design
where we charge 0.20% for a swap a user could make on Uniswap instead has to
explain why they would pay it. That is the central open question in
`05-open-decisions.md` §1.

That v2 is deployed but barely used is convenient for us: a v2-style
**full-range, fungible-LP-token pool** is dramatically easier to reward safely
than v3/v4 concentrated positions (see `04-attack-surface.md` §2).

## 1.4 Addresses still to verify

Not obtainable from this session. Must be read from the chain and checked
against deployed bytecode before any contract references them:

- Uniswap v2 `UniswapV2Factory`, `UniswapV2Router02`
- Uniswap v3 `UniswapV3Factory`, `NonfungiblePositionManager`, `QuoterV2`
- `UniversalRouter` (Uniswap's current preferred swap entrypoint; it supersedes
  `SwapRouter02`)
- Uniswap v4 `PoolManager`, `PositionManager`
- Canonical `WETH9` on chain 4663 and 46630
- `Permit2`

Uniswap's own documentation warns that addresses are **no longer consistent
across chains** and must be confirmed per-chain. The deploy script must fetch
each address, assert `extcodehash` is non-empty, and assert a known-good
interface probe (e.g. `factory.getPair()` returns for a known pool) before
deploying anything that hard-codes them as immutables.

## 1.5 Build environment findings

- **Foundry is not installable in this session.** `foundry.paradigm.xyz` is
  egress-blocked and `github.com/foundry-rs/foundry/releases` returns 403.
- **Hardhat installs cleanly** from npm (registry.npmjs.org is reachable).
- Hardhat's solc downloader pulls from `binaries.soliditylang.org`, which is
  **egress-blocked**.
- **Verified working fallback:** the npm `solc` package (solc-js, wasm) installs
  and compiles. Confirmed compiling a `pragma 0.8.28` contract to bytecode in
  this session.
- `@openzeppelin/contracts` 5.6.1 is available on npm.

So the toolchain is **Hardhat + solc-js + OpenZeppelin 5.x**, unless
`binaries.soliditylang.org` and `foundry.paradigm.xyz` are added to the
environment's egress allowlist — in which case Foundry is preferable, because
its fuzzing and invariant testing (`forge test --fuzz`, `invariant_` handlers)
are exactly what the blueprint's §18 asks for and Hardhat has no direct
equivalent. **This is worth fixing before Phase 7.**

## Sources

- [ethereum-lists/chains — eip155-4663](https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/chains/eip155-4663.json)
- [ethereum-lists/chains — eip155-46630](https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/chains/eip155-46630.json)
- [Robinhood Chain Documentation](https://docs.robinhood.com/chain/) *(egress-blocked here; re-verify)*
- [Robinhood Chain — L2BEAT](https://l2beat.com/layer2s/projects/robinhood) *(egress-blocked here; re-verify)*
- [Uniswap is Live on Robinhood Chain](https://blog.uniswap.org/robinhood-chain-is-live)
- [Robinhood Chain Deployments — Uniswap Developers](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments)
- [Uniswap on Robinhood Chain hits $130M in daily stock token trading volume](https://cryptobriefing.com/uniswap-robinhood-chain-stock-token-volume-2/)
- [Uniswap Launches Pools.trade Token Launchpad on Robinhood Chain](https://www.cryptotimes.io/2026/08/06/uniswap-launches-pools-trade-token-launchpad-on-robinhood-chain/)
- [Top Robinhood Chain Liquidity Pools by Volume — DexPaprika](https://dexpaprika.com/robinhood)
