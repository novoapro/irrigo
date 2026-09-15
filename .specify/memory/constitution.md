<!--
SYNC IMPACT REPORT
==================
Version change: (uninitialized template) → 1.0.0
Rationale: Initial ratification. The prior file was the unfilled scaffold with
only placeholder tokens; this is the first concrete constitution, so the version
starts at 1.0.0 (MAJOR baseline).

Principles defined (all new):
  - I. End-to-End Type Safety & Validated Boundaries
  - II. Fail-Safe Irrigation Guard
  - III. Test-First for Core Logic (NON-NEGOTIABLE)
  - IV. Real-Time Observability & Heartbeat Integrity
  - V. Simplicity & Local-First Deployability

Sections defined:
  - Technology & Architecture Constraints (new)
  - Development Workflow & Quality Gates (new)
  - Governance (new)

Removed sections: none (template placeholders replaced in place).

Deferred / follow-up TODOs:
  - RATIFICATION_DATE set to 2026-09-10 (date of initial adoption). Correct if the
    project was formally adopted earlier.

NOTE: This Sync Impact Report is scratch material for reviewing the amendment and
should be removed before the constitution file is committed.
-->

# Irrigo Constitution

## Core Principles

### I. End-to-End Type Safety & Validated Boundaries

TypeScript is the contract language across the IoT device payloads, the Express
backend, and the React frontend. Every external input crossing a trust boundary —
device heartbeats, HTTP request bodies, and any third-party (weather, AI) response —
MUST be validated at runtime (e.g. with `zod`) before it is trusted or persisted.
Shared data shapes MUST have a single declared type, not re-declared per layer.

Rationale: The system ingests untrusted sensor and network data continuously;
runtime validation at the edges prevents malformed data from corrupting stored state
or reaching the dashboard, and single-source types keep the collector and the UI in
agreement.

### II. Fail-Safe Irrigation Guard

The guard's default under uncertainty MUST protect the irrigation system and the
lawn: when sensor data is missing, stale, or ambiguous, the system MUST NOT silently
assert that watering is safe. CompAI is the authority on irrigation state; Irrigo
collects, tracks, and surfaces that state but MUST NOT override or contradict it.
Any logic that changes when a watering cycle is skipped or allowed MUST have explicit,
tested handling of the missing-data and stale-data cases.

Rationale: This is a physical control system where a wrong "keep watering" decision
wastes water or floods saturated soil; defaulting to the safe action and deferring to
the designated source of truth prevents real-world harm.

### III. Test-First for Core Logic (NON-NEGOTIABLE)

Core domain services — guard decisions, deferral logic, heartbeat analytics, and
irrigation-event derivation — MUST be covered by automated tests, and behavior
changes to them MUST be accompanied by tests written or updated in the same change.
Backend logic uses Jest; frontend logic uses Vitest. A change to guard or analytics
behavior without a corresponding test is not complete.

Rationale: These services encode the decisions that matter; the existing test suites
around guard, deferral, and analytics already guard against regressions, and keeping
tests in lockstep with logic is what makes those decisions safe to change.

### IV. Real-Time Observability & Heartbeat Integrity

Device liveness MUST be observable: heartbeats are the primary signal of device
health, and gaps, staleness, or anomalies MUST be detectable rather than silently
absorbed. State pushed to the dashboard over WebSocket MUST reflect stored backend
state, so a viewer never sees a value that contradicts what was persisted. Errors and
notable state transitions MUST be logged with enough context to diagnose them.

Rationale: An unattended outdoor device fails in ways only telemetry reveals; treating
heartbeats as a first-class integrity signal and keeping the live view consistent with
storage is what makes the system trustworthy to act on.

### V. Simplicity & Local-First Deployability

Prefer the simplest design that satisfies the requirement (YAGNI); do not add
abstraction, services, or dependencies ahead of a concrete need. The stack MUST remain
deployable in the project's real environment, including the documented offline/local
deployment path, and MUST NOT hard-code environment-specific assumptions (such as a
specific database host) into application logic.

Rationale: A home-scale IoT system is maintained by few hands and sometimes deployed
without internet; simplicity and a reliable local deploy path keep it operable rather
than fragile.

## Technology & Architecture Constraints

- **IoT device**: Arduino UNO R4 WiFi firmware in `iot/`, reading pressure, rain, and
  soil sensors and driving a relay; it reports to the backend and MUST NOT be assumed
  always-connected.
- **Backend**: Express + TypeScript (`backend/`), MongoDB via Mongoose, real-time push
  via `ws` (WebSocket). AI/weather enrichment (Anthropic / Google / OpenAI SDKs) is an
  enrichment layer and MUST NOT be a hard dependency of core guard decisions.
- **Frontend**: React 19 + Vite + TypeScript (`frontend/`), React Query for data
  access, mobile-first dashboard.
- **Deployment**: Docker Compose for local orchestration; the documented offline backend
  deployment path (see project deployment notes) MUST remain functional.
- Configuration (database connection, API keys, hosts) MUST come from environment/config,
  never committed secrets or hard-coded hosts.

## Development Workflow & Quality Gates

- Code MUST pass its package's lint (`eslint`) and type-check/build before merge.
- Backend changes run `jest`; frontend changes run `vitest`; both MUST be green.
- Changes to core guard, deferral, analytics, or irrigation-event logic REQUIRE tests
  in the same change (Principle III) and a review that verifies fail-safe behavior
  (Principle II).
- Boundary-crossing inputs MUST be validated (Principle I); reviewers verify this for
  any new endpoint, device payload field, or third-party integration.
- Prefer small, reviewable changes; justify any added dependency or new abstraction.

## Governance

This constitution supersedes ad-hoc practice for the Irrigo project. Amendments MUST be
made by editing this file, MUST state the rationale, and MUST update the version and
`Last Amended` date below.

Versioning follows semantic versioning:
- **MAJOR**: backward-incompatible governance changes or removal/redefinition of a
  principle.
- **MINOR**: a new principle or section, or materially expanded guidance.
- **PATCH**: clarifications, wording, and non-semantic refinements.

Compliance is verified at review time: every change is checked against the principles
above, and any deviation MUST be justified in the change description or corrected.
Runtime development guidance for agents lives in `CLAUDE.md` and the project memory; this
constitution governs, and those documents MUST NOT contradict it.

**Version**: 1.0.0 | **Ratified**: 2026-09-10 | **Last Amended**: 2026-09-10
