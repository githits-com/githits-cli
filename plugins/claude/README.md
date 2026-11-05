# GitHits for Claude

GitHits connects Claude to public open-source code, documentation, package
metadata, vulnerabilities, changelogs, and implementation examples. The plugin
includes four skills for MCP research, CLI code and package research, and setup.

Install in Claude Code:

    /plugin install githits --marketplace githits-com/githits-cli

The connector uses the hosted MCP server at https://mcp.githits.com. Sign in to
GitHits when prompted. Research requests send public repository or package
targets and search queries to GitHits; do not send private code or credentials.
Some research tools consume credits and save results or research threads.

The CLI skills require shell access and an installed GitHits CLI. The onboarding
skill can guide CLI installation, sign-in, and coding-tool configuration when
requested. Installing this plugin does not install the CLI or Node dependencies.

Documentation: https://docs.githits.com
Privacy policy: https://githits.com/legal/privacy-policy/
