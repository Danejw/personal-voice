# BUILD ORDER 14 — PV18: Reliability Dashboard

Build on PV17/PV19 data.

## Goal
Implement **PV18 — Reliability Dashboard**.

Create a simple private view of app reliability.

Useful metrics:

```text
successful dictations
failed dictations
live completion rate
recovery usage
recovery success rate
insertion failures
average finalization latency
```

Keep it understandable and small. Do not create business analytics, decorative charts, or external monitoring infrastructure.

Allow reset/clear where reasonable. Only display data already collected by the lightweight usage system.

Do not store additional sensitive data just to power the dashboard. Stop after PV18.
