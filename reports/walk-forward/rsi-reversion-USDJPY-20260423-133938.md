# Walk-Forward Report: rsi-reversion / USDJPY

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Failure reasons:**
- OOS Sharpe -0.164 < min 1
- IS->OOS Sharpe drop 109.49% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | -0.164 |
| OOS Avg MAR | 1.204 |
| OOS Avg PF | 1.636 |
| OOS Max DD | 4.18% |
| OOS Avg Total Return | 0.39% |
| IS->OOS Sharpe Drop | 109.49% |

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
| 0 | 16-04-25->17-04-11 | 17-04-12->17-10-05 | rsiPeriod=7, buyThreshold=35, sellThreshold=80, atrPeriod=14 | 1.14 | 1.82 | 5.35 | 3.68 | 2.2% | 12 |
| 1 | 16-10-18->17-10-05 | 17-10-06->18-04-02 | rsiPeriod=7, buyThreshold=35, sellThreshold=75, atrPeriod=14 | 1.65 | 0.16 | 0.19 | 1.08 | 2.9% | 10 |
| 2 | 17-04-12->18-04-02 | 18-04-03->18-09-25 | rsiPeriod=14, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 1.74 | -2.67 | -2.05 | 0.00 | 3.0% | 3 |
| 3 | 17-10-06->18-09-25 | 18-09-26->19-03-20 | rsiPeriod=7, buyThreshold=30, sellThreshold=80, atrPeriod=14 | 2.00 | -1.13 | -1.18 | 0.41 | 2.0% | 3 |
| 4 | 18-04-03->19-03-20 | 19-03-21->19-09-13 | rsiPeriod=7, buyThreshold=35, sellThreshold=75, atrPeriod=14 | 1.74 | 0.96 | 2.42 | 1.85 | 1.4% | 9 |
| 5 | 18-09-26->19-09-13 | 19-09-16->20-03-09 | rsiPeriod=21, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.44 | -1.43 | -2.08 | 0.00 | 1.0% | 2 |
| 6 | 19-03-21->20-03-09 | 20-03-10->20-09-01 | rsiPeriod=21, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 2.12 | 1.09 | 5.16 | 10.00 | 0.5% | 1 |
| 7 | 19-09-16->20-09-01 | 20-09-02->21-02-24 | rsiPeriod=7, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 2.77 | 2.37 | 12.74 | 6.56 | 1.1% | 7 |
| 8 | 20-03-10->21-02-24 | 21-02-25->21-08-19 | rsiPeriod=14, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 3.05 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 9 | 20-09-02->21-08-19 | 21-08-20->22-02-11 | rsiPeriod=14, buyThreshold=35, sellThreshold=80, atrPeriod=14 | 2.06 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 10 | 21-02-25->22-02-11 | 22-02-14->22-08-08 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 2.72 | -1.51 | -1.44 | 0.42 | 4.2% | 10 |
| 11 | 21-08-20->22-08-08 | 22-08-09->23-01-31 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 1.01 | -1.54 | -1.73 | 0.36 | 3.5% | 11 |
| 12 | 22-02-14->23-01-31 | 23-02-01->23-07-26 | rsiPeriod=21, buyThreshold=35, sellThreshold=80, atrPeriod=14 | 0.96 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 13 | 22-08-09->23-07-26 | 23-07-27->24-01-18 | rsiPeriod=21, buyThreshold=35, sellThreshold=75, atrPeriod=14 | 1.15 | -0.44 | -1.07 | 0.00 | 0.3% | 2 |
| 14 | 23-02-01->24-01-18 | 24-01-19->24-07-12 | rsiPeriod=14, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 1.07 | 1.96 | 8.06 | 3.53 | 1.5% | 6 |
| 15 | 23-07-27->24-07-12 | 24-07-15->25-01-07 | rsiPeriod=14, buyThreshold=35, sellThreshold=80, atrPeriod=14 | 1.74 | -1.98 | -2.05 | 0.00 | 2.0% | 3 |
| 16 | 24-01-19->25-01-07 | 25-01-08->25-07-04 | rsiPeriod=14, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 1.29 | 0.45 | 0.93 | 1.45 | 1.0% | 2 |
| 17 | 24-07-15->25-07-04 | 25-07-07->25-12-30 | rsiPeriod=14, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 1.47 | -1.04 | -1.59 | 0.11 | 1.2% | 3 |