---
name: unit-test-craftsman
description: Activate this skill when writing or refactoring unit tests (Vitest/Bun) or when user is asking you to fix test failures.
---

# Unit Test Craftsman

## Goal

To enhance the readability and maintainability of unit tests while ensuring 100% technical reliability and code coverage within a high-performance workflow.

## Instructions

- **Refactor for Readability**:
  - Convert repetitive test cases into `it.each` tables using **tagged templates**.
  - Aim for **one `expect()` function per `it()`** block to isolate failures and improve clarity.
- **Ensure 100% Coverage**:
  - Analyze the source code to identify missing branches, functions, or statements.
  - Generate additional test cases to reach **100% coverage** (statements, functions, branches, and lines).
- **Technical Validation**:
  - Run `bun run type:check` to ensure no TypeScript errors remain in the test suite.
  - Execute the specific test file using `bun run test <path_to_file>`.
- **Performance**:
  - Keep logic execution extremely lean to ensure the turnaround is faster than 100ms.

## DOs

- Use `it.each` with tagged templates for repetitive test cases.
- Isolate failures by using exactly one `expect()` per `it()` block.
- Reach 100% coverage for all statements, functions, branches, and lines.
- Validate types using `bun run type:check` for every change.
- Target tests using `bun run test <path_to_file>` for speed.
- Ensure performance by keeping execution turnaround under 100ms.

## DONTs

- Avoid `vi.clearAllMocks();` it is pre-configured in the Vitest config.
- Leave no TypeScript errors; the test suite must always be clean.
- Stop at multiple assertions if they can be split for better granularity.
- Ignore edge cases; never finish without verifying every code branch.
