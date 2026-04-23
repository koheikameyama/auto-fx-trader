# Walk-Forward Report: ma-crossover / GBPUSD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Failure reasons:**
- OOS Sharpe -0.055 < min 1
- OOS MAR 0.029 < min 0.5
- OOS PF 1.249 < min 1.3
- IS->OOS Sharpe drop 107.05% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | -0.055 |
| OOS Avg MAR | 0.029 |
| OOS Avg PF | 1.249 |
| OOS Max DD | 1.34% |
| OOS Avg Total Return | 0.01% |
| IS->OOS Sharpe Drop | 107.05% |

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
| 0 | 16-04-25->17-04-11 | 17-04-12->17-10-05 | shortEma=10, longEma=50, atrPeriod=14 | 0.32 | 0.62 | 1.46 | 1.94 | 1.3% | 3 |
| 1 | 16-10-18->17-10-05 | 17-10-06->18-04-02 | shortEma=10, longEma=50, atrPeriod=14 | 1.16 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 2 | 17-04-12->18-04-02 | 18-04-03->18-09-25 | shortEma=20, longEma=50, atrPeriod=14 | 0.08 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 3 | 17-10-06->18-09-25 | 18-09-26->19-03-20 | shortEma=30, longEma=100, atrPeriod=14 | 1.96 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 4 | 18-04-03->19-03-20 | 19-03-21->19-09-13 | shortEma=20, longEma=50, atrPeriod=14 | 0.30 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 5 | 18-09-26->19-09-13 | 19-09-16->20-03-09 | shortEma=10, longEma=100, atrPeriod=14 | 0.95 | -2.05 | -2.08 | 0.00 | 1.0% | 2 |
| 6 | 19-03-21->20-03-09 | 20-03-10->20-09-01 | shortEma=30, longEma=50, atrPeriod=14 | 0.82 | -0.43 | -0.85 | 0.53 | 1.1% | 2 |
| 7 | 19-09-16->20-09-01 | 20-09-02->21-02-24 | shortEma=10, longEma=100, atrPeriod=14 | 0.73 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 8 | 20-03-10->21-02-24 | 21-02-25->21-08-19 | shortEma=10, longEma=100, atrPeriod=14 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 9 | 20-09-02->21-08-19 | 21-08-20->22-02-11 | shortEma=20, longEma=100, atrPeriod=14 | 1.05 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 10 | 21-02-25->22-02-11 | 22-02-14->22-08-08 | shortEma=10, longEma=50, atrPeriod=14 | -0.56 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 11 | 21-08-20->22-08-08 | 22-08-09->23-01-31 | shortEma=10, longEma=50, atrPeriod=14 | 0.05 | -0.00 | -0.02 | 0.00 | 0.3% | 1 |
| 12 | 22-02-14->23-01-31 | 23-02-01->23-07-26 | shortEma=10, longEma=50, atrPeriod=14 | 1.03 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 13 | 22-08-09->23-07-26 | 23-07-27->24-01-18 | shortEma=20, longEma=50, atrPeriod=14 | 1.01 | 0.89 | 2.05 | 10.00 | 0.8% | 1 |
| 14 | 23-02-01->24-01-18 | 24-01-19->24-07-12 | shortEma=20, longEma=100, atrPeriod=14 | 1.57 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 15 | 23-07-27->24-07-12 | 24-07-15->25-01-07 | shortEma=10, longEma=50, atrPeriod=14 | 0.69 | 0.02 | 0.01 | 10.00 | 0.8% | 1 |
| 16 | 24-01-19->25-01-07 | 25-01-08->25-07-04 | shortEma=10, longEma=50, atrPeriod=14 | 1.88 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 17 | 24-07-15->25-07-04 | 25-07-07->25-12-30 | shortEma=10, longEma=100, atrPeriod=14 | 0.93 | -0.03 | -0.07 | 0.00 | 0.5% | 1 |