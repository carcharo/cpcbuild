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

## 0.1.x (Boriel fork, 2026-09-28)

| Operation | Boriel ms/call | Locomotive ms/call | Speed-up (Locomotive time / Boriel time) |
|---|---|---|---|
| `a+b` | 0.88 | 0.93 | 1.05x |
| `a-b` | 1.25 | 0.98 | 0.79x |
| `a*b` | 1.95 | 1.89 | 0.97x |
| `a/b` | 2.56 | 2.30 | 0.90x |
| `SIN(a)` | 40.2 | 13.8 | 0.34x |
| `COS(a)` | 42.5 | 14.7 | 0.35x |
| `EXP(a)` | 40.8 | 13.2 | 0.32x |
| `ATN(a)` | 62.8 | 24.0 | 0.38x |
| `SQR(a)` | 112.1 | 26.9 | 0.24x |
| `LN(a)` / Locomotive `LOG(a)` | 66.9 | 13.0 | 0.20x |

Median of 2 runs; loop overhead (the same loop with `y=a`) subtracted. The emulator's frame-based timing adds about ±0.04 ms per call. All results agree to Boriel's 5 printed decimals. Locomotive's natural log is `LOG`.
