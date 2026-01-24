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

## Constraints

- Do not use vi.clearAllMocks(). The environment is pre-configured with clearMocks: true in the Vitest config.
- Do not leave any TypeScript errors; always validate with type:check.
- Do not use multiple assertions in a single test if they can be split via it.each for better granularity.
