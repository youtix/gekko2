---
name: feature-architect
description: Use this skill when the user provides an abstract idea or a new feature request. This skill helps the user specify every detail of their idea through iterative questioning and provides recommendations based on the existing codebase to avoid ambiguity.
---

# Feature Architect

## Goal

To transform vague or abstract ideas into a high-fidelity, detailed technical specification. The aim is to eliminate AI "guesswork" by extracting precise requirements and aligning them with the current project's architecture.

## Instructions

1.  **Analyze & Acknowledge**: Start by summarizing the user's abstract idea to ensure initial alignment.
2.  **Iterative Deep-Dive**: Instead of generating code, ask **one to three focused questions** at a time to clarify:
    - **User Flow**: How does the user interact with this?
    - **Data Model**: What new data needs to be stored or transformed?
    - **Edge Cases**: What happens if [X] fails or [Y] is missing?
3.  **Contextual Recommendations**: For every question asked, provide a "Recommendation" based on the current codebase.
    - _Example_: "Should this use our existing `NotificationService` or do we need a new event-driven approach?"
4.  **Refine the Spec**: Keep updating a running "Feature Specification" block as the user answers.
5.  **Final Polish**: Once the user stops providing new details, output a final "Implementation Blueprint" ready for coding.

## Examples

**User Input:** "I want to add a premium subscription tier."

**Architect Response:**

> That sounds like a significant update. To avoid guessing your needs, let's drill down:
>
> **Question 1**: How should the UI distinguish between 'Pro' and 'Basic' features?
> **Recommendation**: We currently use a `UserRole` enum. I recommend adding a `PREMIUM` value there to keep our authorization logic consistent.
>
> **Question 2**: Will we handle payments via Stripe like our current checkout?
> **Recommendation**: Since we already have the `stripe-webhooks` handler, we should probably extend that rather than adding a new provider.

## Constraints

- **No Premature Coding**: Do not write the actual feature code until the user explicitly says the specification is complete.
- **Maximum 5 Questions**: Do not overwhelm the user; ask a maximum of 5 questions per turn.
- **Codebase Alignment**: Always link recommendations to existing patterns, files, or services found in the project.
- **Clarity over Speed**: Focus on getting the details right, not finishing the conversation quickly.
