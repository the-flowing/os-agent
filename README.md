# OSA (OS-Agent)

**Status:** Early development. We believe this approach will match or exceed current state-of-the-art coding agents within 6-7 days.

## Core Ideas

- **TDD-first planning**: Tasks are broken into steps with tests defined upfront
- **Full terminal experience**: Prompt terminal commands
- **Focused execution**: Approved plans pin to screen, clearing context for implementation

## Requirements

- [Bun](https://bun.sh)

## Setup

1. Install dependencies:

```bash
bun install
```

2. Login to a provider:

```bash
# Login with OAuth (opens browser)
bun run login --provider claude
bun run login --provider chatgpt
bun run login --provider gemini

# Or use --no-browser to get a URL to open manually
bun run login --provider claude --no-browser

# Or provide an API key directly
bun run login --provider claude --api-key sk-...
```

3. Edit `osa.conf` to select your model:

```ini
MODEL=opus
```

Available models:
- Claude: `claude-sonnet`, `claude-haiku`, `claude-opus`
- ChatGPT: `gpt-4`, `gpt-4o`, `gpt-4-mini`
- Gemini: `gemini-pro`, `gemini-flash`

## Usage

```bash
bun run start
```

## Development

### Running Tests

```bash
# Run all tests
bun test

# Run only integration tests
bun test src/tests/integration

# Run specific test file
bun test src/tests/plan-tool.test.ts
```

Tests use Bun's built-in test runner. All test files follow the `*.test.ts` pattern.

Integration tests are located in `src/tests/integration/` and cover end-to-end workflows like the TDD planning cycle.

## Configuration

The agent reads from `osa.conf` or environment variables:

| Config | Env Variable | Description  |
| ------ | ------------ | ------------ |
| MODEL  | OSA_MODEL    | Model to use |

## License

AGPL-3.0

---

## ❤️

- [Bun](https://bun.sh)
- [Ink](https://github.com/vadimdemedes/ink)
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [OpenAI SDK](https://github.com/openai/openai-node)
- [Zod](https://zod.dev)
- [marked](https://marked.js.org)
- [marked-terminal](https://github.com/mikaelbr/marked-terminal)
- [oslo](https://oslo.js.org)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
