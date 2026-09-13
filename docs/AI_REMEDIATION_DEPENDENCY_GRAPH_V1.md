# AI REMEDIATION DEPENDENCY GRAPH V1

```mermaid
graph TD
    %% Hardware Foundation
    HW[RG-HW-INIT: Pins & SPI]
    
    %% Core Drivers
    NT[RG-NET-TIME: Network & RTC]
    SHW[RG-SAFETY-HW: Safety Interlocks & Sensors]
    
    HW --> NT
    HW --> SHW
    
    %% State & Memory
    ST[RG-STATE: Persistence & Memory]
    
    %% API & Commands
    CMD[RG-CMD: Async Commands]
    
    NT --> CMD
    ST --> CMD
    
    %% Advanced Logic
    SCH[RG-SCHED: Scheduler & Topology]
    
    CMD --> SCH
    NT --> SCH
    
    %% UI & External
    UI[RG-UI: UI Alignment]
    SEC[RG-SEC: Authentication]
    TST[RG-TEST: E2E Test Strategy]
    
    CMD --> UI
    UI --> SEC
    NT --> TST
```

### Explanations:
- **RG-HW-INIT** is the foundation. Without safe pins and SPI initialized, network (if SPI-based) and safety (actuator pins) cannot function correctly.
- **RG-NET-TIME** provides the time dependency (RTC) required by the Scheduler (**RG-SCHED**).
- **RG-STATE** provides NVS persistence required by the Command Queue (**RG-CMD**) for idempotency and safe storage.
- **RG-CMD** establishes the true async API boundary, which **RG-UI** depends on (it needs the `postCommand` interface to exist).
- **RG-SCHED** requires **RG-CMD** to actually execute the tasks it schedules.
- **RG-SEC** should be layered on after the UI and Commands are aligned to avoid blocking early testing.
