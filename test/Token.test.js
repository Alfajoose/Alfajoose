const { expect } = require("chai");
const { ethers } = require("hardhat");

const MAX_SUPPLY = 21_000_000n * 10n ** 8n;
const DEAD = "0x000000000000000000000000000000000000dEaD";

// Walks EVM bytecode respecting PUSH immediates, so bytes that merely appear
// inside push data are not mistaken for opcodes.
function opcodesIn(bytecode) {
  const code = Buffer.from(bytecode.replace(/^0x/, ""), "hex");
  const seen = new Set();
  for (let i = 0; i < code.length; i++) {
    const op = code[i];
    seen.add(op);
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f; // PUSH1..PUSH32
  }
  return seen;
}

describe("Token", function () {
  let token, deployer, genesis, alice, bob, carol;

  beforeEach(async function () {
    [deployer, genesis, alice, bob, carol] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("Token");
    token = await Token.deploy("Test Token", "TEST", genesis.address);
    await token.waitForDeployment();
  });

  describe("monetary policy", function () {
    it("has exactly 21,000,000 tokens at 8 decimals", async function () {
      expect(await token.decimals()).to.equal(8);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
      expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
      expect(await token.totalSupply()).to.equal(2_100_000_000_000_000n);
    });

    it("mints the entire supply to the genesis recipient and nothing to the deployer", async function () {
      expect(await token.balanceOf(genesis.address)).to.equal(MAX_SUPPLY);
      expect(await token.balanceOf(deployer.address)).to.equal(0n);
    });

    it("emits exactly one Transfer from the zero address, ever", async function () {
      const mints = await token.queryFilter(
        token.filters.Transfer(ethers.ZeroAddress, null),
        0,
        "latest"
      );
      expect(mints.length).to.equal(1);
      expect(mints[0].args.value).to.equal(MAX_SUPPLY);
    });
  });

  describe("absent capabilities", function () {
    it("exposes no mint, burn, ownership or upgrade function in its ABI", async function () {
      const names = token.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name.toLowerCase());
      const forbidden = [
        "mint", "burn", "burnfrom", "owner", "transferownership",
        "renounceownership", "upgradeto", "upgradetoandcall", "initialize",
        "pause", "unpause", "rescue", "sweep", "setdecimals", "rebase",
      ];
      for (const bad of forbidden) {
        expect(names, `ABI must not expose ${bad}()`).to.not.include(bad);
      }
    });

    it("contains no DELEGATECALL, SELFDESTRUCT, CREATE or CREATE2 opcode", async function () {
      const ops = opcodesIn(await ethers.provider.getCode(await token.getAddress()));
      expect(ops.has(0xf4), "DELEGATECALL present").to.equal(false);
      expect(ops.has(0xff), "SELFDESTRUCT present").to.equal(false);
      expect(ops.has(0xf0), "CREATE present").to.equal(false);
      expect(ops.has(0xf5), "CREATE2 present").to.equal(false);
    });
  });

  describe("supply invariant under use", function () {
    it("holds across ordinary transfers and approvals", async function () {
      const amount = 1_000n * 10n ** 8n;
      await token.connect(genesis).transfer(alice.address, amount);
      await token.connect(alice).approve(bob.address, amount);
      await token.connect(bob).transferFrom(alice.address, carol.address, amount);

      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
      expect(await token.balanceOf(carol.address)).to.equal(amount);
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });

    it("holds when tokens are sent to an unreachable address", async function () {
      const amount = 500n * 10n ** 8n;
      await token.connect(genesis).transfer(DEAD, amount);

      // Unreachable, but not destroyed. Supply is unchanged and 0xdead is a
      // holder like any other — accounting must not subtract it.
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
      expect(await token.balanceOf(DEAD)).to.equal(amount);
    });

    it("rejects transfers to the zero address", async function () {
      await expect(
        token.connect(genesis).transfer(ethers.ZeroAddress, 1n)
      ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
    });

    it("survives randomised transfer sequences with balances always summing to supply", async function () {
      const accounts = [genesis, alice, bob, carol, deployer];
      const addrs = accounts.map((a) => a.address);

      for (let round = 0; round < 200; round++) {
        const from = accounts[Math.floor(Math.random() * accounts.length)];
        const to = addrs[Math.floor(Math.random() * addrs.length)];
        const balance = await token.balanceOf(from.address);
        if (balance === 0n || from.address === to) continue;

        // Random amount in [1, balance], skewed to exercise dust and full sweeps.
        const roll = Math.random();
        const amount =
          roll < 0.1 ? 1n
          : roll < 0.2 ? balance
          : (balance * BigInt(1 + Math.floor(Math.random() * 99))) / 100n;
        if (amount === 0n) continue;

        await token.connect(from).transfer(to, amount);

        let sum = 0n;
        for (const a of addrs) sum += await token.balanceOf(a);
        expect(sum, `balances diverged at round ${round}`).to.equal(MAX_SUPPLY);
        expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
      }
    });
  });

  describe("permit", function () {
    it("supports EIP-2612 gasless approval", async function () {
      const value = 42n * 10n ** 8n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await token.nonces(genesis.address);
      const { chainId } = await ethers.provider.getNetwork();

      const signature = await genesis.signTypedData(
        {
          name: "Test Token",
          version: "1",
          chainId,
          verifyingContract: await token.getAddress(),
        },
        {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        { owner: genesis.address, spender: alice.address, value, nonce, deadline }
      );
      const { v, r, s } = ethers.Signature.from(signature);

      await token.permit(genesis.address, alice.address, value, deadline, v, r, s);
      expect(await token.allowance(genesis.address, alice.address)).to.equal(value);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    });
  });
});
