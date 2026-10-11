# AGENTS PROJECT RULES & OPERATIONAL MANDATES

This repository contains automated rules and directives for all AI coding assistants (Gemini, Antigravity, Claude, Codex, Cursor, etc.).

## Authoritative Instructions
1. **Primary Agent Instructions:** Follow all directives in [GEMINI.md](file:///d:/template/GEMINI.md).
2. **Documentation Governance Rule:** Follow the canonical documentation policy detailed in [.agents/rules/DOCUMENTATION_MANDATE.md](file:///d:/template/.agents/rules/DOCUMENTATION_MANDATE.md).
   - Any modification to code, firmware, GPIO pins, hardware wiring, electrical domains, safety interlocks, API contracts, or UI behaviors that materially changes documented behavior **MUST BE REFLECTED IN THE RELEVANT CANONICAL MARKDOWN (.md) DOCUMENT(S)**.
   - `docs/` is the single canonical project documentation directory.
   - Do not create, copy, or maintain duplicate Markdown documentation under `esp32/docs/` solely for synchronization.
3. **Safe-Point & Handover Protocol:** Always record progress and verify safe points in [AI_PROGRESS.md](file:///d:/template/AI_PROGRESS.md) and [AI_HANDOVER.md](file:///d:/template/AI_HANDOVER.md).
4. **Code Minimalism (Ponytail Rule):** Follow lazy senior developer directives in [.agents/rules/PONYTAIL_RULES.md](file:///d:/template/.agents/rules/PONYTAIL_RULES.md). Avoid over-engineering, unnecessary dependencies, and boilerplate. Always follow the 7-step decision ladder (YAGNI, reuse, stdlib, platform, existing deps, one-line, minimum code).
5. **Multi-PC GitHub Bridge & Portability:** Follow cross-machine directives in [AI_COLLABORATION_INSTRUCTIONS.md](file:///c:/Users/lenovo/.gemini/antigravity-ide/scratch/UI-template/AI_COLLABORATION_INSTRUCTIONS.md). Never hardcode machine-specific file paths or drive letters into committed code or scripts. Configure local paths strictly via `scripts/esp32_env.local.ps1`.
