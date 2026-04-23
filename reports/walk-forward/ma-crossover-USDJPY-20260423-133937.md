# Walk-Forward Report: ma-crossover / USDJPY

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Failure reasons:**
- OOS Sharpe 0.038 < min 1
- IS->OOS Sharpe drop 94.70% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.038 |
| OOS Avg MAR | 1.203 |
| OOS Avg PF | 3.478 |
| OOS Max DD | 2.23% |
| OOS Avg Total Return | 0.16% |
| IS->OOS Sharpe Drop | 94.70% |

## Parameter Grid

```json
{
  "shortEma": [
    10,
    20,
    30
  ],
  "longEma": [
    50,
    100,
    200
  ],
  "atrPeriod": [
    14
  ]
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 16-04-25->17-04-11 | 17-04-12->17-10-05 | shortEma=10, longEma=50, atrPeriod=14 | 0.50 | 0.46 | 1.28 | 10.00 | 0.8% | 3 |
| 1 | 16-10-18->17-10-05 | 17-10-06->18-04-02 | shortEma=20, longEma=50, atrPeriod=14 | 0.19 | -0.91 | -1.68 | 0.00 | 1.2% | 2 |
| 2 | 17-04-12->18-04-02 | 18-04-03->18-09-25 | shortEma=10, longEma=50, atrPeriod=14 | 0.01 | -1.68 | -1.69 | 0.04 | 1.2% | 2 |
| 3 | 17-10-06->18-09-25 | 18-09-26->19-03-20 | shortEma=10, longEma=50, atrPeriod=14 | -1.07 | 1.62 | 8.51 | 10.00 | 0.6% | 2 |
| 4 | 18-04-03->19-03-20 | 19-03-21->19-09-13 | shortEma=20, longEma=100, atrPeriod=14 | 1.15 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 5 | 18-09-26->19-09-13 | 19-09-16->20-03-09 | shortEma=10, longEma=50, atrPeriod=14 | 1.28 | 0.90 | 2.71 | 1.95 | 1.5% | 5 |
| 6 | 19-03-21->20-03-09 | 20-03-10->20-09-01 | shortEma=10, longEma=50, atrPeriod=14 | 0.26 | 1.44 | 8.10 | 10.00 | 0.2% | 2 |
| 7 | 19-09-16->20-09-01 | 20-09-02->21-02-24 | shortEma=20, longEma=50, atrPeriod=14 | 1.11 | 0.55 | 1.73 | 10.00 | 0.6% | 1 |
| 8 | 20-03-10->21-02-24 | 21-02-25->21-08-19 | shortEma=10, longEma=50, atrPeriod=14 | 1.22 | -2.20 | -1.94 | 0.00 | 2.2% | 3 |
| 9 | 20-09-02->21-08-19 | 21-08-20->22-02-11 | shortEma=20, longEma=100, atrPeriod=14 | 0.30 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 10 | 21-02-25->22-02-11 | 22-02-14->22-08-08 | shortEma=10, longEma=50, atrPeriod=14 | -0.32 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 11 | 21-08-20->22-08-08 | 22-08-09->23-01-31 | shortEma=10, longEma=50, atrPeriod=14 | 0.00 | -0.02 | -0.05 | 0.00 | 0.5% | 1 |
| 12 | 22-02-14->23-01-31 | 23-02-01->23-07-26 | shortEma=30, longEma=50, atrPeriod=14 | 0.94 | -1.43 | -2.08 | 0.00 | 1.0% | 1 |
| 13 | 22-08-09->23-07-26 | 23-07-27->24-01-18 | shortEma=30, longEma=50, atrPeriod=14 | 1.39 | 1.03 | 3.96 | 10.00 | 0.6% | 1 |
| 14 | 23-02-01->24-01-18 | 24-01-19->24-07-12 | shortEma=20, longEma=50, atrPeriod=14 | 1.41 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 15 | 23-07-27->24-07-12 | 24-07-15->25-01-07 | shortEma=20, longEma=50, atrPeriod=14 | 0.64 | 1.20 | 3.36 | 10.00 | 0.7% | 1 |
| 16 | 24-01-19->25-01-07 | 25-01-08->25-07-04 | shortEma=20, longEma=50, atrPeriod=14 | 2.44 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 17 | 24-07-15->25-07-04 | 25-07-07->25-12-30 | shortEma=30, longEma=50, atrPeriod=14 | 1.34 | -0.28 | -0.59 | 0.61 | 1.4% | 2 |