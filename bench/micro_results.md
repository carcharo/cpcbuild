# Per-operation float cost (bench/micro.py)

## cpcbas 0.2.0-dev (2026-11-13)

| Operation | cpcbas ms/call | Locomotive ms/call | Speed-up (Locomotive time / cpcbas time) |
|---|---|---|---|
| `a+b` | 0.59 | 0.92 | 1.55x |
| `a-b` | 0.64 | 0.95 | 1.50x |
| `a*b` | 1.72 | 1.88 | 1.09x |
| `a/b` | 2.37 | 2.28 | 0.96x |
| `SQR(a)` | 26.4 | 26.8 | 1.01x |
| `SIN(a)` | 13.4 | 13.8 | 1.03x |
| `COS(a)` | 14.2 | 14.6 | 1.03x |
| `EXP(a)` | 12.8 | 13.2 | 1.03x |
| `LOG(a)` | 12.6 | 13.0 | 1.04x |
| `ATN(a)` | 23.4 | 24.0 | 1.02x |

Loop overhead (the same loop with `y=a`) is subtracted. cpcbas's natural log is `LOG`, as in Locomotive.
