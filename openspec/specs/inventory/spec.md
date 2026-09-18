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

## Out of scope

C03 does not select inventory costing (D08), import historical balances (D22),
FEFO, operational reservations, sales or inter-branch transfers.
