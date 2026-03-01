# Lake Sammamish Seasonal Outlook

Year-long swim score projection for Lake Sammamish, WA.
**Live site**: https://strawbo.github.io/lake-sammamish-seasonal

## Architecture

Static site generated daily by GitHub Actions. A Python script queries historical data from Supabase, projects comfort scores for every day of the year, outputs `data.json`, and the frontend renders it with Chart.js.

```
Supabase DB (lake_data + met_data)
        ↓
  GitHub Actions (daily at 6:30 AM PT)
        ↓
  generate_forecast.py
        ↓
  docs/data.json → docs/index.html + app.js (GitHub Pages)
```

## Companion Site

**Swim Score (real-time)**: https://strawbo.github.io/lake-sammamish
- Repo: `/Users/snielson/dev/Personal/lake-sammamish`
- Real-time 8-day forecast, updated every 4 hours
- Shares the same Supabase database
- Nav links connect the two sites
- Backfill scripts and DB migrations live in that repo

## Key Files

| File | Purpose |
|------|---------|
| `scripts/generate_forecast.py` | Main script: queries DB, projects 365-day forecast, outputs JSON |
| `docs/index.html` | Frontend HTML with metric pills, chart, detail panel, tier guide |
| `docs/app.js` | Frontend JS: Chart.js rendering, metric switching, click-to-detail |
| `docs/style.css` | Styling |
| `docs/data.json` | Generated output (365 days of projections + actuals + historical avg) |
| `.github/workflows/generate.yml` | Daily automation |

## Database (shared with lake-sammamish repo)

Uses the same Supabase PostgreSQL database. Key tables:

**lake_data** — Historical water temperatures by day-of-year
- Surface readings: `depth_m < 1.5`, `temperature_c` converted to °F
- Averaged across all years by DOY for historical norms

**met_data** — Historical weather observations
- `air_temperature_c`, `wind_speed_ms`, `solar_radiation_w`, `precipitation_mm`, `us_aqi`
- Averaged by DOY with ±7 day smoothing window for weather norms

## Forecast Generation (generate_forecast.py)

### Data Flow
1. Query historical water temps averaged by day-of-year
2. Query weather norms (air temp, wind, solar, precip, AQI) averaged by DOY
3. Calculate current year warm/cold bias vs historical average
4. Query current year actuals (water temp, air temp, solar, precip, AQI)
5. For each day of year: project conditions using historical norms + year bias
6. Apply 7-day rolling average smoothing
7. Generate historical average comfort scores for comparison
8. Output JSON with forecast, historical_avg, actuals arrays

### Projection Logic
- **Water temp**: Historical DOY norm + year bias (°F)
- **Air temp**: Historical DOY norm + 0.3× year bias
- **Wind/Solar/Rain/AQI**: Historical DOY norms (with sinusoidal fallbacks if data sparse)
- **Blending zone**: 14-day smooth transition from last actuals to forecast
- **Smoothing**: 7-day centered rolling average on all metrics

### Fallback Models (used if historical data is sparse)
- `seasonal_air_temp_f(doy)`: Sinusoidal, 40°F Jan → 80°F July
- `seasonal_solar_w(doy)`: Sinusoidal, 350-650 W/m²
- `seasonal_wind_mph(doy)`: Cosinusoidal, windier in winter
- `seasonal_rain_pct(doy)`: Sinusoidal, dry summer / wet winter

## Comfort Score Model

Same weighted model as the real-time swim score:

| Factor | Weight | Score curve |
|--------|--------|-------------|
| Water temp | 30% | 45°F→0, 72°F→85, 78°F→100 |
| Air temp | 20% | 50°F→0, 85°F→100 |
| Wind | 15% | 0-3mph→100, 25+mph→0 |
| Sun/Solar | 10% | 0W→0, 700W→100 |
| Rain | 10% | Linear inverse of probability |
| Clarity | 5% | Fixed neutral (75) — no seasonal data |
| Algae | 2.5% | Fixed neutral (80) — no seasonal data |
| AQI | 2.5% | 0-50→100, 200→0 |
| Baseline | 5% | Fixed 5 pts |

**Labels**: Excellent (80-100), Good (60-79), Fair (40-59), Poor (20-39), Unsafe (0-19)

## Frontend (app.js)

### Metric Charts (6 selectable via pills)
| Metric | Y-axis | Color | Has actuals? |
|--------|--------|-------|-------------|
| Swim Score | 0-100 | #2980b9 | No (projected only) |
| Water Temp | 35-85°F | #e67e22 | Yes |
| Air Temp | 30-100°F | #e74c3c | Yes |
| Solar | 0-1000 W/m² | #f1c40f | Yes |
| Rain | 0-100% | #3498db | No |
| AQI | 0-150 | #9b59b6 | Yes |

### Features
- Chart spans full calendar year (Jan 1 - Dec 31)
- Actual data shown as solid line, forecast as dashed line
- Historical average as gray dashed reference line
- "Today" vertical dashed line
- Swim Score chart has colored tier bands (Excellent/Good/Fair/Poor/Unsafe)
- Click any point to see detailed day breakdown with component score bars
- Subtitle shows when conditions first reach "Good" and "Excellent"
- Bias info strip: "Water is trending X°F warmer/colder than average"

## data.json Structure

```json
{
  "generated_at": "2026-02-28T21:21:14",
  "year": 2026,
  "bias_f": 2.0,
  "forecast": [{ "date", "overall_score", "label", "water_temp_f", "air_temp_f",
                  "wind_mph", "solar_w", "rain_pct", "aqi", "component_scores", "smoothed_score" }, ...],
  "historical_avg": [{ "date", "score", "water_temp_f", "air_temp_f", "solar_w",
                        "rain_pct", "aqi", "smoothed_score" }, ...],
  "actuals": [{ "date", "water_temp_f", "air_temp_f", "solar_w", "precip_mm", "aqi" }, ...]
}
```

## GitHub Actions (generate.yml)

- **Schedule**: Daily at 6:30 AM PT (14:30 UTC)
- **Manual trigger**: workflow_dispatch
- Steps: checkout → python 3.12 → install deps → run generate_forecast.py → commit & push data.json
- Auto-commit: "Update forecast data" (only if data.json changed)
- Permissions: `contents: write`

## Secrets

- `SUPABASE_DB_URL` — Same PostgreSQL connection string as lake-sammamish repo

## Git

- Remote: `https://github.com/strawbo/lake-sammamish-seasonal`
- Branch: `main` only
- GitHub Pages serves from `docs/` directory

## Development Notes

- Python 3.12, deps in `requirements.txt`
- Local `.env` file with `SUPABASE_DB_URL`
- Includes IPv4 monkey-patch for GitHub Actions DNS resolution
- DB migrations and backfill scripts live in the lake-sammamish repo
- `precip_mm_to_pct(mm)` converts mm to rain penalty: `min(100, mm * 15)`
