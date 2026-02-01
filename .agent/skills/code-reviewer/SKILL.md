---
name: code-reviewer
description: Activate this skill when the user asks for a code review.
---

# Code Reviewer: Gekko2 (Bun/Trading)

## Goal

To provide senior-level architectural and logic reviews for a high-frequency crypto trading bot. The focus is on financial precision, system reliability, and Bun-native performance.

## Review Priorities

### 1. Financial Integrity & Precision

- **Precision Errors**: Flag any direct floating-point math on prices or balances. Ensure use of appropriate rounding based on `ccxt` market precision.
- **Order Validation**: Check that order sizing logic accounts for exchange limits (`minAmount`, `minCost`) and fee deductions before execution.
- **Race Conditions**: Identify "check-then-act" patterns where market state or balance could change between validation and execution.

### 2. Bun & Performance Optimization

- **Bun-Native APIs**: Suggest replacing standard Node.js patterns with `Bun.file`, `Bun.password`, or `Bun.sqlite` where performance gains are significant.
- **Memory Management**: Flag frequent object allocation or heavy closures inside high-frequency ticker loops/streams.
- **Efficient I/O**: Ensure `protobufjs` is used for high-speed data serialization and that `lodash-es` is tree-shaken.

### 3. Resilience & Security

- **Schema Validation**: Enforce `Zod` validation for all external inputs: YAML configs, API responses, and CLI arguments.
- **Error Boundaries**: Ensure that a failed exchange request (e.g., CCXT `NetworkError` or `ExchangeError`) is handled gracefully without crashing the main bot process.
- **Secret Safety**: Flag any hardcoded API keys or sensitive data. Ensure they are pulled from environment variables.

### 4. Architecture (SOLID)

- **Separation of Concerns**: Ensure strategies are decoupled from exchange-specific logic.
- **Single Responsibility**: Suggest breaking down bloated functions (especially in the trading loop) into smaller, testable units.
- **Observability**: Suggest adding `winston` logging at critical decision points (e.g., why a trade was _not_ taken).

## Feedback Protocol

- **No Style Nits**: Ignore formatting, indentation, and semicolons (handled by Prettier/ESLint).
- **Ignore Tests**: Do not review files ending in `.test.ts`, `.spec.ts`, or `bench.ts`.
- **Actionable Advice**: Every identified issue must include a "Suggested Change" code block.
- **Tone**: Use constructive, collective language (e.g., "We should handle the exception here...") and focus on technical rigor.

## Instructions for Feedback

1.  **Analyze**: Scan for logic flaws and architectural weaknesses.
2.  **Contextualize**: Relate feedback to the specific constraints of the `gekko2` project (trading, Bun, CCXT).
3.  **Propose**: Provide a optimized, refactored code snippet for every major point.
