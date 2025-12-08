# OSA (OS-Agent)

**Status:** Early development. We believe this approach will match or exceed current state-of-the-art coding agents within 6-7 days.

## Core Ideas

- **TDD-first planning**: Tasks are broken into steps with tests defined upfront
- **Full terminal experience**: Prompt terminal commands
- **Focused execution**: Approved plans pin to screen, clearing context for implementation

## Requirements

- [Bun](https://bun.sh)
- [CLI Proxy API](https://github.com/router-for-me/CLIProxyAPI)

## Setup

1. Install dependencies:

```bash
bun install
```

2. Copy the config template and add your credentials:

```bash
cp osa.conf.template osa.conf
```

3. Edit `osa.conf` with your CLIProxyAPI configuration.

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

| Config  | Env Variable | Description  |
| ------- | ------------ | ------------ |
| API_URL | OSA_BASE_URL | API endpoint |
| API_KEY | OSA_API_KEY  | API key      |
| MODEL   | OSA_MODEL    | Model to use |

## License

AGPL-3.0
