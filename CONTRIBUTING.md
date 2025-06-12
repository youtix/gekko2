# Contributing to Gekko 2

Thank you for considering contributing to Gekko 2! This guide explains how to get the project running locally and how to submit your contributions.

## Getting Started

### Clone the Repository

```bash
git clone https://github.com/youtix/gekko2.git
cd gekko2
```

### Install Bun

Gekko 2 runs on [Bun](https://bun.sh/). Follow the [installation instructions](https://bun.sh/docs/install) if you don\'t already have it.

### Install Dependencies

Use Bun to install the project dependencies:

```bash
bun install
```

## Development Workflow

### Run Tests

Execute the test suite with:

```bash
bun run test
```

You can also run `bun x vitest` directly if preferred.

### Check Formatting, Linting, and Types

Before committing, ensure the codebase is clean:

```bash
bun run format:check
bun run lint:check
bun run type:check
```

## Commit Message Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) to keep our history readable. Example prefixes include `feat`, `fix`, `chore`, and `BREAKING CHANGE`.

Example messages:

```
feat: add new configuration parser
fix: handle invalid YAML gracefully
chore: update dependencies
feat!: migrate to new API (BREAKING CHANGE)
```

Run `bun run commit:check` to validate your commit messages.

## Creating Pull Requests

1. Create a new branch using a descriptive name, e.g. `feat/awesome-feature` or `fix/edge-case`.
2. Make sure tests pass and the repository is lint-free by running the commands in the development workflow section.
3. Open a pull request describing **what** you changed and **why**.

## Release Process (Optional)

Releases are automated using [semantic-release](https://github.com/semantic-release/semantic-release). Version numbers and the changelog are generated automatically, so you don\'t need to bump versions manually.
