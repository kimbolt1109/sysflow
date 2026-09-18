# 001. Record architecture decisions

Date: 2026-07-08
Status: accepted

## Context

This project will accumulate decisions that are expensive to reverse — layer boundaries,
persistence choices, protocol shapes. Without a durable record, the reasoning behind them
is lost and old debates get reopened by every new contributor.

## Decision

We record architecture decisions as Architecture Decision Records (ADRs), stored as
`docs/adr/NNN-short-title.md`, numbered sequentially, using the Context / Decision /
Consequences format defined in the conventions kit. Prior ADRs are binding; superseding
one requires a new ADR that references it.

## Consequences

Hard-to-reverse choices become searchable history instead of tribal knowledge, and reviews
can point at a numbered decision. The cost is a small amount of writing discipline: any
change that alters a recorded decision must ship with a superseding ADR.
