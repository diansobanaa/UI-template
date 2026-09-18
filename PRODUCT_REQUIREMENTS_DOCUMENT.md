# PRODUCT REQUIREMENTS DOCUMENT (PRD)

## AgroTech Greenhouse Fertigation, Regulation, Telemetry & Research Platform

**Document type:** Product Requirements Document

**Document purpose:** Define the intended product, operating model, capabilities, functional requirements, non-functional requirements, and real-world workflows that the AgroTech system must support.

**Critical principle:** This PRD describes **what the product is and what it must be able to do**. It is not a codebase-status report. Whether a requirement is already implemented, partially implemented, mocked, or not yet implemented belongs in a separate **Project Implementation Status / Gap Report**.

---

# 0. Executive Product Definition

AgroTech is a greenhouse automation and research platform designed to operate a greenhouse fertigation complex as a **locally autonomous physical system**, while providing a web interface for configuration, supervision, research tracking, telemetry, calibration, and operational control.

The system is designed around a hierarchy:

```text
Complex
├── Greenhouse 1
├── Greenhouse 2
├── Greenhouse N
└── Shared resources
```

One ESP32 controller acts as the **local regulator and physical authority for one Complex**. A Complex may contain one or many Greenhouses (GHs).

A Complex with only one GH is allowed to operate in a **single-GH topology** that avoids unnecessary multi-GH distribution hardware. This is a deployment simplification, not a fundamental product limitation. The architecture must support multi-GH operation from the beginning.

The product's core operational objective is:

> **Deliver the right amount of water and nutrients to the right greenhouse, at the right time, safely and repeatably, while remaining capable of local operation when the network or cloud/backend is unavailable.**

The platform also exists to turn greenhouse production into a measurable process by associating fertigation, environmental telemetry, crop-cycle information, plant/fruit observations, and harvest outcomes into a coherent historical record.

---

# 1. Product Vision

## 1.1 Vision

AgroTech should become a scalable control and research platform for greenhouse production in which:

- one controller can autonomously operate an entire Complex;
- the same architecture scales from one GH to many GHs;
- the operator can configure production rules without continuously supervising the controller;
- fertigation is volumetric, calibrated, repeatable, and eventually feedback-controlled;
- safety decisions are enforced locally at the physical controller;
- network loss does not automatically stop autonomous operation;
- power loss is handled explicitly with a backup-power strategy appropriate to the irrigation system;
- every important physical operation can be measured, logged, and audited;
- crop-cycle and research data are tied to actual operating conditions;
- the system remains understandable and diagnosable by technicians;
- configuration changes are controlled, versioned, validated, and recoverable.

## 1.2 Product Philosophy

The product should follow these principles:

### Local physical authority

The ESP32 is authoritative over the immediate physical state of the Complex, including safety, actuator state, timing, and execution of the last valid configuration.

### Backend as configuration and ecosystem authority

The backend manages configuration, data processing, historical storage, cross-complex management, and the overall ecosystem. The backend does not need to be continuously available for the ESP32 to perform normal autonomous regulation using its last valid configuration.

### Safety closer to hardware

A safety decision that must prevent physical damage must be enforceable locally by the ESP32, not depend only on a web UI or internet connection.

### Configuration as a complete version

A new operational configuration is treated as a complete configuration snapshot rather than a collection of partially applied changes. When a new valid configuration is deployed to a Complex, the active configuration is replaced atomically.

### Hardware scalability without architectural rewrites

Adding GH-2 or GH-N should be a provisioning/configuration event, not a redesign of the controller architecture.

### Measurable agriculture

The platform should connect operational data to plant outcomes so that the system can eventually support research and optimization rather than merely act as a remote timer.

---

# 2. Goals

## 2.1 Primary Goals

1. Automate greenhouse fertigation.
2. Maintain deterministic local control at the Complex controller.
3. Support one-to-many greenhouse topology from the architectural foundation.
4. Manage recipes and calibrated dosing.
5. Manage irrigation and pump schedules.
6. Provide reliable sensor telemetry and historical records.
7. Protect pumps and irrigation hardware through local safety checks.
8. Provide emergency-stop capability.
9. Survive network loss without losing autonomous control.
10. Handle power-loss and restoration explicitly.
11. Provide calibration workflows.
12. Track crop cycles, plants, fruits, observations, and harvest outcomes.
13. Provide operators and technicians with clear operational visibility.
14. Provide a foundation for future closed-loop EC/pH control.

## 2.2 Secondary Goals

- Reduce manual measurement and timing errors.
- Make configuration reproducible across GHs.
- Enable expansion to additional GHs and Complexes.
- Reduce the cost and hardware complexity of unnecessary large isolation valves where the hydraulic/emitter design already provides the required shutoff behavior.
- Provide complete event history for troubleshooting and research.

---

# 3. Non-Goals

The following are not the primary purpose of the platform, although integrations may be added later:

- general farm ERP unrelated to greenhouse operation;
- accounting and financial management;
- generic CRM;
- autonomous agronomic decision-making without defined agronomic rules/data;
- replacing qualified electrical, hydraulic, or safety engineering;
- guaranteeing plant yield or crop outcomes.

---

# 4. Product Scope

The product encompasses the following domains.

## 4.1 Complex Management

A Complex is the top-level operational unit controlled by one local ESP32 regulator.

A Complex contains:

- one or more Greenhouses;
- shared water resources;
- shared nutrient resources where applicable;
- shared pumping infrastructure;
- local controller configuration;
- schedules;
- safety policies;
- telemetry and event streams.

## 4.2 Greenhouse Management

Each GH is an independently identifiable operational unit within a Complex.

Each GH may have:

- its own mixing tank;
- its own irrigation/distribution path;
- its own fertigation recipes or recipe assignments;
- its own schedule set;
- its own crop cycle;
- its own environmental telemetry;
- its own observations and production history.

## 4.3 Fertigation

The platform shall support:

- raw-water filling;
- nutrient dosing;
- pH-up dosing;
- pH-down dosing;
- multiple nutrient/salt dosing channels;
- mixing;
- delivery to the target GH;
- calibrated dosing;
- safety checks;
- event recording;
- manual and scheduled execution.

The intended dosing architecture permits up to **7 dosing channels** in the current product concept:

```text
Dosing 1 → pH Up
Dosing 2 → pH Down
Dosing 3 → Salt/Nutrient 1
Dosing 4 → Salt/Nutrient 2
Dosing 5 → Salt/Nutrient 3
Dosing 6 → Salt/Nutrient 4
Dosing 7 → Salt/Nutrient 5
```

The architecture should remain scalable by logical pump name and configuration rather than hardcoding only A/B semantics.

## 4.4 Irrigation Delivery

The irrigation network is intended to use pressure-operated, no-drain emitters such as the selected Rivulis Supertif PCND configuration. The product should therefore manage pump pressure and flow as part of the irrigation system rather than assuming a large solenoid valve is always required merely to prevent post-shutdown drainage.

The final hydraulic implementation shall be validated against emitter opening/sealing pressure, line loss, elevation, filter loss, and the actual pump curve.

## 4.5 Scheduling

The scheduler encompasses:

- fertigation schedules;
- raw-water/well-pump schedules;
- fan schedules;
- manual execution;
- fallback schedules;
- day-of-week schedules;
- specific-date schedules;
- interval schedules;
- time-of-day scheduling;
- resource-aware command execution.

## 4.6 Climate/Fan Control

The product shall support fan operation in:

- manual on/off mode;
- scheduled mode;
- automatic temperature-based mode;
- operational humidity-removal workflows where configured.

## 4.7 Monitoring & Telemetry

The intended monitoring layer includes, where corresponding sensors are installed:

- temperature;
- relative humidity;
- light intensity;
- water level;
- raw-water flow;
- fertigation flow;
- dosing output/calibration;
- pump/actuator state;
- electrical/system status;
- fault and event information.

## 4.8 Crop Research Tracking

The platform shall track:

- crop cycle;
- planting date;
- pollination date;
- harvest date;
- HST;
- HSP;
- plant identity;
- fruit identity;
- plant count;
- mortality/death records;
- fruit progress;
- plant progress;
- observations;
- yield;
- fruit weight;
- grade;
- average weight and other derived production metrics.

## 4.9 Calibration

Calibration shall cover the equipment and sensors for which physical measurement is required to make control decisions reliable.

At minimum the product design includes:

- dosing-pump volumetric calibration;
- flow-meter calibration;
- water-level calibration;
- temperature/humidity sensor calibration/configuration;
- pH calibration;
- EC calibration.

---

# 5. Product Architecture

## 5.1 Logical Layers

```text
                    ┌─────────────────────────────┐
                    │       React / Next.js       │
                    │  Operator + Research UI    │
                    └──────────────┬──────────────┘
                                   │ REST/JSON
                    ┌──────────────▼──────────────┐
                    │       Python Backend        │
                    │ Config / Data / Ecosystem   │
                    └──────────────┬──────────────┘
                                   │ REST/JSON
                    ┌──────────────▼──────────────┐
                    │      ESP32-S3 Complex       │
                    │ Local Regulator + Safety    │
                    └──────────────┬──────────────┘
                                   │
               ┌───────────────────┼───────────────────┐
               │                   │                   │
            Sensors            Actuators            Storage
```

## 5.2 ESP32 Responsibilities

The ESP32 shall:

- hold the last valid active configuration;
- execute schedules locally;
- execute fertigation sequences;
- control physical actuators;
- read local sensors;
- enforce local safety checks;
- enforce emergency stop;
- manage local timers/state machines;
- maintain local operational time;
- log events and telemetry locally as required;
- continue autonomous operation when the backend is unavailable;
- upload locally retained records after connectivity is restored where supported;
- provide the physical API boundary used by the backend/UI.

## 5.3 Backend Responsibilities

The Python backend shall:

- manage Complex/GH configuration;
- manage recipes and operational configuration;
- manage users/roles where introduced;
- validate configuration before deployment;
- maintain configuration versions;
- distribute configuration to the correct ESP32;
- store telemetry history;
- store event history;
- store crop/plant/fruit research data;
- provide query and reporting services;
- reconcile field data after offline periods;
- maintain the cross-Complex product view.

The backend is not required to execute the physical control loop in real time.

## 5.4 Frontend Responsibilities

The web UI shall:

- present Complex and GH hierarchy;
- configure operational parameters;
- display telemetry and history;
- control manual operations subject to safety policy;
- manage crop cycles;
- manage recipes;
- manage schedules;
- manage calibration workflows;
- present events/errors;
- present configuration/deployment status;
- provide an intuitive operational interface for field use.

A lightweight HTML/JS field interface may also be provided for direct/local use without requiring a Node runtime, including an offline-capable operational UI when appropriate.

---

# 6. Complex and Multi-Greenhouse Model

## 6.1 Complex as Controller Boundary

One ESP32 controls one Complex.

A Complex may contain:

- GH-1;
- GH-2;
- GH-3;
- ...;
- GH-N.

The controller architecture must not encode GH-1 as a permanent universal identity.

## 6.2 Single-GH Fallback Topology

When a Complex contains only one GH, the system may use a simplified hydraulic topology.

Example:

```text
Single GH Complex

Raw Water ───────────→ GH-1 Mixing Tank
Nutrient Sources ────→ GH-1 Mixing Tank
GH-1 Mixing Tank ────→ Distribution
```

No multi-GH distribution valve tree is required solely because the architecture supports multi-GH.

## 6.3 Multi-GH Topology

When GH-2 or additional GHs are registered, the Complex shall be capable of routing resources to the appropriate GH mixing tank.

Conceptually:

```text
                     COMPLEX
                        │
                Shared Resource Layer
                        │
          ┌─────────────┼─────────────┐
          │             │             │
       Raw Water     Nutrient A    Nutrient B/N...
          │             │             │
          └─────────────┼─────────────┘
                        │
               Distribution/Route
                        │
           ┌────────────┴────────────┐
           │                         │
        GH-1                       GH-2 ... GH-N
           │                         │
      Mixing Tank               Mixing Tank
```

The actual hardware topology may use valves, pumps, shared lines, or dedicated lines according to the Complex configuration.

## 6.4 GH Independence

A GH-specific operation should be addressed by a stable GH identity and should not require changing firmware source code.

A recipe, schedule, crop cycle, telemetry stream, and event must be attributable to its GH.

## 6.5 Multi-GH Concurrency

The controller shall use **resource-aware concurrency**:

- commands using the same exclusive resource shall be serialized;
- independent GH distribution operations may run simultaneously when their physical paths are independent;
- shared dosing pumps, shared sources, shared valves, or other exclusive resources shall create resource locks/queues as required;
- the scheduler shall never start an operation whose required resource set is already occupied by an incompatible operation.

---

# 7. Configuration Model

## 7.1 Configuration as Active Snapshot

The ESP32 shall operate from one active, valid configuration snapshot for the Complex.

Configuration includes, as applicable:

- Complex identity;
- GH list;
- hardware mapping;
- pump definitions;
- dosing pump definitions;
- valve definitions;
- sensor definitions;
- mixing configuration;
- irrigation configuration;
- recipe definitions;
- schedule definitions;
- calibration values;
- safety limits;
- fallback policies;
- power-failure policies;
- communication configuration.

## 7.2 Schedule Validation and Compilation

Schedules are user-facing operational intent, but only schedules that have been fully validated and compiled against the active Complex configuration may become executable schedules on the ESP32.

Before a schedule can be activated, the system shall validate at minimum:

- the target Complex and GH identity;
- the requested action and its parameters;
- all required component types;
- the actual installed component registry;
- resource assignment and ownership;
- required physical routing/topology;
- required sensors and safety dependencies;
- mutual resource conflicts with other active schedules;
- schedule recurrence and time parameters;
- configuration compatibility with the target ESP32.

The validation process shall then **compile** the schedule into an executable form containing the resolved resources and operational dependencies required at runtime.

### Schedule activation states

A schedule shall have an explicit activation state. At minimum:

- **DRAFT** — being created or edited and not yet executable.
- **VALIDATING** — being checked against the current configuration.
- **ACTIVE** — validated, compiled, deployed successfully, and eligible for local ESP32 execution.
- **BLOCKED** — user intent exists, but one or more required resources, assignments, routing conditions, or dependencies are unavailable.
- **DISABLED** — intentionally turned off by the user or system policy.
- **INVALID** — configuration or parameters fail validation and cannot be compiled.

A schedule in **BLOCKED**, **INVALID**, **DRAFT**, or **DISABLED** state shall never be sent to the ESP32 as an executable **ACTIVE** schedule.

### Resource-less schedules

If the requested operation requires a component or resource that is not installed, not assigned to the target GH/Complex, physically routed elsewhere, or otherwise unavailable, the schedule shall remain **BLOCKED** rather than being silently accepted as executable.

The system shall expose the reason for the blocked state in the UI, including the missing or conflicting resource and the action required from the user when such an action can resolve the condition.

Example:

```text
GH-03 Fan Schedule
Status: BLOCKED
Reason: No fan resource is assigned to GH-03.
Available action: Assign or physically transfer an installed fan to GH-03.
```

### Compilation and deployment boundary

The ESP32 runtime scheduler shall operate only on the **last successfully validated and compiled configuration**. Runtime scheduling must not repeatedly perform complex resource discovery or infer physical topology from incomplete schedules.

When a resource assignment, component installation, physical routing declaration, safety dependency, or other configuration affecting a schedule changes, affected schedules shall be revalidated/recompiled before they can remain **ACTIVE**.

If recompilation makes an existing schedule impossible to execute, the schedule shall transition to **BLOCKED** and the ESP32 shall receive the updated configuration only after the new configuration has been validated as a whole.

---

## 7.3 Atomic Configuration Replacement

A configuration update shall be treated as a complete version.

Required behavior:

1. Receive candidate configuration.
2. Validate schema.
3. Validate semantic relationships.
4. Validate resource availability/conflicts.
5. Validate hardware compatibility.
6. Persist candidate safely.
7. Mark candidate as active only after successful validation/persistence.
8. Replace the previous active configuration atomically.
9. Roll back to the previous valid configuration if activation fails.

## 7.4 Configuration Versioning

Each configuration shall have:

- version identifier;
- creation/update timestamp;
- source/deployment identifier;
- validation result;
- activation status.

## 7.5 Operational Rule

A change to a Complex configuration is not considered active merely because the UI accepted it. The system must confirm successful deployment to the ESP32.

If deployment fails, the UI must show the failure and preserve/revert the previous known-good configuration state.

---

# 8. Fertigation System

# 8.1 Purpose

The fertigation engine shall produce a controlled nutrient solution and deliver it to a selected GH with repeatable quantities and timing.

## 8.2 Fertigation Inputs

A fertigation operation may include:

- target GH;
- recipe;
- raw-water volume;
- nutrient/pH dosing volumes;
- mixing time;
- delivery target/mode;
- safety limits;
- execution trigger;
- schedule context.

Canonical internal liquid quantity shall use **mL** for dosing values. The UI may display liters and/or mL for usability, but conversion to the canonical unit must be deterministic.

## 8.3 Fertigation State Machine

The intended state machine is:

```text
IDLE
  ↓
PRECHECK
  ↓
FILLING
  ↓
DOSING
  ↓
FINAL_MIXING
  ↓
DELIVERY
  ↓
COMPLETE
```

Any state may transition to:

```text
INTERRUPTED / FAULTED / ABORTED
```

according to safety or operator actions.

## 8.4 Precheck

Before starting a batch, the controller shall verify, as configured:

- target GH exists;
- recipe/configuration exists and is valid;
- no incompatible fertigation run is active;
- required pumps are available;
- required sensors are valid;
- required source/tank resources are available;
- emergency stop is not active;
- required calibration is available or an explicitly defined fallback policy applies;
- safety limits are satisfied.

## 8.5 Filling Phase

The controller shall:

1. select the target GH mixing tank;
2. activate the raw-water source/pump;
3. measure incoming water using the configured flow/volume sensor;
4. stop at the configured target volume;
5. abort on configured timeout/failure conditions.

The system should prefer measured volume to pump runtime when a flow measurement is available.

## 8.6 Dosing Phase

For each enabled dosing channel:

1. determine the requested quantity;
2. obtain its calibrated rate;
3. calculate required runtime;
4. enforce minimum/maximum runtime limits;
5. run the dosing pump;
6. record the actual commanded operation;
7. stop at completion or on fault.

The dosing architecture shall support the current concept of up to seven logical dosing pumps and shall be configurable by name rather than permanently assuming only A/B chemistry.

## 8.7 Mixing Phase

After dosing, the system shall mix the solution for the configured mixing duration.

The mixing duration must be configurable in the product design rather than intrinsically fixed to one hardcoded value.

## 8.8 Delivery Phase

The system shall deliver the mixed solution to the selected GH irrigation network.

Delivery should be governed by a measurable target whenever appropriate, such as:

- delivered volume;
- flow-derived quantity;
- pressure/flow criteria;
- configured duration as fallback where no reliable volume measurement is available.

The product shall distinguish between:

- **mixed solution volume**, and
- **volume actually delivered to the crop**.

They are not assumed to be identical.

## 8.9 Precision Fertigation

“Precision fertigation” is a product requirement, not an assertion that every precision mechanism is already implemented.

Precision means the system is designed to provide controlled and repeatable:

- raw-water quantity;
- nutrient quantity;
- pH correction quantity;
- timing;
- mixing;
- irrigation delivery;
- calibration;
- record keeping.

Future/advanced precision layers may include:

- EC measurement;
- pH feedback;
- closed-loop nutrient correction;
- adaptive dosing;
- measured delivery volume;
- recipe adjustment based on measured water conditions.

These capabilities belong in the PRD regardless of their current project status.

---

# 9. Recipe Management

## 9.1 Recipe Purpose

A recipe represents an operational fertigation specification for a GH/crop context.

A recipe may include:

- name;
- target GH or applicable GH set;
- raw-water target;
- dosing quantities for each nutrient/pH channel;
- target EC where enabled;
- target pH where enabled;
- mixing duration;
- delivery target;
- applicable crop/crop phase;
- effective date/version;
- notes.

## 9.2 Recipe Immutability During Execution

A running fertigation batch shall operate from a **snapshot of the recipe/configuration at execution start**. Editing the recipe while the batch is running must not mutate the active batch unexpectedly.

## 9.3 Recipe Versioning

Recipe revisions should be versioned so that a historical fertigation event can identify which recipe version was used.

---

# 10. Dosing Pump Management

## 10.1 Logical Pump Registry

Dosing pumps must be represented as configurable logical resources, for example:

```text
id: dosing-ph-up
name: pH Up
channel: 1
calibration: ...

id: dosing-nutrient-1
name: Calcium Nitrate
channel: 3
calibration: ...
```

The product shall not be structurally limited to exactly two dosing pumps.

## 10.2 Calibration

The product shall provide a volumetric calibration workflow.

Typical workflow:

1. Technician selects dosing pump.
2. Technician places a measuring vessel at the outlet.
3. System runs the pump for a controlled calibration interval.
4. Technician measures the dispensed volume.
5. System calculates mL/sec.
6. The calibration value is validated and stored.
7. Future dosing calculations use the stored rate.

## 10.3 Calibration Validation

Calibration values shall have:

- valid range;
- unit;
- timestamp;
- calibration operator/technician if identity tracking is available;
- optional notes;
- validity status.

The system shall not silently use an arbitrary calibration value when precision is required. Any emergency fallback must be explicit, logged, and configurable.

---

# 11. Irrigation Hydraulics

## 11.1 Emitter Strategy

The intended irrigation system uses pressure-compensating no-drain emitters, with the selected Rivulis Supertif configuration in the approximate 4 L/h class and a two-way outlet/split arrangement where used.

The key design requirement is:

> The irrigation network must reach the emitter opening/operating pressure while running and fall below the sealing condition when intentionally stopped, without depending on a large solenoid valve solely for anti-drain behavior when the selected emitter's no-drain characteristics are sufficient.

## 11.2 Pressure Requirement

The control system shall be designed around measured/validated pressure at the relevant hydraulic point, not pump marketing specifications alone.

Required design inputs include:

- pump curve;
- maximum head;
- flow at operating point;
- static elevation;
- pipe diameter/length;
- filter loss;
- fitting/manifold loss;
- emitter count;
- emitter operating pressure;
- emitter sealing pressure;
- simultaneous irrigation zones.

## 11.3 Pump Boosting

Where required, two booster pumps may be operated in series to increase available head.

The final design shall validate:

- pump compatibility with series operation;
- pressure at pump 2 inlet;
- maximum allowed pump inlet pressure;
- resulting flow;
- system pressure at the most remote emitter;
- overpressure protection.

The product should not assume that two pumps in series automatically produce exactly double pressure.

## 11.4 Pressure Monitoring

A pressure sensor or pressure gauge should be available at a strategically selected point for commissioning and troubleshooting and may be integrated into telemetry where appropriate.

---

# 12. Water Management

## 12.1 Water Sources

The Complex may include:

- well/source water;
- raw-water tank;
- nutrient/source tanks;
- one mixing tank per GH;
- delivery network.

## 12.2 Well Pump

The product shall support:

- manual control;
- scheduled operation;
- runtime limits;
- tank-full interlock;
- level/radar input;
- fault handling;
- event logging.

## 12.3 Raw Tank Protection

The system shall prevent filling when the raw-water tank is already at or above its configured safety threshold.

A typical policy may use a high-level threshold such as 95%, but the exact threshold should be configurable.

## 12.4 Transfer to Mixing Tank

The system shall support transfer of raw water into the selected GH mixing tank according to the active configuration.

In a single-GH deployment the routing can be direct.

In a multi-GH deployment the routing layer shall select the target mixing tank.

---

# 13. Valve and Routing Strategy

## 13.1 Hardware Abstraction

Valves shall be represented as logical resources where the physical hydraulic design requires them.

The software should not permanently assume that every installation has the same number of valves.

## 13.2 Single-GH Simplification

When only one GH exists, unnecessary distribution valves may be omitted while preserving the same logical resource model.

## 13.3 Multi-GH Routing

Once multiple GHs exist, the routing system shall support source-to-target allocation for:

- raw water;
- nutrient sources;
- mixing tanks;
- delivery paths.

The controller must prevent mutually incompatible valve states and must apply a safe state on fault/emergency stop.

---

# 14. Pump Control

The system shall support configurable pump resources including:

- well pump;
- raw-water/submersible pump;
- mixing pump;
- distribution/booster pump;
- dosing pumps;
- other future pumps.

Every pump resource shall have:

- logical ID;
- physical output mapping;
- enabled/disabled state;
- allowed operating modes;
- maximum runtime;
- startup delay if required;
- stop behavior;
- safety conditions;
- fault behavior;
- manual override policy.

Manual operation shall require:

- valid command;
- permission/role as applicable;
- safety checks;
- runtime limit;
- emergency-stop check;
- resource conflict check.

---

# 15. Fan and Climate Control

## 15.1 Manual Fan Control

The operator shall be able to turn a configured fan on/off manually subject to safety policy.

## 15.2 Time-Based Fan Schedule

The operator may schedule fan operation for:

- a defined start time;
- a defined duration;
- recurring days;
- specific dates;
- interval schedules.

## 15.3 Temperature-Based Fan Control

The product shall support automatic fan logic using thresholds such as:

```text
ON when temperature >= onAboveC
OFF when temperature <= offBelowC
```

The implementation shall prevent rapid toggling through appropriate hysteresis/debounce policy.

## 15.4 Operational Purpose

Climate automation may be used for:

- morning humidity removal;
- cooling;
- heat-load reduction;
- maintaining a defined environmental range.

The exact rules are configured rather than assumed to be universal.

---

# 16. Sensor System

The product shall provide a common sensor abstraction covering:

- pH;
- EC;
- temperature;
- relative humidity;
- light intensity;
- water level;
- flow rate/flow pulses;
- pressure where installed;
- future sensors.

Each sensor definition shall include:

- logical ID;
- sensor type;
- unit;
- sampling interval;
- calibration data;
- validity range;
- fault detection;
- source/channel;
- last known value;
- timestamp;
- quality/status.

The system shall distinguish:

- valid measurement;
- stale measurement;
- invalid measurement;
- disconnected sensor;
- out-of-range measurement.

---

# 17. Monitoring and Telemetry

## 17.1 Real-Time Monitoring

The operator shall be able to view current values for configured sensors and actuator states.

## 17.2 Telemetry

Telemetry shall be time-stamped and attributable to:

- Complex;
- GH;
- device/controller;
- sensor/channel.

## 17.3 Historical Curves

The product shall provide historical views for relevant signals, including selectable windows such as:

- 24 hours;
- 7 days;
- 30 days;
- configurable/custom intervals where the data layer supports it.

Potential historical signals include:

- temperature;
- humidity;
- light;
- water level;
- flow;
- pressure;
- pump operation;
- dosing activity;
- environmental and fertigation events.

## 17.4 Data Quality

Historical views shall not silently treat missing samples as real zero values.

The UI should make data gaps or stale data distinguishable from true measurements.

---

# 18. Event and Audit System

The system shall create events for important operational conditions, including:

- fertigation started;
- fertigation completed;
- fertigation interrupted;
- pump started/stopped;
- schedule triggered;
- schedule skipped;
- emergency stop;
- emergency stop released;
- sensor fault;
- flow timeout;
- tank-full protection;
- configuration deployed;
- configuration rejected;
- power failure;
- power restored;
- calibration changed;
- communication lost/restored;
- watchdog or abnormal reset where detectable.

Each event should include:

- event ID/type;
- timestamp;
- Complex ID;
- GH ID where applicable;
- severity;
- source;
- message/details;
- relevant command/configuration ID;
- associated sensor/actuator/resource.

---

# 19. Scheduling System

## 19.1 Schedule Types

The product shall support:

1. Manual.
2. Daily.
3. Selected days of week.
4. Specific date.
5. Repeating interval.
6. Fallback/default schedule.
7. Condition-based schedule where supported, such as temperature-based fan control.

## 19.2 Schedule Targets

Schedules may control:

- fertigation;
- well/raw-water pump;
- fan;
- future configured actuators.

## 19.3 Schedule Definition

A schedule includes:

- schedule ID;
- target GH/Complex;
- action type;
- action parameters;
- start date/time;
- recurrence;
- enabled state;
- priority;
- validity period;
- fallback behavior;
- timezone context.

## 19.4 Local Execution

The ESP32 shall evaluate **only ACTIVE, validated, and compiled schedules** locally using its local time source and last valid configuration.

A schedule that has not passed validation and compilation shall not be treated as executable runtime work. In particular, the ESP32 shall not be required to discover missing components, determine ownership, or infer physical routing at the moment a schedule becomes due. Those relationships shall already be resolved in the validated configuration deployed to the controller.

The backend does not have to be online at the scheduled execution moment.

### 19.4.1 Blocked schedules

When a schedule cannot be compiled because a required resource is unavailable, the schedule shall be stored/represented as **BLOCKED**, together with a machine-readable blocked reason and, where applicable, the missing/conflicting resource.

A BLOCKED schedule shall not be dispatched by the ESP32 scheduler. It remains user-visible so the operator can understand why the intended operation cannot currently be executed.

When the underlying resource/configuration condition changes, the system shall revalidate and recompile the affected schedule. Only after successful compilation and deployment may it transition to **ACTIVE** again.

## 19.5 Missed Schedule Policy

The system shall define a policy for missed schedules caused by:

- reboot;
- power failure;
- controller downtime;
- conflicting resource usage.

The policy may include:

- skip;
- execute immediately upon recovery;
- execute within an allowed recovery window;
- mark as missed.

The selected policy must be explicit per schedule type where necessary.

## 19.6 Queueing and Resource Conflicts

Commands shall be queued when required.

The scheduler must never assume that all actions can run simultaneously.

Example:

```text
Shared dosing pump → exclusive
Mixing tank GH-1 → exclusive
Distribution GH-1 → independent from GH-2 when hydraulically independent
```

The resource manager decides whether an operation:

- starts immediately;
- waits in queue;
- is rejected;
- is merged/deduplicated.

---

# 20. Offline Operation

## 20.1 Network Independence

Normal autonomous greenhouse operation must not depend on continuous backend connectivity.

When the backend or network is unavailable, the ESP32 shall continue using the last valid local configuration for:

- schedules;
- active control rules;
- safety;
- crop-cycle local state where applicable;
- fertigation execution already authorized locally.

## 20.2 Offline Data Retention

Events and telemetry generated while disconnected shall be retained locally where storage permits.

When connectivity returns, the controller shall upload unsynchronized records and mark them as synchronized to prevent duplicate ingestion.

## 20.3 Configuration During Offline Period

A disconnected UI must not give the operator false confidence that a new configuration was deployed.

Configuration changes made while offline must be clearly marked as:

- locally staged;
- not deployed;
- pending deployment;
- successfully deployed.

---

# 21. Power Failure and Backup Power

## 21.1 Product Objective

Power loss is not treated merely as a controller reboot problem.

Because the irrigation system uses pressure-operated no-drain emitters, a power outage can prevent irrigation if the delivery pump cannot run. Therefore the backup-power design must consider the **physical irrigation load**, not only the ESP32.

## 21.2 Automatic Source Selection

The power subsystem shall support:

- PLN as the preferred source when available;
- automatic switchover to backup battery when PLN is lost;
- automatic return to PLN when restored;
- automatic battery charging while PLN is available;
- automatic charging cutoff or charge-management when the battery reaches its safe full condition;
- no intentional use of battery while healthy PLN is available, except as required by the charging/power-path topology.

## 21.3 Seamless Controller Continuity

The ESP32 and other critical loads must remain powered during source transition without a software reboot.

The source transfer shall be handled by a hardware power-path/UPS architecture capable of switching before the critical DC bus falls below the controller's minimum operating voltage.

The ESP32 shall not be responsible for physically switching the power path in a way that depends on its own continued operation.

## 21.4 Backup Load Prioritization

The battery system should support at minimum the loads needed to maintain fertigation when required, including:

- controller;
- necessary sensors;
- necessary control electronics;
- irrigation pump(s) required to maintain pressure;
- required dosing pumps;
- required valves/actuators.

Non-critical loads such as unnecessary fans or displays may be shed to extend runtime.

## 21.5 Power Events

The system shall record:

- power failure detected;
- backup mode entered;
- low battery;
- critical battery condition;
- PLN restored;
- charging started;
- charging completed/limited;
- backup source fault.

## 21.6 Recovery Behavior

After power recovery, the controller shall:

- remain or return to a safe actuator state as defined by the power/recovery policy;
- restore valid configuration;
- reconstruct persistent operational state;
- evaluate missed schedules according to schedule policy;
- avoid blindly repeating an interrupted fertigation batch;
- resume autonomous control.

A running fertigation batch must have an explicit recovery policy. It must not be accidentally resumed from an unsafe intermediate stage merely because the controller rebooted.

---

# 22. Safety System

Safety is a core product capability and is enforced locally.

## 22.1 Safe Boot

On startup, all safety-critical actuators shall enter a known safe state before normal control tasks can operate them.

## 22.2 Emergency Stop

The system shall provide a global Emergency Stop.

When activated:

- physical actuators covered by the emergency policy shall be forced to their safe state;
- new conflicting commands shall be rejected;
- active sequences shall be interrupted according to the safety policy;
- the stop condition shall be latched;
- recovery requires explicit resume/reset according to policy.

The product should distinguish between:

- logical command shutdown;
- actuator disable;
- physical power isolation.

These are not automatically the same thing.

## 22.3 Flow/Dry-Run Protection

For pumps that fill or transfer water, the controller shall detect lack of expected flow.

A typical rule is:

```text
Pump ON
    ↓
Flow monitoring
    ↓
No flow for configured timeout
    ↓
Stop pump
    ↓
Abort/interlock
    ↓
Create fault event
```

The timeout must be configurable per pump/system where practical.

## 22.4 Tank-Level Interlocks

The well/raw-water pump shall not run when the target tank is at or above its high-level safety threshold.

The system shall also support low-level protection where required to prevent downstream pumps from running without sufficient source water.

## 22.5 Maximum Runtime

Every pump/actuator capable of causing physical damage if left on shall have a maximum runtime limit.

## 22.6 Sensor Validity

A safety-critical control decision shall not blindly trust a sensor value marked invalid/stale/faulted.

The fallback behavior must be explicitly defined.

---

# 23. Error Handling

Errors shall be modeled consistently across UI, backend, and firmware.

## 23.1 Error Categories

Examples:

- configuration invalid;
- configuration deployment failure;
- resource unavailable;
- sensor invalid;
- no flow;
- tank full;
- tank empty;
- pump timeout;
- emergency stop active;
- command rejected;
- schedule conflict;
- calibration invalid;
- communication timeout;
- storage failure;
- clock failure;
- actuator fault;
- power failure;
- battery low.

## 23.2 Error Record

Each error should identify:

- error code;
- severity;
- trigger;
- source;
- Complex/GH;
- affected resource;
- action taken;
- recovery state;
- whether retry is allowed;
- whether operator intervention is required.

## 23.3 Recovery Classes

Use explicit recovery classes:

- automatic retry;
- automatic fallback;
- queued for later;
- operator acknowledgement;
- operator reset;
- emergency stop;
- maintenance required.

---

# 24. Command System

Commands represent requests to operate or configure the physical system.

## 24.1 Command Requirements

Each command should contain:

- command ID;
- type;
- target Complex/GH;
- parameters;
- creation timestamp;
- source;
- configuration version/context.

## 24.2 Idempotency

Commands that could be retried by the UI/backend shall be idempotent where repeated execution could cause physical harm or duplicate dosing.

The controller shall recognize duplicate command IDs and avoid double-execution.

## 24.3 Authorization of Physical Commands

Before execution, the controller shall verify:

- valid command;
- allowed state;
- target exists;
- resource available;
- safety conditions satisfied;
- emergency stop not active.

---

# 25. Crop Cycle Management

## 25.1 Crop Cycle Entity

A crop cycle represents one production cycle inside a GH.

At minimum:

- cycle ID;
- GH ID;
- planting date;
- pollination date;
- expected/actual harvest date;
- variety;
- plant count;
- mortality data;
- notes;
- yield;
- grade;
- cycle status.

## 25.2 Cycle States

```text
NO_CYCLE
   ↓
ACTIVE
   ↓
HARVESTED
```

Additional states may include:

- CANCELLED;
- ABANDONED;
- ARCHIVED.

## 25.3 HST and HSP

The system shall calculate and display:

- HST = days after planting;
- HSP = days after pollination.

The calculations must use the configured/local authoritative date and must remain correct across application restarts and controller restarts.

## 25.4 Cycle Workflow

```text
Start cycle
→ record planting metadata
→ monitor HST
→ record pollination
→ monitor HSP
→ record plant/fruit observations
→ harvest
→ record yield/grade
→ close/archive cycle
```

## 25.5 Cycle Import

Where field operations begin after planting, the operator should be able to import an already-running cycle with its known planting metadata and dates.

---

# 26. Plant and Fruit Research Tracking

The research layer shall be more granular than a crop-cycle calendar.

## 26.1 Plant

A Plant entity may include:

- Plant ID;
- cycle ID;
- GH ID;
- row/position;
- planting date;
- status;
- mortality date/reason;
- observations;
- associated fruit IDs.

## 26.2 Fruit

A Fruit entity may include:

- Fruit ID;
- Plant ID;
- pollination date;
- development status;
- harvest date;
- weight;
- grade;
- observations;
- abnormalities.

## 26.3 Observation

An Observation may include:

- observation ID;
- timestamp;
- plant/fruit/cycle/GH association;
- metric;
- value;
- unit;
- note;
- observer/source;
- optional photo/reference.

## 26.4 Research Queries

The system should eventually allow analysis such as:

- HST/HSP vs telemetry;
- fertigation history vs plant progress;
- nutrient recipe vs fruit weight;
- environmental conditions vs crop outcomes;
- plant mortality vs environmental/fertigation events;
- yield vs cycle conditions.

---

# 27. Telemetry Data Model

Telemetry should support both instantaneous data and derived operational events.

Conceptual model:

```text
Complex
  └── Greenhouse
        ├── Telemetry
        ├── Events
        ├── Crop Cycle
        │     ├── Plant
        │     └── Fruit
        └── Fertigation Runs
```

Telemetry fields should include:

- timestamp;
- GH/Complex/device association;
- metric ID;
- value;
- unit;
- quality;
- source;
- calibration/version metadata where relevant.

---

# 28. Fertigation Run Record

Every fertigation execution should produce a durable run record.

It should include:

- run ID;
- Complex ID;
- GH ID;
- trigger type;
- schedule ID if scheduled;
- recipe ID/version if used;
- configuration version;
- target water volume;
- target dosing quantities;
- actual measured water volume;
- actual dosing runtimes;
- calibration versions;
- start/end timestamps;
- phase timestamps;
- final status;
- fault/error if interrupted;
- operator/source.

This record is fundamental for operational troubleshooting and research.

---

# 29. Calibration Framework

## 29.1 Calibration Targets

The calibration subsystem shall support configurable calibration workflows for:

- dosing rate;
- flow meters;
- water-level sensors;
- pH sensors;
- EC sensors;
- temperature/humidity sensors where required.

## 29.2 Calibration Versioning

A calibration should be treated as data with lifecycle:

```text
Not Calibrated
→ Calibrated
→ Verified
→ Expired/Suspect
→ Recalibrated
```

## 29.3 Use of Calibration

Control logic shall explicitly identify which calibration record it used.

A historical run should therefore be reproducible enough to determine which calibration affected its dosing calculation.

---

# 30. User Interface Requirements

## 30.1 Global Navigation

The web application shall expose:

- dashboard/front page;
- Complex list;
- Greenhouse hierarchy;
- fertigation;
- schedule/timer;
- calibration;
- crop/research tracking;
- system/device information;
- events/errors.

## 30.2 Dashboard

The front page should provide:

- Complex/GH navigation;
- current environmental summary;
- key operational state;
- current fertigation state;
- important alarms;
- key trends/curves;
- operational shortcuts.

## 30.3 Complex Overview

The user shall be able to:

- view Complexes;
- add Complex;
- add GH;
- inspect shared resources;
- see GH children;
- enter a GH context.

## 30.4 GH Page

A GH page should provide:

- GH identity/info;
- current telemetry;
- crop-cycle status;
- HST;
- HSP;
- active fertigation state;
- next scheduled operation;
- quick operational actions.

## 30.5 Crop Cycle Timeline

The timeline should visually communicate:

- planting;
- vegetative period;
- flowering;
- fruiting;
- ripening;
- harvest;
- pollination/HSP milestones.

## 30.6 Fertigation Page

Fertigation should be a first-class page rather than being buried only inside a schedule drawer.

The page shall provide:

- GH selector;
- recipe selection;
- manual fertigation launch;
- target/quantity review;
- active batch progress;
- phase/status information;
- run history.

## 30.7 Schedule Page

The schedule/timer view should support:

- Complex selector;
- GH selector;
- one GH schedule context at a time for detailed editing;
- well-pump schedules;
- fan schedules;
- fertigation schedules;
- recurring and specific-date rules;
- enable/disable;
- conflict visibility.

## 30.8 Calibration Page

The calibration UI shall guide the technician through calibration step by step and show:

- target device;
- procedure;
- current calibration;
- test duration;
- measured result;
- calculated rate;
- validation;
- save/apply status.

## 30.9 Dark Mode

The product UI shall support a dark visual system suitable for operational use and long-duration monitoring.

Telemetry charts should remain legible against the dark dashboard background.

---

# 31. UI State and Transaction Behavior

CRUD operations involving the backend or ESP32 shall behave transactionally from the operator's perspective.

## 31.1 Optimistic/Server Confirmed Changes

The UI may use optimistic interaction for responsiveness, but a physical/configuration change is not final until the authoritative layer confirms success.

## 31.2 Rollback

If the backend or ESP32 rejects a requested change:

- UI state must revert to the authoritative prior state;
- the operator must receive an actionable error message;
- no false “saved” indication should remain.

## 31.3 Pending Deployment

Where a configuration is accepted by the UI/backend but has not yet reached the ESP32, the UI shall distinguish:

- saved in backend;
- queued for device;
- applied to device;
- failed on device.

---

# 32. API Requirements

The API layer shall cover at least:

## Device

- health;
- status;
- inventory;
- capabilities;
- context.

## Clock

- read clock;
- synchronize clock.

## Commands

- manual actuator commands;
- fertigation start/stop;
- emergency stop;
- resume/reset where applicable.

## Configuration

- configuration retrieval;
- configuration validation;
- configuration deployment;
- configuration activation;
- configuration version/status.

## Greenhouse

- Complex/GH CRUD;
- crop cycles;
- recipes;
- schedules;
- calibration;
- telemetry;
- events.

## API Principles

- versioned contracts;
- explicit schemas;
- explicit error codes;
- idempotent physical commands where required;
- no silent coercion of dangerous values;
- request validation;
- timeout/retry rules;
- traceable command IDs.

---

# 33. Device Inventory and Capability Discovery

The controller shall expose its known capabilities so the backend/UI can adapt to the actual installed hardware.

Capability discovery may include:

- number of dosing pumps;
- installed sensors;
- installed valves;
- fan availability;
- RTC availability;
- SD card/storage availability;
- Ethernet/W5500;
- supported schedule modes;
- firmware version;
- configuration version;
- hardware revision.

The UI should not present unavailable hardware as fully operable.

---

# 33A. Hardware Component Registry & Installable Hardware Model

## 33A.1 Principle

Every supported sensor, actuator, pump, valve, controller peripheral, and supporting hardware device shall be represented in the product as a **logical component definition**, regardless of whether that physical component has already been installed at a particular Complex.

The software implementation for supported components should exist as part of the product codebase before the physical hardware is installed. A physical installation is therefore a **configuration/provisioning operation**, not a request to rewrite firmware for each installation.

The product separates:

1. **Supported Component Definition** — what the product knows how to control/read.
2. **Installed Component Registration** — what is physically installed at a specific Complex.
3. **Component Wiring/Topology** — how the installed component is connected to other resources.
4. **Capability Availability** — what the currently installed topology allows the system to do.

## 33A.2 Component Registry

Each Complex shall maintain an installed-component registry represented as machine-readable configuration, persisted on the ESP32 and synchronized with the backend/UI.

The registry shall identify, at minimum:

- component ID;
- component type;
- user-defined name;
- logical role;
- hardware driver/type;
- physical channel or GPIO/interface;
- electrical characteristics where required;
- installed/enabled state;
- Complex/GH ownership;
- source/destination relationship;
- calibration reference where applicable;
- safety limits;
- capability contribution;
- topology/routing role;
- installation notes;
- configuration version.

The exact JSON schema is defined separately, but the core product rule is:

> **The ESP32 must know which supported components are actually installed from configuration, rather than assuming every supported component is physically present.**

## 33A.3 Super Administrator Hardware Management

A user with **Super Admin** permissions shall be able to:

- view supported component types;
- register a newly installed component;
- assign or change its logical name;
- enable/disable an installed component;
- associate it with a Complex/GH;
- configure its wiring/resource relationship;
- configure its hardware channel where permitted;
- enter or review calibration data;
- remove/decommission a component;
- deploy the resulting configuration to the ESP32;
- inspect configuration/deployment status.

Changing a component's human-readable name must not change its stable logical identity.

## 33A.4 Installation Guidance

The UI shall provide an installation guide for supported hardware.

For every supported component, the guide should include, where relevant:

- purpose;
- supported model/type;
- required power;
- wiring diagram;
- GPIO/channel assignment;
- polarity;
- interface type;
- pull-up/pull-down requirements;
- protection requirements;
- mounting notes;
- hydraulic connection notes;
- commissioning procedure;
- calibration procedure;
- safety warnings;
- verification test.

The guide exists before the component is installed physically, so a technician can use the product itself as the installation reference.

## 33A.5 Install Workflow

The intended field workflow is:

```text
Select Complex
    ↓
Open Hardware / Components
    ↓
Choose supported component type
    ↓
Read installation + wiring instructions
    ↓
Install and wire physical component
    ↓
Register component in UI
    ↓
Assign name / role / GH / resource
    ↓
Configure channel and parameters
    ↓
Run commissioning test
    ↓
Calibrate if required
    ↓
Save configuration
    ↓
Deploy configuration to ESP32
    ↓
ESP32 updates active component registry
    ↓
Capability set is recalculated
```

The system shall not regard a component as operational merely because an installation record exists. Commissioning/validation status must be distinguishable from registration.

## 33A.6 Component Availability States

A component may have states such as:

- SUPPORTED — the software knows how to use it;
- REGISTERED — installation exists in configuration;
- ENABLED — available for operation;
- DISABLED — intentionally unavailable;
- NOT_COMMISSIONED — registered but not verified;
- FAULTED — installed but unavailable due to fault;
- REMOVED — decommissioned.

The scheduler and command system shall use the **operationally available** component set rather than merely the existence of a component definition.

---

# 33B. Capability-Driven Operating Model

## 33B.1 Product Principle

The system shall not depend on a small number of rigid operating modes such as "single GH mode" or "multi GH mode".

Instead, the operational capability of a Complex is derived from:

```text
Installed Components
+ Physical Topology
+ Resource Ownership
+ GH Configuration
+ Calibration
+ Safety State
+ Active Schedules
= Available Operational Capabilities
```

This allows a partially equipped Complex to remain useful without pretending that unavailable automation exists.

## 33B.2 Minimum Initial Complex Capability

At the moment a Complex is created, the only mandatory operational actuator/resource required by the product is:

> **A fertigation/delivery pump associated with the mixing-tank output path.**

This allows the simplest real installation to operate using manually prepared AB nutrient solution.

Other components may be added incrementally.

## 33B.3 Progressive Installation

A Complex may begin with:

```text
Complex
└── GH-1
    └── Mixing Tank
        └── Fertigation / Distribution Pump
```

The operator can later install/register:

- well/raw-water pump;
- raw-water level/radar sensor;
- flow meter;
- dosing pumps;
- pH/EC sensors;
- valves;
- fans;
- pressure sensors;
- additional mixing infrastructure;
- additional GH-specific hardware.

Adding hardware increases the automation capabilities available to the scheduler and UI.

## 33B.4 Manual Resource Preparation

The product must support operational paths where some preparation step remains manual.

Examples:

### Manual AB Mixing

The operator prepares AB nutrient solution and places it in the target GH mixing tank.

The system then controls the fertigation/distribution pump according to schedule.

### Manual Raw-Water Filling

If no automatic raw-water pump is installed, the operator fills the mixing tank manually.

The system can still schedule the subsequent fertigation/delivery operation if all resources required for that operation are available.

### Incremental Instrumentation

Sensors can be installed later without changing the base architecture. Once registered and commissioned, the system can expose the corresponding measurements and safety/control capabilities.

---

# 33C. Fertigation Capability Levels

The product shall treat fertigation as a set of capabilities rather than one binary feature.

## 33C.1 Level 1 — Manual Nutrient Preparation + Scheduled Delivery

Required capability:

- mixing tank exists;
- fertigation/distribution pump exists.

Operator workflow:

```text
Operator prepares AB mix manually
        ↓
Places solution in GH mixing tank
        ↓
System executes fertigation pump schedule
        ↓
Water/nutrient solution is delivered to GH
```

No dosing pumps or automatic raw-water preparation are required.

## 33C.2 Level 2 — Automatic Raw-Water Filling + Manual Nutrient Preparation

Required additional capability:

- raw-water pump;
- appropriate source/tank routing;
- required level/flow safety hardware where configured.

Workflow:

```text
Schedule
 ↓
Fill selected mixing tank with raw water
 ↓
Operator provides nutrient/AB preparation as configured
 ↓
Fertigation pump delivers solution
```

## 33C.3 Level 3 — Automatic Dosing + Automatic Filling

Required capability may include:

- raw-water pump;
- dosing pumps;
- required source routing;
- flow/level sensing;
- mixing/delivery hardware.

Workflow:

```text
Schedule
 ↓
Fill
 ↓
Dose
 ↓
Mix
 ↓
Deliver
```

## 33C.4 Level 4 — Feedback-Controlled Precision Fertigation

Additional capabilities may include:

- EC sensor;
- pH sensor;
- measured delivery flow/volume;
- pressure measurement;
- closed-loop control logic.

The product shall be able to evolve from Level 1 to Level 4 without changing the Complex/GH identity model.

---

# 33D. Single-GH and Multi-GH Topology

## 33D.1 Single-GH Fallback

A Complex with only one GH may operate using direct connections without installing distribution valves that have no operational purpose in the one-GH topology.

Example:

```text
             COMPLEX
                │
        ┌───────┴────────┐
        │                │
    Raw Water         Nutrient Source
        │                │
        └───────┬────────┘
                ↓
             GH-1
          Mixing Tank
                ↓
        Fertigation Pump
                ↓
            Irrigation
```

This is a **topology optimization/fallback**, not a restriction of the software's GH model.

## 33D.2 Multi-GH With Proper Routing Hardware

When a Complex contains multiple GHs and routing valves are installed, the system shall represent source-to-target paths explicitly.

Example:

```text
                     COMPLEX
                        │
                Shared Sources
                        │
                Routing Layer
              ┌─────────┼─────────┐
              ↓         ↓         ↓
             GH-1      GH-2      GH-N
              │         │         │
           Mixing     Mixing    Mixing
            Tank       Tank      Tank
```

Each GH can then have independent schedules to the extent that the physical resources permit.

## 33D.3 Multi-GH Without Routing Valves

A multi-GH Complex may exist before all routing hardware is installed.

In this situation the system shall recognize that the physical resource path is **shared/manual**, not magically independent.

The product shall therefore distinguish:

- GH configured;
- GH hydraulically reachable;
- GH automatically routable;
- GH manually routable;
- GH currently selected as the shared/manual target.

---

# 33E. Manual Hose / Shared Resource Routing

## 33E.1 Purpose

Some partially equipped installations may have multiple GHs but insufficient valves to route a shared pump/source automatically.

The product shall support a **manual-routing operating condition** instead of treating the second GH as permanently unusable.

## 33E.2 Example: Two GHs, No Distribution Valves

Suppose a Complex has:

- GH-1;
- GH-2;
- dosing pumps;
- raw-water pump;
- one shared source path;
- no automatic distribution valves.

The system can still represent both GHs.

However, the automatic routing capability is limited to the currently connected physical path.

## 33E.3 Manual Routing Ownership

When the operator selects GH-1 as the active manual routing target:

```text
Shared hose/source
      ↓
    GH-1
```

GH-1 may use the shared automatic dosing/raw-water sequence if all other requirements are satisfied.

GH-2 shall not simultaneously be treated as automatically reachable through the same shared resource.

If the operator physically moves the hose/path to GH-2:

```text
Shared hose/source
      ↓
    GH-2
```

the system must reassign **routing ownership** to GH-2.

The system must then prevent conflicting GH-1 schedules from using the same shared resource.

## 33E.4 Scheduling Rules for Manual Routing

The scheduler must validate the physical topology before allowing a schedule to be created or activated.

Example:

### GH-1

Automatic dosing schedule:

`06:00 → Dose → Mix → Deliver`

Allowed when GH-1 is the current routing target.

### GH-2

If no valve exists, a second independent automatic dosing schedule must not be presented as simultaneously executable.

The UI shall state clearly:

> **GH-2 does not have an automatic routing valve. To run dosing for GH-2, the shared dosing/raw-water hose must be physically moved to GH-2 and GH-2 must become the active routing target. While GH-2 owns this shared route, conflicting GH-1 automatic dosing operations are unavailable.**

## 33E.5 Schedule Activation vs Schedule Storage

The system may store a GH-2 schedule even if its physical route is currently unavailable, provided the UI clearly marks it as:

- configured;
- awaiting route hardware;
- awaiting manual route selection;
- blocked by current topology.

However, a blocked schedule must not execute silently.

At execution time, the scheduler must revalidate:

- target GH;
- required hardware;
- current route ownership;
- safety state;
- resource availability.

If unavailable, the schedule is skipped/blocked according to the schedule failure policy and an event is recorded.

## 33E.6 GH Page Route Warning

When a GH uses manual/shared routing, the GH page shall show an explicit operational warning.

Example:

> **Manual routing required**
>
> Ensure the shared dosing/raw-water hose is physically connected to **GH-2 mixing tank** before this schedule runs.
>
> Current route owner: **GH-2**.

The warning must identify the actual selected GH and shared resource.

## 33E.7 Physical Confirmation

Where practical, the UI may provide an operator confirmation step:

```text
I confirm that the shared hose is connected to GH-2.
```

The confirmation is an operator statement, not proof of physical routing unless a routing sensor exists.

The system must clearly state that limitation.

---

# 33F. General Resource Dependency Engine

The manual-routing example is one instance of a broader rule.

Every automated action shall be represented as a set of **required resources/capabilities**.

Example:

```text
Automatic GH-2 fertigation
    requires:
    - GH-2 exists
    - mixing tank GH-2 exists
    - delivery pump available
    - raw-water path available OR manual water prepared
    - dosing path available if automatic dosing is requested
    - required valves if automatic routing is required
    - required sensors if safety policy requires them
    - no conflicting route ownership
    - emergency stop inactive
```

The scheduler must evaluate this dependency set.

A feature should not fail merely because one optional component is absent when an alternative manual workflow exists.

Conversely, the system must reject or block an operation when a **mandatory dependency for that specific mode** is absent.

## 33F.1 Capability Calculation

For each GH, the product shall be able to derive a capability state such as:

```text
CAN_DELIVER
CAN_AUTO_FILL
CAN_AUTO_DOSE
CAN_AUTO_MIX
CAN_AUTO_ROUTE
CAN_MONITOR_FLOW
CAN_MONITOR_LEVEL
CAN_MONITOR_EC
CAN_MONITOR_PH
CAN_CLIMATE_CONTROL
CAN_RUN_AUTONOMOUSLY
```

These are capabilities, not fixed operating modes.

## 33F.2 Example Capability States

### GH-1

```text
Fertigation pump: installed
Dosing pumps: installed
Raw-water pump: installed
Routing valves: absent

Capabilities:
✓ manual delivery
✓ automatic delivery
✓ automatic dosing
✓ automatic raw-water fill
✓ full automatic fertigation
✓ shared manual routing
```

### GH-2

```text
Fertigation pump: installed
Dosing path: shared
Raw-water path: shared
Routing valves: absent

Capabilities:
✓ scheduled delivery when route is prepared
✓ manual AB mixing
✓ manual route ownership
✗ simultaneous independent automatic dosing
✗ automatic source routing
```

The exact matrix is computed from the actual registered topology rather than hardcoded by GH number.

---

# 33G. Component-Specific Dependency Policies

Different hardware components may create different rules.

The product architecture shall therefore support dependency policies per component type.

Examples:

## Dosing Pump

May require:

- calibration;
- nutrient source association;
- target GH route;
- mixing tank;
- runtime limit;
- no competing dosing operation.

## Raw-Water Pump

May require:

- source available;
- target tank available;
- level sensor or alternative safety policy;
- flow detection;
- route assignment.

## Distribution Pump

May require:

- target GH route;
- irrigation pressure/flow condition;
- mixing tank source;
- no conflicting distribution route.

## Fan

May require:

- fan component installed;
- temperature sensor for temperature-based control;
- schedule enabled for time mode.

## EC-Based Control

May require:

- EC sensor installed;
- valid calibration;
- valid recipe target;
- mixing/dosing resources;
- closed-loop controller enabled.

This model allows the product to grow without creating special-case firmware logic for every possible hardware combination.

---

# 33H. Configuration-Driven Hardware Software Architecture

The firmware shall contain drivers and control abstractions for every supported component type even when no physical instance is currently installed.

At boot/runtime, the firmware shall use the active component registry to determine which instances are enabled.

Example:

```text
Firmware contains:
- Flow Meter Driver
- EC Driver
- pH Driver
- Dosing Pump Driver
- Valve Driver
- Pressure Sensor Driver
- Fan Driver

Installed registry:
- Dosing Pump 1 = enabled
- Dosing Pump 2 = enabled
- EC Sensor = not installed
- pH Sensor = not installed
- Valve 1 = not installed
```

The absence of an installed component must not require recompiling the product merely to remove its driver.

Unused drivers must remain harmless and must not claim physical availability.

---

# 33I. JSON Component Configuration on ESP32

The installed hardware registry shall be serialized into JSON or a versioned equivalent representation that can be stored persistently on the ESP32.

The ESP32 shall load this registry during startup before enabling normal hardware-dependent automation.

The registry shall determine:

- which devices exist;
- which logical resources exist;
- which GH they belong to;
- which hardware channel they use;
- which capabilities are available;
- which schedules are valid;
- which dependencies can be satisfied.

The UI shall be able to retrieve the active registry and show it to authorized users.

Super Admin changes shall produce a new configuration version and deploy it through the configuration-management process.

---

# 33J. Hardware Commissioning

Every installed component should have a commissioning workflow appropriate to its type.

Examples:

### Pump

```text
Register pump
→ verify wiring
→ pulse/on test
→ verify direction/operation
→ optional flow verification
→ save
```

### Flow Meter

```text
Register sensor
→ verify pulses
→ compare known volume
→ calibrate
→ save
```

### Valve

```text
Register valve
→ verify wiring
→ open test
→ close test
→ verify feedback if available
→ save
```

### EC/pH Sensor

```text
Register sensor
→ wiring test
→ calibration
→ reading validation
→ save
```

The commissioning process shall be recorded as part of the hardware state.

---

# 33K. Hardware Naming

The product shall separate:

- stable component identity;
- technical component type;
- user-facing name.

Example:

```text
Stable ID: dosing-03
Type: DOSING_PUMP
Current name: Calcium Nitrate
```

The user may later rename it to:

```text
Name: Ca(NO3)2
```

The change must not break schedules, historical records, or relationships using the stable ID.

---

# 33L. Hardware Registry and Historical Data

Historical telemetry, events, and fertigation records should retain the stable component identity and configuration version used during the operation.

Renaming a component must therefore not destroy historical interpretation.

Example:

```text
2026-09-18
Component dosing-03
Name at time: Calcium Nitrate
Calibration v4
```

If the user later renames it, historical records remain associated with `dosing-03`.

---

# 33M. Product Rule for Partial Installations

The product shall treat a partially installed Complex as a valid operational configuration rather than as an invalid product state, provided the requested operation's dependencies can be satisfied.

The UI shall therefore tell the operator **what can be done now**, **what requires manual preparation**, and **what requires additional hardware**.

Example:

```text
GH-2

Available now:
✓ Scheduled fertigation delivery
✓ Manual AB preparation

Requires manual preparation:
⚠ Move shared hose to GH-2 before automatic dosing

Requires hardware:
✗ Independent automatic routing
  → Install GH-2 routing valve
```

This principle shall apply consistently to all supported hardware dependencies.

---

# 33N. Scheduling Principle for Partially Installed Systems

The scheduler should remain simple from the operator's perspective:

> **A schedule describes what should happen and when. The capability/dependency engine determines whether that action can currently be executed.**

Therefore the scheduler should not contain dozens of hardcoded installation modes.

Instead:

```text
Schedule
  ↓
Resolve target GH / Complex
  ↓
Resolve requested action
  ↓
Resolve required resources
  ↓
Check installed component registry
  ↓
Check current routing ownership
  ↓
Check safety
  ↓
Check resource conflicts
  ↓
Execute / Queue / Block / Skip
```

This is the general mechanism that handles:

- one GH vs many GHs;
- valves present vs absent;
- dosing installed vs absent;
- raw-water pump installed vs absent;
- manual AB mixing vs automated dosing;
- shared vs dedicated pumps;
- future sensor-dependent controls.

---

# 34. Time Management

Time is a control dependency.

The system shall support:

- RTC-based local time;
- boot-time synchronization;
- backend/UI synchronization;
- timezone configuration;
- timestamped events;
- schedule evaluation;
- HST/HSP calculation.

The controller should continue schedule execution from its local clock without requiring a network connection.

A failed clock synchronization must not erase the last valid local time.

---

# 35. Storage and Persistence

## 35.1 ESP32 Persistence

The controller shall persist at minimum the data required for autonomous recovery, such as:

- active configuration;
- configuration version;
- schedules;
- calibration values;
- crop-cycle state where local autonomy requires it;
- unsent events/telemetry;
- power/recovery state where necessary.

## 35.2 SD Card

An SD card may provide higher-volume local logging for:

- telemetry;
- events;
- fertigation runs;
- diagnostics;
- recovery history.

## 35.3 Persistence Reliability

Writes to safety-critical configuration should be atomic and corruption-tolerant.

The product shall define behavior for:

- storage full;
- storage corruption;
- partial write;
- version mismatch;
- invalid configuration data.

---

# 36. Firmware State and Recovery

The controller shall have explicit system states, including where relevant:

```text
BOOT
INITIALIZING
READY
RUNNING
FAULT
EMERGENCY_STOP
OFFLINE_AUTONOMOUS
POWER_BACKUP
RECOVERY
```

A detailed state machine shall define:

- allowed transitions;
- entry actions;
- exit actions;
- actuator policy;
- command policy;
- persistence behavior;
- recovery conditions.

---

# 37. Manual vs Automatic Control

The product shall clearly distinguish:

### Manual
Operator directly requests an action.

### Scheduled
Controller executes an action because a schedule is due.

### Automatic/Condition Based
Controller executes based on sensor or system conditions.

### Recovery
Controller executes because a previously interrupted/missed condition requires recovery.

The system shall log which mode caused every meaningful physical action.

---

# 38. Research and Analytics

The research layer should allow the product to move from “automation” to “learning from production.”

## 38.1 Core Questions

The system should eventually help answer:

- How much water was given to a crop?
- How much nutrient was delivered?
- At which HST/HSP stage?
- Under what temperature/humidity/light conditions?
- What recipe was used?
- What was the plant response?
- What was the resulting fruit weight/grade?
- What was the mortality rate?

## 38.2 Data Relationship

```text
Crop Cycle
   ↓
Plant / Fruit
   ↓
Observation
   ↕
Telemetry
   ↕
Fertigation Run
   ↕
Recipe / Calibration
```

This relationship is a core product differentiator and should influence the data model from the beginning.

---

# 39. Security and Integrity

The system shall protect physical control operations from accidental or unauthorized execution.

Requirements include:

- authenticated backend/API access where exposed;
- authorization for dangerous manual operations;
- configuration version integrity;
- command identity;
- audit trail;
- rejection of malformed commands;
- local safety enforcement independent of authentication state.

Security must not be designed in a way that makes the greenhouse unable to operate safely when the network is unavailable.

---

# 40. Observability and Diagnostics

A technician shall be able to determine:

- controller identity;
- firmware version;
- hardware inventory;
- active configuration version;
- current system state;
- current actuator states;
- sensor health;
- last errors;
- active schedule;
- current fertigation phase;
- power source;
- storage health;
- network status.

The boot diagnostic display may show essential identity/version information, but operational diagnostics should also be accessible through the API/UI.

---

# 41. Hardware Requirements Summary

The product architecture supports, as configured per Complex:

### Controller

- ESP32-S3.

### Networking

- Ethernet/W5500 and/or supported network interface.

### Storage

- internal non-volatile storage;
- optional SD card.

### Timekeeping

- DS3231 or equivalent RTC.

### Sensors

- pH;
- EC;
- temperature;
- humidity;
- light;
- water level/radar;
- flow;
- optional pressure.

### Actuators

- well pump;
- raw-water pump;
- mixing pump;
- distribution/booster pump;
- up to 7 dosing pumps;
- fan;
- valves where hydraulically required;
- status/error indicators.

Hardware availability is configuration-driven.

---

# 42. Electrical and Surge Protection Requirements

Because the greenhouse installation is exposed to an electrically harsh environment, the product installation shall include a layered power-protection strategy.

The intended architecture should consider:

```text
PLN
 ↓
Main protection
 ↓
Surge protection
 ↓
PSU / charger / power path
 ↓
12 V DC bus
 ↓
Branch protection
 ↓
Controller / sensors / pumps / valves
```

Requirements:

- AC surge protection appropriate to the installation;
- proper protective earth/grounding;
- short, low-impedance surge paths;
- DC transient protection for inductive loads;
- separate branch protection for pumps/actuators;
- battery protection and charger protection;
- correct separation between logic and high-current paths;
- no assumption that a single MOV inside a PSU is sufficient system-level lightning protection.

The exact electrical design must be validated for the installation.

---

# 43. Resource Model

Every physical action shall declare the resources it consumes.

Example:

```text
Fertigation GH-1
├── Raw water source
├── Mixing tank GH-1
├── Dosing pump set
├── Mixing pump
├── Distribution pump
└── GH-1 irrigation path
```

The resource manager shall be able to answer:

- Is this resource available?
- Is it already locked?
- Which operation owns it?
- Can another GH proceed concurrently?
- What happens if it becomes unavailable?

This resource model is essential for multi-GH scaling.

---

# 44. Operational Workflows

## 44.1 Configure a New Complex

```text
Create Complex
→ define identity
→ register hardware/resources
→ define water/nutrient sources
→ define GHs
→ define controller configuration
→ validate
→ deploy
→ verify device acceptance
```

## 44.2 Add First GH

```text
Create GH-1
→ assign mixing tank
→ assign sensors/actuators
→ define crop context
→ configure fertigation
→ configure schedules
→ deploy
```

No unnecessary multi-GH routing hardware is required merely because future GHs are possible.

## 44.3 Add GH-2

```text
Create GH-2
→ assign mixing tank
→ assign hydraulic route/resources
→ update Complex resource map
→ validate conflicts
→ deploy new complete configuration
→ verify GH-1 remains functional
→ verify GH-2 is addressable independently
```

## 44.4 Create Recipe

```text
Create recipe
→ define water quantity
→ define dosing channels
→ define optional pH/EC targets
→ define mixing/delivery rules
→ validate
→ publish version
```

## 44.5 Calibrate Dosing Pump

```text
Select pump
→ run calibration
→ measure output
→ calculate mL/sec
→ validate
→ save calibration
→ associate calibration version
```

## 44.6 Manual Fertigation

```text
Select GH
→ select recipe / direct quantities
→ precheck
→ fill
→ dose
→ mix
→ deliver
→ record result
```

## 44.7 Scheduled Fertigation

```text
Schedule becomes due
→ scheduler evaluates
→ resource check
→ safety check
→ snapshot recipe/config
→ execute fertigation
→ record run/event
```

## 44.8 Power Failure During Fertigation

```text
PLN lost
→ power-path switches to battery
→ controller stays alive
→ system enters backup policy
→ required irrigation loads remain available as configured
→ operation continues or is safely interrupted according to policy
→ event recorded
```

The system must not rely on software detection alone to complete the source switch.

## 44.9 Network Failure

```text
Backend unavailable
→ ESP32 retains last valid configuration
→ local schedules continue
→ local safety continues
→ events/data retained
→ connection restored
→ missed data synchronized
```

## 44.10 Emergency Stop

```text
Emergency Stop
→ immediately safe actuators
→ interrupt active sequence
→ latch stop
→ reject new commands
→ log event
→ explicit resume/reset
```

---

# 45. User Roles

## Operator/Farmer

Primary activities:

- monitor GHs;
- start/stop fertigation;
- inspect schedule;
- create/manage schedules;
- observe crop cycle;
- respond to alarms;
- trigger emergency stop;
- inspect run history.

## Technician

Primary activities:

- install devices;
- configure hardware;
- calibrate sensors/pumps;
- inspect diagnostic state;
- troubleshoot faults;
- validate hydraulic behavior;
- manage device configuration.

## Researcher

Primary activities:

- inspect crop cycles;
- compare HST/HSP with telemetry;
- record plant/fruit observations;
- analyze fertigation history;
- analyze yield/weight/grade;
- compare production cycles.

## Administrator

Primary activities:

- manage Complexes;
- manage users/access;
- manage system configuration;
- manage device provisioning;
- audit configuration/deployment history.

---

# 46. Product Requirements by Priority

The following are product requirements. They are **not implementation status labels**.

Priority meanings:

- **MUST** = required capability of the product.
- **SHOULD** = strong requirement; exceptions require deliberate design.
- **COULD** = useful extension.

## Architecture

- **PRD-ARCH-001 — MUST:** Support multiple GHs inside one Complex.
- **PRD-ARCH-002 — MUST:** Use one ESP32 local regulator per Complex.
- **PRD-ARCH-003 — MUST:** Permit single-GH simplified topology without redesigning the multi-GH architecture.
- **PRD-ARCH-004 — MUST:** Address GHs by configuration identity rather than firmware source-code hardcoding.
- **PRD-ARCH-005 — MUST:** Separate local physical control from backend/cloud availability.
- **PRD-ARCH-006 — MUST:** Support atomic configuration replacement and rollback.
- **PRD-ARCH-007 — SHOULD:** Support resource-aware concurrency between independent GH operations.

## Fertigation

- **PRD-FERT-001 — MUST:** Execute a complete fertigation sequence locally on the ESP32.
- **PRD-FERT-002 — MUST:** Support measured raw-water volume.
- **PRD-FERT-003 — MUST:** Support calibrated dosing runtime calculation.
- **PRD-FERT-004 — MUST:** Support at least seven logical dosing channels in the product model.
- **PRD-FERT-005 — MUST:** Support pH Up and pH Down as logical dosing channels.
- **PRD-FERT-006 — MUST:** Support five additional nutrient/salt channels in the current product concept.
- **PRD-FERT-007 — MUST:** Separate filling, dosing, mixing, and delivery states.
- **PRD-FERT-008 — MUST:** Enforce local safety checks before and during fertigation.
- **PRD-FERT-009 — MUST:** Record a fertigation run history.
- **PRD-FERT-010 — SHOULD:** Control delivery by measured volume/flow rather than duration alone.
- **PRD-FERT-011 — SHOULD:** Support EC/pH feedback for future closed-loop adjustment.

## Scheduling

- **PRD-SCHED-001 — MUST:** Run schedules locally without backend availability.
- **PRD-SCHED-002 — MUST:** Support daily schedules.
- **PRD-SCHED-003 — MUST:** Support selected weekday schedules.
- **PRD-SCHED-004 — MUST:** Support specific-date schedules.
- **PRD-SCHED-005 — MUST:** Support interval schedules.
- **PRD-SCHED-006 — MUST:** Support fallback/default schedules.
- **PRD-SCHED-007 — MUST:** Support fertigation schedules.
- **PRD-SCHED-008 — MUST:** Support well/raw-water pump schedules.
- **PRD-SCHED-009 — MUST:** Support fan schedules.
- **PRD-SCHED-010 — SHOULD:** Support temperature-condition fan control with hysteresis.
- **PRD-SCHED-011 — MUST:** Define missed-schedule behavior.
- **PRD-SCHED-012 — MUST:** Prevent unsafe concurrent execution through resource locking/queueing.

## Water and Irrigation

- **PRD-WATER-001 — MUST:** Support raw-water storage and mixing-tank workflows.
- **PRD-WATER-002 — MUST:** Support tank-level protection.
- **PRD-WATER-003 — MUST:** Support flow-based pump protection.
- **PRD-WATER-004 — MUST:** Support per-GH mixing tanks.
- **PRD-WATER-005 — MUST:** Support independent routing to multiple GHs.
- **PRD-WATER-006 — MUST:** Support irrigation pressure sufficient for the selected pressure-operated emitter system.
- **PRD-WATER-007 — SHOULD:** Avoid unnecessary large solenoid isolation hardware where emitter no-drain behavior and hydraulic design already provide the required shutoff behavior.

## Calibration

- **PRD-CAL-001 — MUST:** Provide dosing pump volumetric calibration.
- **PRD-CAL-002 — MUST:** Persist calibration values.
- **PRD-CAL-003 — MUST:** Version or timestamp calibration records.
- **PRD-CAL-004 — SHOULD:** Provide pH calibration.
- **PRD-CAL-005 — SHOULD:** Provide EC calibration.
- **PRD-CAL-006 — SHOULD:** Provide flow/level calibration.

## Safety

- **PRD-SAFE-001 — MUST:** Enter a known safe actuator state at boot.
- **PRD-SAFE-002 — MUST:** Provide local emergency stop.
- **PRD-SAFE-003 — MUST:** Enforce pump runtime limits.
- **PRD-SAFE-004 — MUST:** Detect missing expected flow for applicable pumps.
- **PRD-SAFE-005 — MUST:** Enforce high-level tank interlock for filling pumps.
- **PRD-SAFE-006 — MUST:** Prevent operations while emergency stop is latched.
- **PRD-SAFE-007 — MUST:** Log safety faults/events.

## Monitoring

- **PRD-TEL-001 — MUST:** Provide real-time temperature/humidity monitoring where installed.
- **PRD-TEL-002 — MUST:** Provide water level monitoring where installed.
- **PRD-TEL-003 — MUST:** Provide flow telemetry where installed.
- **PRD-TEL-004 — SHOULD:** Provide light telemetry.
- **PRD-TEL-005 — SHOULD:** Provide pressure telemetry.
- **PRD-TEL-006 — MUST:** Preserve timestamps and GH/device association.
- **PRD-TEL-007 — MUST:** Support historical data for research and operational analysis.

## Crop/Research

- **PRD-CROP-001 — MUST:** Manage crop cycles.
- **PRD-CROP-002 — MUST:** Track planting date.
- **PRD-CROP-003 — MUST:** Track pollination date.
- **PRD-CROP-004 — MUST:** Calculate HST.
- **PRD-CROP-005 — MUST:** Calculate HSP.
- **PRD-CROP-006 — SHOULD:** Track plant identity and mortality.
- **PRD-CROP-007 — SHOULD:** Track fruit identity and progress.
- **PRD-CROP-008 — MUST:** Track harvest date, yield, and grade.
- **PRD-CROP-009 — SHOULD:** Correlate crop/plant/fruit observations with telemetry and fertigation history.

## Power

- **PRD-POWER-001 — MUST:** Prefer PLN when healthy.
- **PRD-POWER-002 — MUST:** Automatically switch to backup when PLN fails.
- **PRD-POWER-003 — MUST:** Keep the controller alive across the power-source transition.
- **PRD-POWER-004 — MUST:** Automatically charge backup battery from PLN.
- **PRD-POWER-005 — MUST:** Prevent overcharging using appropriate charging control.
- **PRD-POWER-006 — MUST:** Make backup capability sufficient for the irrigation loads required by the defined outage policy, not only the ESP32.
- **PRD-POWER-007 — MUST:** Log power-source transitions.

## UI

- **PRD-UI-001 — MUST:** Provide Complex → GH navigation.
- **PRD-UI-002 — MUST:** Provide GH operational dashboard.
- **PRD-UI-003 — MUST:** Provide fertigation page.
- **PRD-UI-004 — MUST:** Provide schedule page.
- **PRD-UI-005 — MUST:** Provide calibration page.
- **PRD-UI-006 — MUST:** Provide crop-cycle tracking.
- **PRD-UI-007 — SHOULD:** Provide historical curves for operational telemetry.
- **PRD-UI-008 — MUST:** Roll back displayed state when an authoritative save fails.
- **PRD-UI-009 — SHOULD:** Provide dark mode suitable for operational monitoring.

---

# 47. Acceptance Criteria — Product-Level

## Multi-GH

A Complex passes the multi-GH product acceptance criterion when:

1. GH-1 and GH-2 can both exist under one Complex.
2. Each GH has a unique configuration identity.
3. Each GH can have its own mixing tank and operating configuration.
4. A schedule can target either GH.
5. A fertigation run can target either GH.
6. One GH's state does not overwrite another GH's state.
7. Adding GH-2 does not break GH-1.
8. Shared resources are correctly locked/queued.
9. The same codebase does not require a new hardcoded GH identifier for every added GH.

## Fertigation

A fertigation system passes acceptance when:

1. The correct GH is selected.
2. The requested raw-water quantity is achieved within configured tolerance.
3. Each dosing channel runs according to its calibration.
4. Mixing is completed according to configuration.
5. Delivery reaches the configured delivery condition.
6. Safety failures stop or abort the sequence correctly.
7. A complete run record exists.

## Power Backup

A power system passes acceptance when:

1. PLN is the normal source.
2. Loss of PLN causes automatic backup takeover.
3. ESP32 does not reboot during transfer.
4. Required irrigation pump loads can operate under the defined backup policy.
5. Battery charging occurs when PLN is healthy.
6. Charging is controlled safely at full battery state.
7. Return to PLN is automatic.
8. Power transitions are logged.

## Crop Research

A research workflow passes acceptance when an operator/researcher can associate:

```text
GH
→ Crop Cycle
→ Plant
→ Fruit
→ Observation
→ Telemetry
→ Fertigation Run
→ Harvest
```

and retrieve the historical relationship without manually reconstructing it from unrelated systems.

---

# 48. Product Invariants

The following must remain true regardless of implementation technology:

1. **One ESP32 = one Complex controller boundary.**
2. **One Complex may contain one or many GHs.**
3. **One-GH is a simplified topology, not a product limitation.**
4. **Each GH can own a mixing tank and operational identity.**
5. **The ESP32 remains locally authoritative over physical safety.**
6. **Backend availability is not a prerequisite for local scheduled operation.**
7. **Configuration changes are versioned and atomic.**
8. **Physical commands are safety-checked locally.**
9. **Fertigation operations are auditable.**
10. **Crop data and operational data can be correlated.**
11. **Power-loss design considers irrigation continuity, not only controller uptime.**
12. **A UI representation is never treated as proof of a physical capability unless the physical path is actually available.**

---

# 49. Separate Project Status Model

This PRD intentionally does not classify every requirement as implemented/not implemented.

A separate document shall maintain:

```text
PRD Requirement
      ↓
Current Codebase
      ↓
Implemented
Partial
Mock
UI Only
Firmware Only
Broken
Not Implemented
Unknown
      ↓
Evidence
      ↓
Gap / Action
```

That status document shall be derived from the actual repository and updated as development progresses.

The PRD itself should remain relatively stable while implementation evolves.

---

# 50. Final Product Definition

AgroTech is not merely a remote pump switch.

It is a **local greenhouse operating system** for a Complex.

At the physical level it controls water movement, nutrient dosing, mixing, delivery, environmental actuators, sensors, timing, safety, and recovery.

At the operational level it lets a farmer configure and run fertigation, automate repeated work, respond to faults, and inspect what happened.

At the management level it lets one Complex grow from a single GH into multiple GHs without changing the fundamental control architecture.

At the research level it connects environmental telemetry, fertigation history, crop-cycle timing, plant/fruit observations, and harvest outcomes.

The central product loop is:

```text
CONFIGURE
   ↓
CALIBRATE
   ↓
SCHEDULE
   ↓
EXECUTE LOCALLY
   ↓
MEASURE
   ↓
PROTECT
   ↓
LOG
   ↓
RECOVER
   ↓
ANALYZE
   ↓
IMPROVE
```

The intended end state is a greenhouse system that can operate safely and predictably without requiring the operator to stand beside the mixing tank, while still retaining enough measurement, history, and traceability to improve the crop process over time.

---

# Appendix A — Recommended Requirement Domains

The requirement namespace should remain extensible:

```text
ARCH    Architecture
COMPLEX  Complex management
GH      Greenhouse management
FERT    Fertigation
RECIPE  Recipe
DOSE    Dosing
WATER   Water management
HYD     Hydraulics
PUMP    Pump
VALVE   Valve/routing
FAN     Climate/fan
SCHED   Scheduling
SENSE   Sensors
TEL     Telemetry
EVENT   Events
CAL     Calibration
SAFE    Safety
ERR     Error handling
CMD     Commands
POWER   Power backup
TIME    Time
STORE   Storage
CROP    Crop cycle
PLANT   Plant tracking
FRUIT   Fruit tracking
OBS     Observations/research
UI      User interface
API     API
SEC     Security
DIAG    Diagnostics
```

---

# Appendix B — Core Domain Model

```text
Complex
 ├── Configuration
 ├── Controller
 ├── Shared Resources
 │    ├── Well
 │    ├── Raw Water
 │    ├── Nutrient Sources
 │    └── Dosing Infrastructure
 │
 └── Greenhouse[*]
      ├── Mixing Tank
      ├── Sensors[*]
      ├── Actuators[*]
      ├── Recipes[*]
      ├── Schedules[*]
      ├── Fertigation Runs[*]
      ├── Crop Cycles[*]
      │    ├── Plants[*]
      │    │    └── Fruits[*]
      │    └── Observations[*]
      ├── Telemetry[*]
      └── Events[*]
```

---

# Appendix C — Canonical Operational Sequence

A canonical fertigation operation is conceptually:

```text
Schedule / Manual Trigger
        ↓
Identify Complex + GH
        ↓
Load active configuration
        ↓
Load recipe snapshot
        ↓
Validate resources
        ↓
Validate safety
        ↓
Reserve resources
        ↓
Fill mixing tank
        ↓
Measure water
        ↓
Dose each configured channel
        ↓
Mix
        ↓
Validate delivery readiness
        ↓
Pressurize irrigation network
        ↓
Deliver to GH
        ↓
Stop safely
        ↓
Release resources
        ↓
Record run + telemetry + events
```

Any failure creates a controlled fault path and records the reason.

---

# Appendix D — PRD vs Project Status Boundary

## This PRD answers:

- What product are we building?
- What should the user be able to do?
- How should the greenhouse operate?
- How should one GH and many GHs behave?
- What should happen during network/power failure?
- What safety guarantees are required?
- What information should be captured?
- What architecture must be preserved as the system scales?

## The Project Status document answers:

- What has already been implemented?
- What is partial?
- What is still mocked?
- What is broken?
- What is firmware-only?
- What is UI-only?
- What does the current hardware support?
- What remains to be built?
- What is the evidence in the repository?

These documents must never be merged merely for convenience.
