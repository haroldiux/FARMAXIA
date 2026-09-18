# Inventory — canonical specification

## Requirements

### Requirement: explicit movement direction

Every inventory movement MUST have a positive quantity and direction `IN` or
`OUT`, plus warehouse, batch, type, reference and timestamp. Receipts MUST be
recorded as `IN`.

### Requirement: atomic reconciliation

An inventory reconciliation MUST store expected quantity, counted quantity,
delta, reason and an idempotency key. The balance update and any adjustment
movement MUST commit in the same transaction. An `OUT` adjustment MUST preserve
`reserved_base` and MUST never create a negative balance.

### Requirement: replay-safe reconciliation

Repeating the same operation and payload MUST return the original result without
duplicating the reconciliation, movement or audit event. A reused key with a
different payload MUST be rejected.

### Requirement: scoped audit

Reconciliation and balance operations MUST enforce tenant, user and active
branch membership through the scoped database context and MUST append an audit
event in the same transaction.

### Requirement: FEFO reservation allocation

An operational reservation MUST receive a sellable presentation, positive
commercial quantity, warehouse and explicit future expiration timestamp. The
backend MUST convert the quantity through the presentation's positive integer
base-unit factor.

Only `AVAILABLE` batches with `expires_on >= current_date` and positive
available quantity (`quantity_base - reserved_base`) are eligible. Allocation
MUST sort by `expires_on ASC, batch_id ASC`, lock balances with `FOR UPDATE`,
and either cover the complete request or make no mutation.

### Requirement: reservation lifecycle

A reservation MUST increment `reserved_base` without changing physical stock.
Release decrements only `reserved_base`; consumption decrements both
`quantity_base` and `reserved_base` and records an `OUT` movement; expiration
releases the reserved units. States are `ACTIVE`, `CONSUMED`, `RELEASED` and
`EXPIRED`.

Mutations MUST use idempotency. Repeating a key and payload returns the original
result; reusing a key with a different payload rejects the operation.

### Requirement: scoped FEFO audit

Reservation, release, consumption and expiration MUST run inside the scoped
database transaction and append an audit event. RLS and branch membership MUST
prevent access to another tenant or warehouse branch.

### Requirement: expiry alerts

The system MUST expose scoped, read-only expiry alerts for a warehouse and an
inclusive horizon from 0 through 365 days. Results MUST include lot, expiry
date, batch status, physical quantity, reserved quantity and available
quantity, and MUST be ordered by `expires_on ASC, batch_id ASC`. Batches with
positive physical quantity are eligible for the alert even when quarantined;
the alert MUST distinguish `EXPIRED` from `DUE_SOON` without persisting a
notification or mutating stock.

### Requirement: quarantine and cold-chain evidence

An `AVAILABLE` batch MUST be quarantineable with a reason code of `QUALITY`,
`COLD_CHAIN`, `DAMAGE` or `OTHER`. A cold-chain quarantine MUST accept a
temperature measurement. The operation MUST reject active reservations, lock
the scoped balance and batch, use idempotency, append an operation event and
audit entry, and transition the batch to `QUARANTINED`. A non-expired
quarantined batch MAY be released with a reason and returns to `AVAILABLE`.

### Requirement: waste and authorized physical count

A waste operation MUST accept a positive base quantity and reason, decrement
only free stock (`quantity_base - reserved_base`), record a `WASTE`/`OUT`
movement and an operation event atomically, and be replay-safe. It MUST never
create a negative balance or decrement reservations. Physical counts MUST use
the existing idempotent reconciliation contract, remain protected by
`inventory.manage`, and preserve the reserved-stock floor.

## Out of scope

C05 does not implement sales, proformas, cash, inter-branch transfers, sensor
workers, external notifications, controlled products or historical imports.
D08 costing, D09 proforma/reservation policy and D22 import decisions remain
open.
