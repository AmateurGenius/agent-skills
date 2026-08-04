# Intuition Agent Skills

Agent skills for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://openai.com/codex), and compatible AI agents. Teaches agents to correctly interact with the [Intuition Protocol](https://intuition.systems) on-chain.

## Skills

| Skill | Description | Install |
|-------|-------------|---------|
| [intuition](skills/intuition/) | Canonical reference for producing correct Intuition Protocol transactions -- ABIs, encoding, addresses, value calculations | `npx skills add 0xintuition/agent-skills --skill intuition` |
| [erc8004-agent-layer](skills/erc8004-agent-layer/) | Canonical ERC-8004 identity, classification, trust-provider, and mutable-assessment planning with deterministic registry guardrails | `npx skills add 0xintuition/agent-skills --skill erc8004-agent-layer` |

## Quick Start

```bash
# Install all skills
npx skills add 0xintuition/agent-skills

# Install a specific skill
npx skills add 0xintuition/agent-skills --skill intuition
npx skills add 0xintuition/agent-skills --skill erc8004-agent-layer
```

Once installed, skills are available in your agent's session. Use `/intuition`
for generic protocol operations. Use `/erc8004-agent-layer` to produce the
ERC-8004 semantic plan, then start protocol preparation only in a new user turn
after reviewing that plan.

## What These Skills Do

Intuition runs on an L3 chain that isn't indexed by Etherscan. LLMs can't discover the ABIs, and they make consistent mistakes with the V2 contract interface (bytes32 IDs, batch-only creation, bonding curves). These skills fill those blind spots with verified, canonical knowledge.

The core `intuition` skill can produce unsigned transaction parameters after
the relevant preparation gates. The `erc8004-agent-layer` skill produces only
a semantic plan and stops before transaction preparation. Wallet
infrastructure and signing remain the builder's responsibility.

## Structure

```
agent-skills/
├── skills/
│   ├── intuition/               # Core Intuition Protocol skill
│   └── erc8004-agent-layer/     # ERC-8004 partner integration skill
├── .claude-plugin/
│   └── marketplace.json  # skills.sh marketplace manifest
├── CLAUDE.md             # Repo-level agent instructions
├── README.md             # This file
└── LICENSE
```

## Adding Skills

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding new skills to this repo.

## Testing

Testing is documented in [TESTING.md](TESTING.md), including:
- Layer A deterministic calldata checks (`scripts/pass2-calldata-verification.sh`)
- Layer A.5 edge-case RPC checks (`scripts/pass2-edge-case-tests.sh`)
- Layer B prompt suites for autonomous consumption and on-chain integration (`tests/prompts/`)

## Releases

Published users should treat `main` as a moving branch, not a stable channel.

- Pin production installs to a Git tag or commit SHA.
- `metadata.version` in [`skills/intuition/SKILL.md`](skills/intuition/SKILL.md) is
  updated only in a release PR, not in ordinary fix branches.
- Release policy, semantic versioning rules, and the publish checklist live in
  [RELEASING.md](RELEASING.md).
- User-visible release notes live in [CHANGELOG.md](CHANGELOG.md).

## References

- [Intuition Protocol](https://intuition.systems)
- [Agent Skills Specification](https://agentskills.io/specification)
- [skills.sh](https://skills.sh) -- skill discovery and leaderboard
- [Intuition V2 Contracts](https://github.com/0xIntuition/intuition-v2/tree/main/contracts/core)

## License

MIT
