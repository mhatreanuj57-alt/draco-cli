# Draco CLI

![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green)
![License: MIT](https://img.shields.io/badge/License-MIT-green)
![Author: Anuj Mhatre](https://img.shields.io/badge/Author-Anuj%20Mhatre-orange)

## Why We Built This

Developers need AI coding assistance directly in their terminal without switching contexts. Draco CLI provides a zero-login, terminal-first AI coding agent powered by the OpenCode Zen API.

## What It Does

- Interactive REPL for AI-assisted coding in the terminal
- One-shot mode for quick questions: `draco "explain this error"`
- Auto-apply file edits with configurable approval levels
- Session persistence and resume with `--continue`
- MCP server integration for extended tool capabilities
- Multiple model support via `--model` flag

## How It Was Built

- **Runtime:** Node.js 18+ with CommonJS modules
- **API:** OpenAI-compatible (OpenCode Zen)
- **Interface:** readline-based terminal UI with color support
- **Architecture:** Modular (CLI args, session management, providers, tools)
- **MCP:** Model Context Protocol for tool integrations

## Quick Start

```bash
# Install globally
npm install -g draco-cli

# Or run directly
node bin/draco.js

# One-shot mode
draco "write a Python hello world"

# With specific model
draco --model=gpt-4 "refactor this function"
```

**Environment Variables:**
```bash
export OPENCODE_ZEN_KEY="your-api-key"
export DRACO_MODEL="nemotron-3-ultra-free"
export DRACO_APPROVALS="suggest"  # suggest | auto-edit | full-auto
```

## Project Structure

```
draco-cli/
├── bin/
│   └── draco.js          # Entry point
├── src/
│   ├── index.js          # Main orchestrator
│   ├── config.js         # Configuration management
│   ├── cli/              # Args parsing, REPL, line queue
│   ├── core/             # Session management
│   ├── providers/        # AI provider integrations
│   ├── tools/            # File/shell tools
│   ├── integrations/     # MCP client
│   └── ui/               # Terminal UI utilities
├── package.json          # Dependencies
└── ARCHITECTURE.md       # Detailed architecture docs
```

## Test Results

Manual CLI testing. No automated test suite (interactive terminal project).

## License

MIT License - see [LICENSE](LICENSE) for details.
