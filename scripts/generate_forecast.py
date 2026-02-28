"""Generate a 6-month seasonal comfort forecast for Lake Sammamish.

Uses historical buoy data (water temp, turbidity, algae) and historical
weather norms to project daily peak comfort scores forward 6 months.

The approach:
1. Query historical water temps by day-of-year, averaged across all years
2. Query this year's water temp trend to compute a warm/cold bias
3. Use historical weather norms (air temp, wind, sun, rain) by day-of-year
4. Run the comfort scoring model for each future day using projected values
5. Output JSON for the frontend chart
"""

import os
import json
import math
import socket
import numpy as np
import pandas as pd
from urllib.parse import urlparse, urlunparse
from datetime import datetime, timedelta
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
DB_URL = os.getenv("SUPABASE_DB_URL")


def resolve_to_ipv4(url):
    """Replace hostname with IPv4 address to avoid IPv6 issues on GitHub Actions."""
    parsed = urlparse(url)
    hostname = parsed.hostname
    try:
        ipv4 = socket.getaddrinfo(hostname, None, socket.AF_INET)[0][4][0]
        # Replace hostname with IP, preserving port and credentials
        netloc = parsed.netloc.replace(hostname, ipv4)
        return urlunparse(parsed._replace(netloc=netloc))
    except socket.gaierror:
        return url  # Fall back to original


# --- Comfort scoring functions (same as compute_comfort.py) ---

def _interpolate(x, points):
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0)
            return y0 + t * (y1 - y0)
    return points[-1][1]


def score_water_temp(f):
    if f is None: return 50
    return _interpolate(f, [(45,0),(55,30),(60,50),(65,65),(68,75),(72,85),(75,93),(78,100)])

def score_air_temp(f):
    if f is None: return 50
    return _interpolate(f, [(50,0),(60,30),(68,60),(75,80),(80,93),(85,100)])

def score_wind(mph):
    if mph is None: return 50
    return _interpolate(mph, [(0,100),(3,100),(5,90),(10,65),(15,35),(20,10),(25,0)])

def score_sun(w):
    if w is None: return 50
    return _interpolate(w, [(0,0),(50,10),(100,30),(300,60),(500,85),(700,100)])

def score_rain(pct):
    if pct is None: return 50
    return max(0, min(100, 100 - pct))

def compute_comfort(water_f, air_f, wind_mph, solar_w, rain_pct):
    """Simplified comfort score using the major factors."""
    scores = {
        "water_temp": score_water_temp(water_f),
        "air_temp": score_air_temp(air_f),
        "wind": score_wind(wind_mph),
        "sun": score_sun(solar_w),
        "rain": score_rain(rain_pct),
    }
    weights = {"water_temp": 0.30, "air_temp": 0.20, "wind": 0.15, "sun": 0.10, "rain": 0.10}
    # Clarity, algae, AQI use neutral defaults for long-range (not predictable)
    neutral_contrib = 75 * 0.05 + 80 * 0.025 + 80 * 0.025  # clarity + algae + aqi
    baseline = 100 * 0.05  # baseline bonus

    weighted = sum(scores[k] * weights[k] for k in weights) + neutral_contrib + baseline
    return round(min(100, max(0, weighted)), 1), scores


def label_for_score(score):
    if score >= 80: return "Excellent"
    if score >= 60: return "Good"
    if score >= 40: return "Fair"
    if score >= 20: return "Poor"
    return "Unsafe"


# --- Data queries ---

def get_historical_water_temps(conn):
    """Get average water temp by day-of-year across all historical years."""
    result = conn.execute(text("""
        SELECT EXTRACT(DOY FROM date) AS doy,
               AVG(temperature_c) AS avg_temp_c,
               COUNT(*) AS n_readings
        FROM lake_data
        WHERE depth_m < 1.5
          AND temperature_c IS NOT NULL
        GROUP BY EXTRACT(DOY FROM date)
        ORDER BY doy;
    """))
    rows = result.fetchall()
    return {int(r[0]): float(r[1]) for r in rows}


def get_current_year_bias(conn):
    """Compare this year's recent water temps to historical average.

    Returns the average difference (°F) between this year and historical.
    Positive = warmer than normal, negative = colder.
    """
    result = conn.execute(text("""
        WITH current_year AS (
            SELECT EXTRACT(DOY FROM date) AS doy,
                   MAX(temperature_c) AS temp_c
            FROM lake_data
            WHERE depth_m < 1.5
              AND temperature_c IS NOT NULL
              AND date >= DATE_TRUNC('year', NOW())
              AND date <= NOW()
            GROUP BY EXTRACT(DOY FROM date)
        ),
        historical AS (
            SELECT EXTRACT(DOY FROM date) AS doy,
                   AVG(temperature_c) AS avg_temp_c
            FROM lake_data
            WHERE depth_m < 1.5
              AND temperature_c IS NOT NULL
              AND EXTRACT(YEAR FROM date) < EXTRACT(YEAR FROM NOW())
            GROUP BY EXTRACT(DOY FROM date)
        )
        SELECT AVG(c.temp_c - h.avg_temp_c) AS bias_c
        FROM current_year c
        JOIN historical h ON c.doy = h.doy;
    """))
    row = result.fetchone()
    if row and row[0] is not None:
        bias_c = float(row[0])
        return bias_c * 9 / 5  # convert to Fahrenheit
    return 0.0


def get_historical_weather_norms(conn):
    """Get historical weather norms from met_data by day-of-year.

    Returns dict of doy -> {air_temp_f, wind_mph, solar_w}
    """
    result = conn.execute(text("""
        SELECT EXTRACT(DOY FROM date) AS doy,
               AVG(air_temperature_c) AS avg_air_c,
               AVG(wind_speed_ms) AS avg_wind_ms,
               AVG(solar_radiation_w) AS avg_solar_w
        FROM met_data
        WHERE air_temperature_c IS NOT NULL
        GROUP BY EXTRACT(DOY FROM date)
        ORDER BY doy;
    """))
    rows = result.fetchall()
    norms = {}
    for r in rows:
        doy = int(r[0])
        air_c = float(r[1]) if r[1] else None
        wind_ms = float(r[2]) if r[2] else None
        solar = float(r[3]) if r[3] else None
        norms[doy] = {
            "air_temp_f": round(air_c * 9/5 + 32, 1) if air_c else None,
            "wind_mph": round(wind_ms * 2.237, 1) if wind_ms else None,
            "solar_w": round(solar, 0) if solar else None,
        }
    return norms


# --- Seasonal climate model (fallback when met_data is sparse) ---

def seasonal_air_temp_f(doy):
    """Approximate Seattle-area air temp by day of year using a sine curve.
    Peak ~80°F around day 200 (mid-July), trough ~40°F around day 15 (mid-Jan).
    """
    return 60 + 20 * math.sin(2 * math.pi * (doy - 105) / 365)


def seasonal_solar_w(doy):
    """Approximate peak solar radiation W/m² by day of year."""
    return 350 + 300 * math.sin(2 * math.pi * (doy - 80) / 365)


def seasonal_wind_mph(doy):
    """Approximate average wind. Slightly windier in winter."""
    return 7 + 3 * math.cos(2 * math.pi * (doy - 15) / 365)


def seasonal_rain_pct(doy):
    """Approximate rain probability. Dry summers, wet winters."""
    return 50 - 35 * math.sin(2 * math.pi * (doy - 80) / 365)


# --- Main ---

if __name__ == "__main__":
    db_url = resolve_to_ipv4(DB_URL)
    engine = create_engine(db_url)
    conn = engine.connect()
    print("Connected to database")

    # Get historical data
    hist_water = get_historical_water_temps(conn)
    print(f"Historical water temp data: {len(hist_water)} days-of-year")

    bias_f = get_current_year_bias(conn)
    print(f"Current year water temp bias: {bias_f:+.1f}°F vs historical")

    weather_norms = get_historical_weather_norms(conn)
    print(f"Historical weather norms: {len(weather_norms)} days-of-year")

    # Get latest actual water temp for starting point
    row = conn.execute(text("""
        SELECT temperature_c FROM lake_data
        WHERE depth_m < 1.5 AND temperature_c IS NOT NULL
        ORDER BY date DESC LIMIT 1;
    """)).fetchone()
    latest_water_f = round(float(row[0]) * 9/5 + 32, 1) if row else None
    print(f"Latest water temp: {latest_water_f}°F")

    conn.close()
    engine.dispose()

    # Generate daily projections for the next 6 months
    today = datetime.now()
    forecast_days = []

    for day_offset in range(0, 183):  # ~6 months
        date = today + timedelta(days=day_offset)
        doy = date.timetuple().tm_yday

        # Water temperature: use historical average + this year's bias
        if doy in hist_water:
            water_c = hist_water[doy]
            water_f = round(water_c * 9/5 + 32 + bias_f, 1)
        else:
            # Interpolate from nearest known days
            water_f = latest_water_f or 50

        # For the first few days, blend from actual to projected
        if day_offset < 14 and latest_water_f is not None:
            blend = day_offset / 14.0
            water_f = round(latest_water_f * (1 - blend) + water_f * blend, 1)

        # Weather: prefer historical norms, fall back to seasonal model
        if doy in weather_norms and weather_norms[doy]["air_temp_f"] is not None:
            air_f = weather_norms[doy]["air_temp_f"] + bias_f * 0.3  # slight correlation
            wind = weather_norms[doy]["wind_mph"]
            solar = weather_norms[doy]["solar_w"]
        else:
            air_f = seasonal_air_temp_f(doy) + bias_f * 0.3
            wind = seasonal_wind_mph(doy)
            solar = seasonal_solar_w(doy)

        rain = seasonal_rain_pct(doy)

        # Compute comfort score
        overall, scores = compute_comfort(water_f, air_f, wind, solar, rain)

        forecast_days.append({
            "date": date.strftime("%Y-%m-%d"),
            "overall_score": overall,
            "label": label_for_score(overall),
            "water_temp_f": water_f,
            "air_temp_f": round(air_f, 1) if air_f else None,
            "wind_mph": round(wind, 1) if wind else None,
            "solar_w": round(solar, 0) if solar else None,
            "rain_pct": round(rain, 0),
        })

    # Also generate historical year curves for comparison
    # Show what the comfort score looked like in prior years at this time
    historical_curves = {}
    for doy_offset in range(0, 183):
        date = today + timedelta(days=doy_offset)
        doy = date.timetuple().tm_yday
        if doy in hist_water:
            water_c = hist_water[doy]
            water_f_hist = round(water_c * 9/5 + 32, 1)

            if doy in weather_norms and weather_norms[doy]["air_temp_f"] is not None:
                air = weather_norms[doy]["air_temp_f"]
                w = weather_norms[doy]["wind_mph"]
                s = weather_norms[doy]["solar_w"]
            else:
                air = seasonal_air_temp_f(doy)
                w = seasonal_wind_mph(doy)
                s = seasonal_solar_w(doy)

            r = seasonal_rain_pct(doy)
            hist_score, _ = compute_comfort(water_f_hist, air, w, s, r)
            historical_curves[date.strftime("%Y-%m-%d")] = hist_score

    # Smooth the forecast with a 7-day rolling average for readability
    scores_raw = [d["overall_score"] for d in forecast_days]
    scores_smoothed = pd.Series(scores_raw).rolling(window=7, min_periods=1, center=True).mean()
    for i, d in enumerate(forecast_days):
        d["smoothed_score"] = round(float(scores_smoothed.iloc[i]), 1)

    hist_dates = sorted(historical_curves.keys())
    hist_scores_raw = [historical_curves[d] for d in hist_dates]
    hist_smoothed = pd.Series(hist_scores_raw).rolling(window=7, min_periods=1, center=True).mean()
    historical_output = [
        {"date": d, "score": round(float(hist_smoothed.iloc[i]), 1)}
        for i, d in enumerate(hist_dates)
    ]

    output = {
        "generated_at": today.strftime("%Y-%m-%dT%H:%M:%S"),
        "bias_f": round(bias_f, 1),
        "forecast": forecast_days,
        "historical_avg": historical_output,
    }

    # Write output
    os.makedirs("docs", exist_ok=True)
    with open("docs/data.json", "w") as f:
        json.dump(output, f)
    print(f"Wrote docs/data.json with {len(forecast_days)} days of forecast")
