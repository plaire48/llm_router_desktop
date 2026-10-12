# Claude CLI model discovery

The previous adapter hard-coded Sonnet, Opus 5.5 and Haiku. It could not show other CLI models and guessed effort capabilities from those three names.

The adapter now requests a `control_request / initialize` response using the installed CLI's stream-json input/output. This follows the official Agent SDK control protocol. Discovery sends no user prompt, disables CLI tools and MCP, uses safe mode and no session persistence, and has a 20-second bound. Credentials stay in the CLI. No SDK dependency or account endpoint was added.

Models use `resolvedModel` as their persisted ID and retain CLI aliases for restoring older selections. Duplicate Default/family entries are combined; different historical versions are preserved. The CLI's `supportsEffort` and `supportedEffortLevels` determine the picker and `--effort`. A model with no reported support receives no effort flag. Refresh uses one in-flight discovery and retains an existing valid selection. A failed discovery does not claim the old three-item list is a current catalog.

Live read-only verification: installed CLI 2.1.296 returned 13 rows, representing 12 distinct resolved models. It included Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5, Haiku 4.5 and prior versions. Haiku 5.5 reported effort support; Haiku 4.5 did not. This proves catalog/option discovery, not successful inference on every model or inclusion of every model in a subscription. Pricing and model availability remain governed by Claude.

References:
- https://code.claude.com/docs/en/model-config
- https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py
- https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/client.py

Local tests cover discovery, aliases, historical IDs, effort flags, unavailable catalogs, authentication, restart preferences, and unchanged host tool approval boundaries.
