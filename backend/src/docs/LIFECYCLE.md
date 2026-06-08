# Irrigation Program Lifecycle

## Overview

An irrigation program goes through several lifecycle phases from scheduling to completion. Programs can originate from two sources:

- **Manual programs** (`source: "manual"`) - Cron-scheduled, user-defined programs
- **AI programs** (`source: "ai-schedule"`) - AI-generated programs with planned start times

Both types ultimately create a **Sequential Run** when they execute, which manages zone-by-zone irrigation.

---

## Program Status State Machine

```
                     ┌──────────────────────────────────────┐
                     │                                      │
                     v                                      │
┌─────────┐    ┌──────────┐    ┌───────────┐    ┌──────────────┐
│ planned  │───>│executing │───>│ completed │    │   skipped    │
└─────────┘    └──────────┘    └───────────┘    └──────────────┘
     │                                                 ^
     │              ┌──────────┐                       │
     ├─────────────>│ deferred │───────────────────────┤
     │              └──────────┘                       │
     │                   │                             │
     │                   │ (guard clears)              │
     │                   v                             │
     │              ┌──────────┐                       │
     │              │ planned  │ (re-enters cycle)     │
     │              └──────────┘                       │
     │                                                 │
     ├─────────────────────────────────────────────────┤
     │  (rain, precipitation, AI disabled, error)      │
     │                                                 │
     └────────────────────>┌───────────┐               │
                           │ cancelled │               │
                           └───────────┘               │
```

### Status Definitions

| Status | Meaning |
|--------|---------|
| `planned` | Scheduled but not yet triggered |
| `executing` | Currently running (sequential run active) |
| `completed` | All zones finished successfully |
| `cancelled` | Manually cancelled by user |
| `skipped` | Skipped due to weather, guard timeout, or error |
| `deferred` | Postponed due to guard — waiting for conditions to improve |

### Transition Triggers & Reasons

| From | To | Trigger | statusReason |
|------|-----|---------|--------------|
| planned | executing | Cron match / planned time reached | — |
| planned | deferred | Guard active at trigger time | "Guard active — conditions not suitable for irrigation" |
| planned | skipped | Rain sensor active | "Rain detected — rain sensor active" |
| planned | skipped | Precipitation exceeds threshold | "Precipitation probability X% exceeds threshold (Y%)" |
| planned | skipped | AI scheduling disabled | "AI scheduling disabled" |
| planned | cancelled | User cancels | "Manually cancelled by user" |
| executing | completed | All zones completed | — |
| executing | skipped | Zones failed during execution | "One or more zones failed during execution" |
| deferred | planned | Guard clears within preferred window | — (reason cleared) |
| deferred | skipped | Deadline expires (24h) | "Deferral deadline expired — guard did not clear in time" |
| deferred | cancelled | User cancels | "Manually cancelled by user" |
| deferred | skipped | User skips | "Manually skipped by user" |

---

## Sequential Run Lifecycle

A Sequential Run is the execution engine that irrigates zones one-by-one. It's created when a program triggers or when a user starts a manual run.

### Run Status State Machine

```
┌─────────┐    ┌───────────┐
│ running  │───>│ completed │
└─────────┘    └───────────┘
     │
     ├────────>┌───────────┐
     │         │ cancelled │  (user cancels)
     │         └───────────┘
     │
     ├────────>┌────────┐         ┌───────────┐
     │         │deferred│────────>│  failed   │  (deadline expires)
     │         └────────┘         └───────────┘
     │              │
     │              │ (guard clears in window)
     │              v
     │         ┌─────────┐
     └─────────│ running │  (resumes)
               └─────────┘
```

### Run Status Definitions

| Status | Meaning |
|--------|---------|
| `running` | Actively irrigating zones |
| `deferred` | Paused due to guard activation |
| `completed` | All zones finished (some may have failed) |
| `cancelled` | User cancelled mid-run |
| `failed` | Critical failure (deferral timeout, all zones skipped) |

---

## Zone Lifecycle (within a Sequential Run)

Each zone within a run goes through its own mini-lifecycle:

```
┌────────┐    ┌────────────┐    ┌─────────┐    ┌───────────┐
│ queued │───>│ activating │───>│ running │───>│ completed │
└────────┘    └────────────┘    └─────────┘    └───────────┘
     │              │                │
     │              │                │
     │              v                v
     │         ┌────────┐      ┌────────┐
     ├────────>│skipped │      │ failed │
     │         └────────┘      └────────┘
     │
     v
┌──────────┐
│ deferred │  (guard activates during this zone)
└──────────┘
     │
     │ (guard clears)
     v
┌────────┐
│ queued │  (retries from beginning)
└────────┘
```

### Zone Status Definitions

| Status | Meaning |
|--------|---------|
| `queued` | Waiting for its turn |
| `activating` | Command sent, waiting for hardware acknowledgment |
| `running` | Zone is actively irrigating |
| `completed` | Zone finished its duration normally |
| `skipped` | Zone was skipped (run cancelled, deadline expired) |
| `failed` | Hardware error or timeout |
| `deferred` | Zone paused due to guard activation |

### Zone Error Messages (the "WHY")

When a zone is skipped or failed, the `error` field explains why:

- `"Deferral deadline expired — guard did not clear in time"` - Guard stayed active for 24h
- `"Deferral deadline expired during server restart"` - Server restarted while deferred
- `"Run cancelled"` - User cancelled the entire run
- `"Command timeout — hardware did not respond"` - IoT device unresponsive
- `"Safety timeout exceeded"` - Zone ran longer than expected duration + buffer

---

## Guard & Deferral System

The guard is a boolean signal from the IoT device indicating conditions are unfavorable for irrigation (rain, soil moisture, etc).

### Deferral Flow

```
1. Program triggers → checks guard
2. Guard active?
   ├── YES → Defer (24h deadline)
   │         └── Monitor heartbeats for guard=false
   │              ├── Guard clears within preferred window → Resume
   │              └── 24h deadline expires → Mark as failed/skipped
   └── NO  → Execute normally
```

### Grace Period

If the guard activates within 60 seconds of a zone starting, the system waits before deferring. This prevents micro-interruptions from briefly fluctuating sensor readings.

### Preferred Window

When the guard clears, the system only resumes irrigation if the current time falls within the user's configured preferred irrigation window. If outside the window, it waits for the next preferred window (or until deadline expires).

---

## Execution Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│ TRIGGER                                                         │
│  - Cron matches (scheduled mode)                                │
│  - plannedStartAt reached (smart mode)                          │
│  - User clicks "Run" (any mode)                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│ PRE-FLIGHT CHECKS                                               │
│  1. Is guard active?         → Defer                            │
│  2. Is rain detected?        → Skip (AI programs only)          │
│  3. Is precipitation high?   → Skip (AI programs only)          │
│  4. Is AI scheduling enabled?→ Skip (AI programs only)          │
│  5. Is another run active?   → Wait / skip                      │
└────────────────────────┬────────────────────────────────────────┘
                         │ (all checks pass)
                         v
┌─────────────────────────────────────────────────────────────────┐
│ SEQUENTIAL EXECUTION                                            │
│  For each zone in order:                                        │
│    1. Send "on" command to controller                           │
│    2. Wait for hardware acknowledgment                          │
│    3. Monitor duration (with safety timeout)                    │
│    4. Receive "off" event from hardware                         │
│    5. Record irrigation event + update record                   │
│    6. Advance to next zone                                      │
│                                                                 │
│  If guard activates mid-run:                                    │
│    - Send "off" to current zone                                 │
│    - Mark run as deferred                                       │
│    - Wait for guard to clear (24h max)                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────────┐
│ FINALIZATION                                                    │
│  - Mark run as completed/failed                                 │
│  - Update program status                                        │
│  - Emit WebSocket events                                        │
│  - Create irrigation records                                    │
└─────────────────────────────────────────────────────────────────┘
```
