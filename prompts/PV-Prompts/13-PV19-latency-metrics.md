# BUILD ORDER 13 — PV19: Latency Metrics

Build on PV17.

## Goal
Implement **PV19 — Latency Metrics**.

Measure:

```text
trigger → microphone capture
trigger → Gemini connected
release → final transcript
final transcript → destination complete
total utterance completion time
```

Also distinguish the normal live path from the recovery path.

Keep instrumentation cheap. Do not add large tracing libraries or log transcript content.

Expose a small developer/details view showing useful recent or aggregated timing statistics.

The goal is to identify actual bottlenecks before optimizing anything. Stop after PV19.
