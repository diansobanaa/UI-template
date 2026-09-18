# AGENTS PROJECT RULES & OPERATIONAL MANDATES

This repository contains automated rules and directives for all AI coding assistants (Gemini, Antigravity, Claude, Codex, Cursor, etc.).

## Authoritative Instructions
1. **Primary Agent Instructions:** Follow all directives in [GEMINI.md](file:///d:/template/GEMINI.md).
2. **Documentation Governance Rule:** Follow the canonical documentation policy detailed in [.agents/rules/DOCUMENTATION_MANDATE.md](file:///d:/template/.agents/rules/DOCUMENTATION_MANDATE.md).
   - Any modification to code, firmware, GPIO pins, hardware wiring, electrical domains, safety interlocks, API contracts, or UI behaviors that materially changes documented behavior **MUST BE REFLECTED IN THE RELEVANT CANONICAL MARKDOWN (.md) DOCUMENT(S)**.
   - `docs/` is the single canonical project documentation directory.
   - Do not create, copy, or maintain duplicate Markdown documentation under `esp32/docs/` solely for synchronization.
3. **Safe-Point & Handover Protocol:** Always record progress and verify safe points in [AI_PROGRESS.md](file:///d:/template/AI_PROGRESS.md) and [AI_HANDOVER.md](file:///d:/template/AI_HANDOVER.md).
