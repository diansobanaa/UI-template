# AI REMEDIATION MATRIX V1

| Finding | Status | Root Cause | Remediation Group | Priority | Dependencies | Decision | Physical Check | Safe Point |
|---------|--------|------------|-------------------|----------|-------------|----------|-----------------|------------|
| BS-NET-001 | CONFIRMED | RC3 | RG-NET-TIME | P0 | RG-HW-INIT | DECISION-002 | None | SP-REMED-002 |
| BS-HW-001 | CONFIRMED | RC2 | RG-HW-INIT | P0 | None | DECISION-001 | None | SP-REMED-001 |
| BS-HW-002 | CONFIRMED | RC2 | RG-HW-INIT | P0 | None | DECISION-001 | None | SP-REMED-001 |
| BS-HW-003 | CONFIRMED | RC2, RC3 | RG-HW-INIT | P0 | None | None | None | SP-REMED-001 |
| BS-HW-004 | CONFIRMED | RC2 | RG-SAFETY-HW | P0 | RG-HW-INIT | None | Relay Polarity | SP-REMED-003 |
| BS-HW-005 | CONFIRMED | RC2 | RG-SAFETY-HW | P0 | RG-HW-INIT | None | Snubber Presence | SP-REMED-003 |
| BS-SAFE-001 | CONFIRMED | RC4 | RG-STATE | P1 | None | None | None | SP-REMED-004 |
| BS-SAFE-002 | CONFIRMED | RC2 | RG-SAFETY-HW | P0 | RG-HW-INIT | None | Float Wiring | SP-REMED-003 |
| BS-CMD-001 | CONFIRMED | RC1, RC4 | RG-CMD | P1 | RG-STATE | None | None | SP-REMED-005 |
| BS-CMD-002 | CONFIRMED | RC4 | RG-CMD | P1 | RG-STATE | None | None | SP-REMED-005 |
| BS-SCHED-001 | CONFIRMED | RC1, RC5 | RG-SCHED | P2 | RG-CMD, RG-NET-TIME | None | None | SP-REMED-006 |
| BS-UI-001 | CONFIRMED | RC1 | RG-UI | P1 | RG-CMD | None | None | SP-REMED-007 |
| BS-UI-002 | CONFIRMED | RC1 | RG-UI | P1 | RG-CMD | None | None | SP-REMED-007 |
| BS-CLOCK-001 | CONFIRMED | RC3 | RG-NET-TIME | P0 | RG-HW-INIT | None | DS3231 Battery | SP-REMED-002 |
| BS-CLOCK-002 | CONFIRMED | RC5 | RG-NET-TIME | P1 | RG-NET-TIME (driver) | None | None | SP-REMED-002 |
| BS-CC-001 | CONFIRMED | RC5 | RG-STATE | P1 | None | None | None | SP-REMED-004 |
| BS-SENS-001 | CONFIRMED | RC2 | RG-SAFETY-HW | P0 | RG-HW-INIT | None | None | SP-REMED-003 |
| BS-TOP-001 | CONFIRMED | RC5 | RG-SCHED | P2 | None | DECISION-003 | None | SP-REMED-006 |
| BS-CONT-002 | CONFIRMED | RC1 | RG-CMD | P1 | None | None | None | SP-REMED-005 |
| BS-TEST-001 | CONFIRMED | RC1 | RG-TEST | P1 | RG-NET-TIME | None | Live ESP32 Setup | SP-REMED-009 |
| BS-SEC-001 | CONFIRMED | RC5 | RG-SEC | P2 | RG-UI | DECISION-004 | None | SP-REMED-008 |
| BS-SYS-001 | CONFIRMED | RC5 | RG-SCHED | P1 | None | None | None | SP-REMED-006 |
| BS-SYS-002 | CONFIRMED | RC5 | RG-SCHED | P1 | None | None | None | SP-REMED-006 |
| BS-MEM-001 | CONFIRMED | RC5 | RG-STATE | P1 | None | None | None | SP-REMED-004 |
| BS-MEM-002 | CONFIRMED | RC4 | RG-STATE | P1 | None | None | None | SP-REMED-004 |
| BS-TELE-001 | CONFIRMED | RC4 | RG-STATE | P1 | None | None | None | SP-REMED-004 |
| BS-CC-003 | CONFIRMED | RC5 | RG-SCHED | P1 | None | None | None | SP-REMED-006 |
| BS-API-001 | CONFIRMED | RC5 | RG-CMD | P1 | None | None | None | SP-REMED-005 |
