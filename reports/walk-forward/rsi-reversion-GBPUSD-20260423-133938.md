# Walk-Forward Report: rsi-reversion / GBPUSD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Failure reasons:**
- OOS Sharpe 0.463 < min 1
- IS->OOS Sharpe drop 75.15% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.463 |
| OOS Avg MAR | 2.051 |
| OOS Avg PF | 89.789 |
| OOS Max DD | 5.77% |
| OOS Avg Total Return | 0.83% |
| IS->OOS Sharpe Drop | 75.15% |

## Parameter Grid

```json
{
  "rsiPeriod": [
    7,
    14,
    21
  ],
  "buyThreshold": [
    20,
    25,
    30,
    35
  ],
  "sellThreshold": [
    65,
    70,
    75,
    80
  ],
  "atrPeriod": [
    14
  ]
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 16-04-25->17-04-11 | 17-04-12->17-10-05 | rsiPeriod=7, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 1.71 | 2.46 | 5.80 | 3.44 | 2.0% | 13 |
| 1 | 16-10-18->17-10-05 | 17-10-06->18-04-02 | rsiPeriod=7, buyThreshold=30, sellThreshold=75, atrPeriod=14 | 2.32 | 1.26 | 2.14 | 2.17 | 2.3% | 7 |
| 2 | 17-04-12->18-04-02 | 18-04-03->18-09-25 | rsiPeriod=7, buyThreshold=30, sellThreshold=75, atrPeriod=14 | 1.93 | -1.79 | -1.46 | 0.36 | 5.8% | 10 |
| 3 | 17-10-06->18-09-25 | 18-09-26->19-03-20 | rsiPeriod=14, buyThreshold=25, sellThreshold=65, atrPeriod=14 | 1.52 | 0.26 | 0.62 | 10.00 | 0.5% | 2 |
| 4 | 18-04-03->19-03-20 | 19-03-21->19-09-13 | rsiPeriod=14, buyThreshold=25, sellThreshold=70, atrPeriod=14 | 1.98 | 1.45 | 4.64 | 70.92 | 0.6% | 3 |
| 5 | 18-09-26->19-09-13 | 19-09-16->20-03-09 | rsiPeriod=7, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 2.11 | 1.48 | 4.49 | 2.38 | 1.3% | 7 |
| 6 | 19-03-21->20-03-09 | 20-03-10->20-09-01 | rsiPeriod=21, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 2.61 | 0.02 | 0.01 | 10.00 | 1.2% | 3 |
| 7 | 19-09-16->20-09-01 | 20-09-02->21-02-24 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 3.01 | -0.57 | -0.87 | 0.58 | 2.5% | 8 |
| 8 | 20-03-10->21-02-24 | 21-02-25->21-08-19 | rsiPeriod=7, buyThreshold=25, sellThreshold=70, atrPeriod=14 | 0.75 | 1.43 | 4.08 | 3.63 | 1.4% | 8 |
| 9 | 20-09-02->21-08-19 | 21-08-20->22-02-11 | rsiPeriod=14, buyThreshold=35, sellThreshold=75, atrPeriod=14 | 1.12 | 0.68 | 1.72 | 2.00 | 1.3% | 6 |
| 10 | 21-02-25->22-02-11 | 22-02-14->22-08-08 | rsiPeriod=7, buyThreshold=25, sellThreshold=80, atrPeriod=14 | 1.97 | 0.79 | 1.90 | 1.86 | 1.9% | 10 |
| 11 | 21-08-20->22-08-08 | 22-08-09->23-01-31 | rsiPeriod=14, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 1.67 | 1.53 | 9.58 | 898.24 | 0.4% | 5 |
| 12 | 22-02-14->23-01-31 | 23-02-01->23-07-26 | rsiPeriod=14, buyThreshold=25, sellThreshold=65, atrPeriod=14 | 1.20 | 0.01 | 0.02 | 10.00 | 0.4% | 2 |
| 13 | 22-08-09->23-07-26 | 23-07-27->24-01-18 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 2.04 | 0.66 | 1.44 | 1.56 | 1.7% | 9 |
| 14 | 23-02-01->24-01-18 | 24-01-19->24-07-12 | rsiPeriod=7, buyThreshold=25, sellThreshold=70, atrPeriod=14 | 1.56 | -0.80 | -1.29 | 0.48 | 2.5% | 8 |
| 15 | 23-07-27->24-07-12 | 24-07-15->25-01-07 | rsiPeriod=14, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 1.74 | 1.84 | 6.13 | 598.58 | 1.2% | 5 |
| 16 | 24-01-19->25-01-07 | 25-01-08->25-07-04 | rsiPeriod=14, buyThreshold=30, sellThreshold=75, atrPeriod=14 | 2.25 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 17 | 24-07-15->25-07-04 | 25-07-07->25-12-30 | rsiPeriod=14, buyThreshold=30, sellThreshold=75, atrPeriod=14 | 2.06 | -2.37 | -2.05 | 0.00 | 2.0% | 2 |