# Walk-Forward Report: ma-crossover / EURUSD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Failure reasons:**
- OOS Sharpe -0.236 < min 1
- OOS MAR -0.206 < min 0.5
- IS->OOS Sharpe drop 133.59% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | -0.236 |
| OOS Avg MAR | -0.206 |
| OOS Avg PF | 1.481 |
| OOS Max DD | 3.00% |
| OOS Avg Total Return | -0.26% |
| IS->OOS Sharpe Drop | 133.59% |

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
| 0 | 16-04-25->17-04-11 | 17-04-12->17-10-05 | shortEma=10, longEma=100, atrPeriod=14 | 0.99 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 1 | 16-10-18->17-10-05 | 17-10-06->18-04-02 | shortEma=20, longEma=50, atrPeriod=14 | 0.77 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 2 | 17-04-12->18-04-02 | 18-04-03->18-09-25 | shortEma=10, longEma=100, atrPeriod=14 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 3 | 17-10-06->18-09-25 | 18-09-26->19-03-20 | shortEma=10, longEma=50, atrPeriod=14 | 1.77 | -1.46 | -1.71 | 0.18 | 3.0% | 6 |
| 4 | 18-04-03->19-03-20 | 19-03-21->19-09-13 | shortEma=10, longEma=50, atrPeriod=14 | -0.52 | -1.06 | -1.39 | 0.02 | 1.5% | 2 |
| 5 | 18-09-26->19-09-13 | 19-09-16->20-03-09 | shortEma=20, longEma=50, atrPeriod=14 | -0.38 | 0.09 | 0.18 | 2.69 | 0.1% | 2 |
| 6 | 19-03-21->20-03-09 | 20-03-10->20-09-01 | shortEma=10, longEma=100, atrPeriod=14 | 0.12 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 7 | 19-09-16->20-09-01 | 20-09-02->21-02-24 | shortEma=10, longEma=50, atrPeriod=14 | 1.86 | -1.58 | -1.44 | 0.05 | 3.0% | 4 |
| 8 | 20-03-10->21-02-24 | 21-02-25->21-08-19 | shortEma=10, longEma=50, atrPeriod=14 | 0.28 | 0.03 | 0.04 | 10.00 | 0.5% | 1 |
| 9 | 20-09-02->21-08-19 | 21-08-20->22-02-11 | shortEma=10, longEma=50, atrPeriod=14 | -0.05 | 0.52 | 1.28 | 1.72 | 1.2% | 3 |
| 10 | 21-02-25->22-02-11 | 22-02-14->22-08-08 | shortEma=20, longEma=50, atrPeriod=14 | 1.44 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 11 | 21-08-20->22-08-08 | 22-08-09->23-01-31 | shortEma=10, longEma=50, atrPeriod=14 | 0.88 | -1.43 | -2.08 | 0.00 | 1.0% | 1 |
| 12 | 22-02-14->23-01-31 | 23-02-01->23-07-26 | shortEma=10, longEma=200, atrPeriod=14 | 1.06 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 13 | 22-08-09->23-07-26 | 23-07-27->24-01-18 | shortEma=10, longEma=50, atrPeriod=14 | 0.47 | -0.03 | -0.07 | 0.00 | 0.7% | 1 |
| 14 | 23-02-01->24-01-18 | 24-01-19->24-07-12 | shortEma=10, longEma=50, atrPeriod=14 | 1.25 | 0.55 | 1.20 | 2.01 | 1.8% | 6 |
| 15 | 23-07-27->24-07-12 | 24-07-15->25-01-07 | shortEma=10, longEma=100, atrPeriod=14 | 0.71 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 16 | 24-01-19->25-01-07 | 25-01-08->25-07-04 | shortEma=20, longEma=50, atrPeriod=14 | 0.81 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 17 | 24-07-15->25-07-04 | 25-07-07->25-12-30 | shortEma=20, longEma=50, atrPeriod=14 | 1.17 | 0.14 | 0.28 | 10.00 | 0.5% | 2 |