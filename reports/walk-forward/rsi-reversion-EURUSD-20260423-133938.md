# Walk-Forward Report: rsi-reversion / EURUSD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Failure reasons:**
- OOS Sharpe 0.070 < min 1
- IS->OOS Sharpe drop 95.47% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.070 |
| OOS Avg MAR | 1.424 |
| OOS Avg PF | 18.656 |
| OOS Max DD | 4.07% |
| OOS Avg Total Return | -0.01% |
| IS->OOS Sharpe Drop | 95.47% |

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
| 0 | 16-04-25->17-04-11 | 17-04-12->17-10-05 | rsiPeriod=7, buyThreshold=20, sellThreshold=70, atrPeriod=14 | 2.22 | -1.19 | -1.15 | 0.56 | 4.1% | 10 |
| 1 | 16-10-18->17-10-05 | 17-10-06->18-04-02 | rsiPeriod=7, buyThreshold=20, sellThreshold=80, atrPeriod=14 | 1.53 | 1.00 | 2.20 | 10.00 | 1.2% | 4 |
| 2 | 17-04-12->18-04-02 | 18-04-03->18-09-25 | rsiPeriod=7, buyThreshold=35, sellThreshold=80, atrPeriod=14 | 2.01 | -1.64 | -1.66 | 0.32 | 3.4% | 7 |
| 3 | 17-10-06->18-09-25 | 18-09-26->19-03-20 | rsiPeriod=14, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 0.59 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 4 | 18-04-03->19-03-20 | 19-03-21->19-09-13 | rsiPeriod=21, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.27 | 0.05 | 0.09 | 1.05 | 1.0% | 3 |
| 5 | 18-09-26->19-09-13 | 19-09-16->20-03-09 | rsiPeriod=7, buyThreshold=25, sellThreshold=70, atrPeriod=14 | 2.71 | -1.54 | -1.79 | 0.38 | 3.5% | 8 |
| 6 | 19-03-21->20-03-09 | 20-03-10->20-09-01 | rsiPeriod=14, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 2.36 | -0.73 | -1.08 | 0.63 | 1.7% | 4 |
| 7 | 19-09-16->20-09-01 | 20-09-02->21-02-24 | rsiPeriod=14, buyThreshold=20, sellThreshold=75, atrPeriod=14 | 1.32 | 1.52 | 7.88 | 10.00 | 0.3% | 1 |
| 8 | 20-03-10->21-02-24 | 21-02-25->21-08-19 | rsiPeriod=14, buyThreshold=35, sellThreshold=80, atrPeriod=14 | 0.70 | -0.93 | -1.13 | 0.42 | 2.8% | 6 |
| 9 | 20-09-02->21-08-19 | 21-08-20->22-02-11 | rsiPeriod=7, buyThreshold=20, sellThreshold=80, atrPeriod=14 | 1.34 | 1.24 | 3.30 | 2.67 | 1.1% | 4 |
| 10 | 21-02-25->22-02-11 | 22-02-14->22-08-08 | rsiPeriod=7, buyThreshold=25, sellThreshold=80, atrPeriod=14 | 0.94 | -0.42 | -0.85 | 0.75 | 1.2% | 4 |
| 11 | 21-08-20->22-08-08 | 22-08-09->23-01-31 | rsiPeriod=7, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 0.76 | 0.14 | 0.18 | 1.08 | 4.0% | 14 |
| 12 | 22-02-14->23-01-31 | 23-02-01->23-07-26 | rsiPeriod=21, buyThreshold=30, sellThreshold=65, atrPeriod=14 | 1.39 | -1.43 | -2.08 | 0.00 | 1.0% | 1 |
| 13 | 22-08-09->23-07-26 | 23-07-27->24-01-18 | rsiPeriod=7, buyThreshold=20, sellThreshold=75, atrPeriod=14 | 2.46 | 1.90 | 4.21 | 134.43 | 1.2% | 5 |
| 14 | 23-02-01->24-01-18 | 24-01-19->24-07-12 | rsiPeriod=7, buyThreshold=25, sellThreshold=75, atrPeriod=14 | 1.34 | 2.72 | 15.74 | 170.07 | 0.5% | 6 |
| 15 | 23-07-27->24-07-12 | 24-07-15->25-01-07 | rsiPeriod=7, buyThreshold=30, sellThreshold=75, atrPeriod=14 | 2.05 | 0.67 | 1.52 | 1.39 | 2.1% | 9 |
| 16 | 24-01-19->25-01-07 | 25-01-08->25-07-04 | rsiPeriod=7, buyThreshold=25, sellThreshold=75, atrPeriod=14 | 1.94 | -0.69 | -0.91 | 0.65 | 3.1% | 8 |
| 17 | 24-07-15->25-07-04 | 25-07-07->25-12-30 | rsiPeriod=7, buyThreshold=25, sellThreshold=65, atrPeriod=14 | 0.78 | 0.58 | 1.16 | 1.40 | 1.7% | 9 |