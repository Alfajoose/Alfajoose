// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title Fixed-supply protocol token
/// @notice 21,000,000 tokens with 8 decimals, created once at deployment and
///         never again. There is no owner, no mint path, no burn path, no
///         upgrade path and no privileged role of any kind.
///
/// @dev The supply invariant is enforced structurally, not by policy:
///
///      - `_mint` is internal in OpenZeppelin's ERC20 and is called exactly
///        once, from this constructor. No external or public function in this
///        contract or its bases reaches it.
///      - `ERC20Burnable` is deliberately NOT inherited. OpenZeppelin's
///        `_burn` is internal and is never called, so no burn path exists.
///      - No `Ownable`, no `AccessControl`, no proxy, no `delegatecall`, no
///        `selfdestruct`. There is nothing to renounce later because there is
///        nothing privileged to begin with.
///      - Balances are stored directly. There is no rebasing or scaling
///        factor, so no path can change balances other than a transfer.
///
///      Consequently `totalSupply()` returns exactly `MAX_SUPPLY` for the
///      entire life of this contract.
///
///      Note on "burning": OpenZeppelin 5.x reverts on transfers to the zero
///      address, but a holder can still send tokens to an unowned address such
///      as `0x…dead`. Those tokens become unreachable; `totalSupply()` is
///      unchanged. That is consistent with the invariant — supply is fixed,
///      and some of it may become unspendable. Accounting must count such
///      addresses as holders rather than subtracting them from supply.
///
///      Note on liquidity: tokens held by a liquidity pool, locked or not, are
///      still part of the 21,000,000. Locked LP tokens are not burned tokens
///      and must never be described as such.
///
/// @dev `name_` and `symbol_` are constructor arguments while branding is
///      still undecided. They are written once into immutable-in-practice
///      storage with no setter. Before mainnet they should be replaced with
///      literals so the verified source states them plainly.
contract Token is ERC20, ERC20Permit {
    /// @notice The entire supply, in base units. 21,000,000 × 10^8.
    /// @dev Declared `constant` so it is visible in the verified source and
    ///      costs no storage. This value is the protocol's core invariant.
    uint256 public constant MAX_SUPPLY = 21_000_000 * 10 ** 8;

    /// @param name_ Token name.
    /// @param symbol_ Token symbol.
    /// @param genesisRecipient The single address that receives the entire
    ///        supply. This MUST be the address of the public distribution
    ///        contract, never a wallet: the protocol permits no team
    ///        allocation, and the distribution rules are the launch.
    constructor(string memory name_, string memory symbol_, address genesisRecipient)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        // The only mint that will ever occur.
        _mint(genesisRecipient, MAX_SUPPLY);
    }

    /// @notice 8 decimals, matching Bitcoin's smallest unit.
    /// @dev Overrides OpenZeppelin's default of 18. Integrators that assume 18
    ///      decimals will misprice this token; downstream reward accounting
    ///      must use a precision multiplier large enough to avoid truncating
    ///      8-decimal accruals against 18-decimal staked balances.
    function decimals() public pure override returns (uint8) {
        return 8;
    }
}
