# AI Guidelines for Blinds App Development

> [!IMPORTANT]
> All AI assistants contributing to this repository MUST read and adhere to these guidelines before proposing or executing any code changes.

## 1. Zero Unsafe Policy
Memory safety is the highest priority in Blinds App.
- **Rule**: Do NOT use `unsafe` blocks under any circumstances.
- **Rationale**: We prioritize safety and stability over micro-optimizations that require bypassing Rust's borrow checker. If a task seems to require `unsafe`, find a safe alternative using higher-level abstractions or libraries.

## 2. Mandatory Documentation (///)
All new code must be self-documenting for both humans and future AI contexts.
- **Rule**: Every new `pub mod`, `pub struct`, `pub enum`, and `pub fn` MUST include triple-slash (`///`) doc-comments.
- **Format**: English comments only. Clear technical explanation is mandatory.

## 3. Persistent Knowledge Base (.md)
To maintain architectural continuity across different sessions and AI assistants:
- **Rule**: All newly added features and system improvements (small/large) MUST be added IMMEDIATELY to the `knowledge/history/engine_features.md` file.
- **Rule**: All bug fixes, crash solutions, stability patches, and fixes MUST be added IMMEDIATELY to the `knowledge/history/bug_fixes.md` file.
- **Rule**: This is NOT a RECOMMENDATION, it is a NECESSITY! If you do not update the `history/engine_features.md` or `history/bug_fixes.md` files (depending on the type of change made) after completing the process, you will have violated the rule.
- **Rule**: For every significant feature or refactor, a corresponding `.md` file must be created or updated in the `knowledge/` directory.
- **Rule**: If you modify existing code structures, you MUST update the related documentation in the `knowledge/` folder to reflect the changes immediately.
- **Rule**: Before starting work, the AI ​​must search and read relevant files in the `knowledge/` directory (especially those inside `knowledge/history/`) to understand the existing logic, patterns, and resolved issues.

## 4. Modular Responsibility
Blinds App follows a strict modular architecture.
- **Rule**: Keep `main.rs` thin.
- **Rule**: Delegate logic to specialized modules (e.g., `engine.rs`, `editor.rs`, `render/`, etc.).
- **Rule**: Do not create "God Objects" that manage multiple disconnected responsibilities.

## 5. Verification Standards
- **Rule**: Always run `cargo check` after any structural change to ensure zero errors and zero warnings.
- **Rule**: Avoid placeholders. If an asset is needed, generate or use a real representative file.

# Blinds App AI Constitutional Guidelines (v2026)

- **Vibe Coding & API Accuracy**: AI can never rely on old training data when doing vibe coding. Rust projects must base their API documentation on current libraries like winit 0.30, wgpu 23+ (2026 stable cycle), and egui 0.34, and write code according to these modern standards (option spirals, new struct fields: `depth_slice`, `multiview_mask`, `cache`).
- **Safety**: Strict avoidance of `unsafe` blocks. Blinds App is 100% safe Rust.
- **Documentation**: Implement every major change you make into the code and relevant .md files using `///`. The AI ​​should read its own past .md reports every time it starts a job.
- **Modularization**: Files should not exceed 800 lines. Keep the logical separation clean.
- **Zero-Error Policy**: The project's compile state should always aim for 0 errors / 0 warnings.

## 6. Strict File Boundary Enforcement

- **Rule**: Existing module boundaries are ABSOLUTE and MUST NOT be changed.
- **Rule**: DO NOT merge files, collapse modules, or move logic between modules unless explicitly instructed.
- **Rule**: Each module has a SINGLE responsibility and must remain isolated.
- **Rule**: If a task requires changes across multiple modules, modify them individually — NEVER combine them.

- **Violation Condition**:
If an AI merges modules, combines files, or centralizes logic into a single file, the solution is INVALID.

## 7. Scope Isolation Rule

- **Rule**: AI must ONLY modify the explicitly requested file or module.
- **Rule**: Expanding scope beyond the requested area is FORBIDDEN.
- **Rule**: No "improvements", "refactors", or "optimizations" outside the given scope.

- **Example**:
If asked to fix a bug in `translate.rs`:
→ ONLY modify `translate.rs`
→ DO NOT touch `render.rs`, `input.rs`, or other modules

- **Violation Condition**:
If AI modifies unrelated modules, the answer is INVALID.

## 8. No Implicit Refactor Rule

- **Rule**: Refactoring is ONLY allowed when explicitly requested.
- **Rule**: AI must NOT reorganize, restructure, or rewrite code unless instructed.

- **Forbidden Actions**:
- Combining multiple modules into one
- Moving logic "for readability"
- Changing architecture without explicit permission

- **Allowed**:
- Minimal, localized fixes

## 9. Architecture Preservation Rule

- **Rule**: The current architecture is considered STABLE and must be preserved.
- **Rule**: AI must treat the codebase as a production system, not a prototype.

- **Priority Order**:
1. Stability
2.Modularity
3.Readability
4.Performance

- **Rule**:
If a change risks breaking architecture, it must NOT be applied.

## 10. Small Function Rule

- **Rule**: Functions should remain small and focused (ideally <100 lines).
- **Rule**: If a function grows too large, split it into smaller helper functions.

- **Forbidden**:
- Large monolithic functions
- Multi-responsibility functions

- **Goal**:
AI-friendly, low-context code.

## 11. Multi-Module Coordination Rule

- **Rule**: When working across multiple modules: 
1. Analyze all modules 
2. Propose a plan 
3. Wait for confirmation 
4. Then implement

- **Rule**: Direct multi-module changes without planning are FORBIDDEN.
## 12. Anti-God Object Rule

- **Rule**: No struct may exceed a reasonable scope of responsibility.
- **Rule**: Large structs must be decomposed into smaller sub-systems.

- **Forbidden**:
- Centralized "manager" objects controlling everything
- Overloaded state containers (God Objects)

- **Goal**:
Composable systems with clear boundaries.

## 13. AI Behavior Lock

- AI must NOT assume missing context.
- AI must NOT "improve" unspecified areas.
- AI must NOT take initiative beyond instructions.

- If uncertain:
→ ASK instead of modifying code.

## 14. Single Responsibility Per File (SRP)

- **Rule**: Every single `.rs` file must have ONE specific, clearly defined responsibility and execute it exceptionally well.
- **Rule**: If a file manages pipelines, it should NOT manage uniform buffers or input.
- **Goal**: Strict adherence to SOLID principles, ensuring maximum maintainability and predictability. The "One File, One Task" architecture ensures that bugs are deeply localized.

## 15. Memory Bank Rule (REQUIRED)

Blinds App uses a persistent `memory-bank/` folder as the long-term project memory for all AI assistants.

- **Rule**: Before starting any task, the AI ​​MUST read all existing files inside the `memory-bank/` folder.
- **Rule**: `projectbrief.md` is the source of truth for project scope, goals, and core requirements.
- **Rule**: `activeContext.md` MUST reflect the current focus, recent changes, next steps, active decisions, and important learnings.
- **Rule**: `progress.md` MUST track what works, what is left to build, current status, known issues, and the evolution of project decisions.
- **Rule**: `systemPatterns.md` MUST document architecture, technical decisions, design patterns, component relationships, and critical implementation paths.
- **Rule**: `techContext.md` MUST document technologies, dependencies, development setup, technical constraints, and tool usage patterns.
- **Rule**: `productContext.md` MUST document why the project exists, what problems it solves, how it should work, and user experience goals.

### Required Memory Bank Structure

The following files are required:

```txt
memory-bank/ 
projectbrief.md 
productContext.md 
activeContext.md 
systemPatterns.md 
techContext.md 
progress.md
```
## 16. Documentation Quality Score Rule (REQUIRED)

Blinds App does not accept low-quality `///` documentation comments. Documentation must be useful for humans, future AI assistants, and long-term maintenance.

- **Rule**: Every new or modified `pub mod`, `pub struct`, `pub enum`, `pub trait`, `pub fn`, and important public field MUST have a documentation quality score.
- **Rule**: The AI ​​MUST internally evaluate every `///` doc-comment with a score from `0/10` to `10/10`.
- **Rule**: Any documentation below `8/10` is considered unacceptable and MUST be improved before the task is completed.
- **Rule**: The AI ​​MUST prefer clear technical explanations over vague comments.
- **Rule**: Documentation must explain purpose, responsibility, constraints, and usage when relevant.
- **Rule**: Documentation must NOT simply repeat the item name.

### Documentation Score Meaning

```txt
0/10 = Missing documentation.
1/10 = Useless placeholder comment.
2/10 = Extremely vague and not technically helpful.
3/10 = Mostly repeats the item name.
4/10 = Mentions purpose but lacks useful context.
5/10 = Basic explanation, but incomplete.
6/10 = Understandable but missing constraints, behavior, or usage notes.
7/10 = Good enough for humans, but not strong enough for long-term AI context.
8/10 = Acceptable: clear purpose, behavior, and relevant context.
9/10 = Strong: explains purpose, behavior, constraints, and integration context.
10/10 = Excellent: future-proof, precise, technically rich, and useful for AI/human maintenance.
```

## 17. Copyright and SPDX Header Rule (REQUIRED)

- **Rule**: Every project source file (e.g., `.rs`, `.wgsl` files) MUST begin with the following exact two-line header: 
```rust 
// SPDX-License-Identifier: GPL-3.0-only 
// Copyright (c) 2026 AethelisDEV / Blinds App. All rights reserved. 
```
- **Rule**: When creating a new `.rs` or `.wgsl` source file, this header must be prepared at the very top.
- **Rule**: AI assistants and developers MUST preserve this header during any modifications or refactoring.
- **Rule**: If a file is updated in a subsequent year (e.g., 2027, 2028, etc.), the copyright year in the header should be updated to reflect the active year or year range (e.g., `2026-2027` or `2026-2028`).
