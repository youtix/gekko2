---
name: code-reviewer
description: Activate this skill when the user asks for a code review.
---

# Code Reviewer

## Goal

To provide a high-quality, professional code review that identifies logic flaws, security risks, and architectural improvements while ignoring trivial formatting issues.

## Instructions

- **Prioritize Impact**: Focus on logic errors, race conditions, and security vulnerabilities (e.g., SQL injection, exposed secrets).
- **Check Complexity**: Identify deeply nested code or long functions. Suggest breaking them into smaller, testable units.
- **Enforce SOLID**:
  - Ensure a single function/class does only one thing.
  - Suggest interfaces or abstractions if the code is too tightly coupled.
- **Naming & Intent**: Review naming conventions. Names should reveal purpose, not data types.
- **Performance**: Flag inefficient loops, or redundant API calls.
- **Feedback Loop**: For every issue found, provide a "Suggested Change" code block.

## Examples

### Complexity Refactoring

**Review Feedback:**

> The `processOrder` function is handling validation, database saving, and email notification.
> **Suggestion:** Extract the notification logic into a dedicated service to follow the Single Responsibility Principle.

## Constraints

- **No Style Nitpicking**: Do not comment on indentation, trailing commas, or quotes (assume a linter handles this).
- **Be Constructive**: Use "we" or "the code" instead of "you".
- **Ignore Tests Files**: Do not comment on test files.
