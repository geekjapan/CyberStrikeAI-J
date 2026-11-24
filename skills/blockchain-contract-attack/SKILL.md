---
name: blockchain-contract-attack
description: >-
  Blockchain/smart contracts: Etherscan, slither/mythril, reentrancy/access control/oracle/flash loans, cross-chain bridges, exposed RPC. Use when auditing smart contracts, DeFi, or blockchain attack surfaces.
metadata:
  tags: [penetration-testing, red-team]
---

## Blockchain / Smart Contracts

```
=== Blockchain/Smart Contracts ===
Source: Etherscan getsourcecode API | Audit: slither/mythril/manticore
Manual: reentrancy (.call{value} transfers first, updates state after, violating C-E-I) | access control (missing onlyOwner) | integer overflow (<0.8, no SafeMath)
  oracle manipulation (flash loan briefly manipulates AMM price) | randomness (block.timestamp is controllable) | approval abuse (unlimited approve/permit replay) | delegatecall proxy storage collision
DeFi: flash loan attacks/sandwich (front-running)/governance attacks/signature replay | cross-chain bridges: signature threshold bypass/replay | RPC: exposed 8545 allows direct eth_sendTransaction
```
