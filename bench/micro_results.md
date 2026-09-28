# Per-operation float cost (bench/micro.py, 2026-09-28)

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
