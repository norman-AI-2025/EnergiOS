"""Bounded calendar summaries of observed hourly intervals; missing values stay absent."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import math


def summarize(rows, start, end, site_timezone, period):
    zone = ZoneInfo(site_timezone)
    buckets = {}
    cursor = start
    while cursor < end:
        local = cursor.astimezone(zone)
        key = local.strftime('%Y-%m' if period == 'monthly' else '%Y-%m-%d')
        bucket = buckets.setdefault(key, {'period': key, 'observed_kwh': None,
            'observed_intervals': 0, 'expected_intervals': 0,
            'min_hourly_kw': None, 'max_hourly_kw': None, 'latest_hourly_kw': None, 'latest_timestamp': None,
            'first_observed_date': None, 'last_observed_date': None})
        bucket['expected_intervals'] += 1
        cursor += timedelta(hours=1)
    seen = set()
    for row in rows:
        stamp = datetime.fromisoformat(row.timestamp.replace('Z', '+00:00')).astimezone(timezone.utc)
        if stamp in seen or not start <= stamp < end:
            continue
        seen.add(stamp)
        if row.label != 'observed' or row.quality_status != 'observed' or row.interval_minutes != 60:
            continue
        value = row.consumption_kwh
        if not math.isfinite(value) or value < 0:
            continue
        key = stamp.astimezone(zone).strftime('%Y-%m' if period == 'monthly' else '%Y-%m-%d')
        b = buckets[key]
        b['observed_kwh'] = (b['observed_kwh'] or 0) + value
        b['observed_intervals'] += 1
        b['min_hourly_kw'] = min(b['min_hourly_kw'] if b['min_hourly_kw'] is not None else value, value)
        b['max_hourly_kw'] = max(b['max_hourly_kw'] if b['max_hourly_kw'] is not None else value, value)
        if b['latest_timestamp'] is None or stamp > datetime.fromisoformat(b['latest_timestamp']):
            b['latest_hourly_kw'], b['latest_timestamp'] = value, stamp.isoformat()
        date = stamp.astimezone(zone).date().isoformat()
        b['first_observed_date'] = min(b['first_observed_date'] or date, date)
        b['last_observed_date'] = max(b['last_observed_date'] or date, date)
    for b in buckets.values():
        b['missing_intervals'] = b['expected_intervals'] - b['observed_intervals']
        b['coverage_pct'] = b['observed_intervals'] / b['expected_intervals'] * 100
        b['status'] = 'complete' if b['missing_intervals'] == 0 else 'partial' if b['observed_intervals'] else 'missing'
    return list(buckets.values())


def summarize_forecast(rows, site_timezone, period):
    """Aggregate only the existing 24 predicted intervals, never extend them."""
    if len(rows) != 24:
        raise ValueError('The forecast must contain exactly 24 hourly intervals')
    zone = ZoneInfo(site_timezone)
    ordered = sorted(rows, key=lambda r: r.timestamp)
    buckets = {}
    previous = None
    for row in ordered:
        stamp = datetime.fromisoformat(row.timestamp.replace('Z', '+00:00')).astimezone(timezone.utc)
        if previous is not None and stamp - previous != timedelta(hours=1):
            raise ValueError('Forecast timestamps must be unique and hourly')
        if row.label != 'forecast' or not math.isfinite(row.forecast_kwh) or row.forecast_kwh < 0:
            raise ValueError('Invalid forecast interval')
        previous = stamp
        local = stamp.astimezone(zone)
        key = local.strftime('%Y-%m' if period == 'monthly' else '%Y-%m-%d')
        beginning = local.replace(hour=0, minute=0, second=0, microsecond=0)
        if period == 'monthly':
            beginning = beginning.replace(day=1)
            following = (beginning.replace(day=28) + timedelta(days=4)).replace(day=1)
        else:
            following = beginning + timedelta(days=1)
        expected = int((following.astimezone(timezone.utc)-beginning.astimezone(timezone.utc)).total_seconds()/3600)
        b = buckets.setdefault(key, {'period':key, 'forecast_kwh':0, 'forecast_intervals':0,
            'expected_intervals':expected, 'label':'forecast', 'forecast_from':row.timestamp, 'forecast_to':row.timestamp})
        b['forecast_kwh'] += row.forecast_kwh
        b['forecast_intervals'] += 1
        b['forecast_to'] = (stamp + timedelta(hours=1)).isoformat()
    for b in buckets.values():
        b['status'] = 'complete' if b['forecast_intervals'] == b['expected_intervals'] else 'partial'
    return list(buckets.values())
