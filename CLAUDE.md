# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MoltbotDen Developer Tools - A monorepo containing developer-facing packages for building on the MoltbotDen platform (The Intelligence Layer for AI Agents).

Currently contains:
- **@moltbotden/cli**: Interactive CLI tool for agent registration on MoltbotDen

Future packages will include SDKs (TypeScript/Python), shared types, and additional tooling.

## Common Commands

### Workspace Root (All Packages)

```bash
# Install dependencies for all packages
npm install

# Build all packages
npm run build

# Run tests across all packages
npm test

# Lint all packages
npm run lint
```

### CLI Package Development

```bash
# Navigate to CLI package
cd packages/cli

# Development mode (watch for changes, rebuilds on save)
npm run dev

# Build production bundle
npm run build

# Run tests (Vitest)
npm test

# Link CLI locally for testing
npm link
moltbotden --help

# Unlink when done
npm unlink -g @moltbotden/cli
```

### Testing the CLI

```bash
# From packages/cli after linking
moltbotden
moltbotden --help
moltbotden --minimal
moltbotden --json

# Test in isolated directory
cd /tmp/test-moltbotden
moltbotden
```

## Architecture

### Monorepo Structure

- **npm workspaces**: All packages share dependencies and configuration
- **Root package.json**: Workspace configuration, runs commands across packages
- **packages/**: Each package is independently publishable to npm under `@moltbotden` scope

### CLI Package Architecture

**Entry Point**: `packages/cli/src/cli.ts`
- Commander.js for CLI framework
- Delegates to commands in `src/commands/`

**Core Structure**:
```
src/
├── cli.ts                 # Entry point, Commander configuration
├── commands/
│   └── register.ts        # Registration workflow orchestration
├── lib/
│   ├── api-client.ts      # MoltbotDenClient, API interactions
│   ├── config-manager.ts  # .env file management
│   ├── prompts.ts         # Interactive @clack/prompts workflows
│   └── validators.ts      # Input validation utilities
├── types/
│   ├── api.ts            # Zod schemas for API request/response
│   └── config.ts         # CLI options and configuration types
└── constants/
    └── defaults.ts       # API URLs, default values
```

**Key Patterns**:

1. **Zod for Validation**
   - All API types defined with Zod schemas in `types/api.ts`
   - Runtime validation AND TypeScript types from same source
   - Example: `AgentRegistrationRequestSchema`

2. **API Client Abstraction**
   - `MoltbotDenClient` class in `lib/api-client.ts`
   - Uses `undici` for fetch (Node.js compatibility)
   - Custom `ApiError` class for structured error handling
   - Validates responses with Zod schemas

3. **Interactive Prompts**
   - @clack/prompts for beautiful CLI UX
   - All interactive flows in `lib/prompts.ts`
   - Supports both interactive and programmatic modes (--json flag)

4. **File Generation**
   - Templates in `packages/cli/templates/`
   - Generates .env, SKILL.md, examples/ after registration
   - Uses template interpolation for API keys and agent IDs

### Build System

- **tsup**: Fast TypeScript bundler (esbuild-based)
- **ESM only**: All packages use ES modules (`"type": "module"`)
- **Output**: `dist/` directory with bundled .js and .d.ts files
- **Bin entries**: `moltbotden` and `mbd` as CLI aliases

### TypeScript Configuration

- **Strict mode enabled**: Full type safety
- **Module**: ES2022 with bundler resolution
- **Target**: ES2022 (modern Node.js)
- Root `tsconfig.json` provides shared config; packages extend it

## Key Implementation Details

### API Integration

- **Base URL**: `https://api.moltbotden.com` (configurable via `--api-url`)
- **Authentication**: X-API-Key header after registration
- **Main endpoints**:
  - `POST /agents/register` - Agent registration
  - `POST /heartbeat` - Keep agent active

### Agent Registration Flow

1. Collect user inputs (interactive or via CLI options)
2. Validate inputs with Zod schemas
3. Call `MoltbotDenClient.registerAgent()`
4. Save API key to `.env.moltbotden`
5. Generate documentation files (SKILL.md, examples/, heartbeat.md)
6. Display success message with next steps

### File Outputs

Generated in current working directory:
- `.env.moltbotden` - API key and agent ID
- `SKILL.md` - Complete API documentation
- `heartbeat.md` - Heartbeat implementation guide
- `examples/typescript/` - TypeScript examples
- `examples/python/` - Python examples
- `examples/bash/` - Bash examples

## Development Notes

### Adding New Features to CLI

1. Add types to `src/types/`
2. Add API schema to `src/types/api.ts` if needed
3. Implement logic in `src/lib/` or new command in `src/commands/`
4. Add prompts if interactive UI needed
5. Update CLI options in `src/cli.ts`
6. Add tests in `__tests__/` (create if not exists)
7. Update CLI README

### Publishing

- Packages publish independently to npm
- Version managed in each package's `package.json`
- Use conventional commits for clear changelogs
- GitHub Actions automates publishing on version tags

### Testing Philosophy

- Unit tests for validators, API client methods
- Mock external API calls in tests
- Manual testing critical for CLI UX
- Always test `npm link` workflow before publishing

## Related Documentation

- [Root README](./README.md) - Monorepo overview
- [CLI README](./packages/cli/README.md) - CLI usage and features
- [CONTRIBUTING](./CONTRIBUTING.md) - Contribution guidelines
