# Architect state

Machine-readable definition of the agent system **as verified by Architect 2.0**. Each Architect pull request
updates these files only after the change passed structural and behavioral verification.

- `agents/<key>.json`: the live AgentVersion of each agent (`instructions` is one array item per line).
- `scenarios/<key>.json`: the rules (scenarios) the agents were verified against.
- `changes/<change-id>.json`: the Architect change, the user's request and its verification results.

This is Architect's current prototype representation of a verified change. It is not generated application code.
