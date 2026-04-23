# Backtest Report: combined / combined

**Period:** 2016-04-23 – 2026-04-23
**Initial Capital:** ¥1,000,000

## KPIs

| Metric | Value |
|---|---|
| Sharpe | 0.496 |
| MAR | 0.187 |
| Profit Factor | 1.167 |
| Max Drawdown | 25.27% |
| Total Return | 58.58% |
| Win Rate | 51.08% |
| Trades | 832 |
| Expectancy | ¥704 |

## Parameters

```json
{
  "strategies": [
    {
      "name": "donchian",
      "params": {
        "entryPeriod": 20,
        "exitPeriod": 55,
        "atrPeriod": 14
      }
    },
    {
      "name": "ma-crossover",
      "params": {
        "shortEma": 20,
        "longEma": 50,
        "atrPeriod": 14
      }
    },
    {
      "name": "rsi-reversion",
      "params": {
        "rsiPeriod": 14,
        "buyThreshold": 30,
        "sellThreshold": 70,
        "atrPeriod": 14
      }
    },
    {
      "name": "nr7-breakout",
      "params": {
        "lookback": 7,
        "atrPeriod": 14
      }
    }
  ],
  "limits": {
    "totalMax": 6,
    "perStrategyMax": 2,
    "perPairMax": 2
  }
}
```

## Trades Summary

- **Total Trades:** 832
- **Winners:** 425
- **Losers:** 407
- **Largest Win:** ¥86,544
- **Largest Loss:** -¥18,081
- **Avg Holding Days:** 4.27

## Exit Reason Breakdown

| Reason | Count |
|---|---|
| sl | 294 |
| trailing | 337 |
| time | 201 |
| signal | 0 |
| end_of_data | 0 |

## Equity Curve (sampled)

- Start: 2016-04-25 ¥1,000,000
- Max: 2025-03-12 ¥1,765,541
- Min: 2020-03-03 ¥807,211
- End: 2026-04-22 ¥1,585,835
