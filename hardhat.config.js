require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
const { subtask } = require("hardhat/config");
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} = require("hardhat/builtin-tasks/task-names");

const SOLC_VERSION = "0.8.28";

// This environment cannot reach binaries.soliditylang.org, so Hardhat's normal
// compiler download fails. The npm `solc` package ships the same compiler as
// wasm; point Hardhat at it instead of letting it fetch. See docs/05 D9.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === SOLC_VERSION) {
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: require("solc").version(),
    };
  }
  return runSuper();
});

module.exports = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 1_000_000 },
      evmVersion: "cancun",
    },
  },
  networks: {
    // Addresses and endpoints are unverified from this session (docs/01 §1.4).
    // Nothing here is used until a deploy script asserts them against the chain.
    robinhoodTestnet: {
      url: process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com/rpc",
      chainId: 46630,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    robinhoodMainnet: {
      url: process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
