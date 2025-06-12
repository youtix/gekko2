# Contributing

Thanks for your interest in contributing to Gekko 2! This project uses [Bun](https://bun.sh/) for package management and development, along with a few automated checks to keep the codebase consistent.

## Development setup

1. Install dependencies with:

   ```bash
   bun install
   ```

2. Run the type checker and linter before committing:

   ```bash
   bun run type:check
   bun run lint
   ```

## Style and lint rules

- **ESLint** enforces our coding style. Run `bun run lint` to automatically fix problems.
- **Prettier** formats the code. Run `bun run format` or `bun run format:check` to verify formatting.
- Commit messages must follow the **Conventional Commits** specification. `commitlint` checks this automatically via a Husky hook.

## Running tests

Execute the full test suite with coverage using:

```bash
bun run test:coverage
```

Unit tests are powered by [Vitest](https://vitest.dev/).

For more details on our workflow, see the Husky hooks in `.husky/` which run type checks, lint-staged, and tests on each commit and push.
