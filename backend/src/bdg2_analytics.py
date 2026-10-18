"""Deterministic BDG2 analytics, energy forecasting and anomaly detection engine."""

from __future__ import annotations

import hashlib
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable


MODEL_VERSION = "bdg2_seasonal_baseline_blend_v1"
BASELINE_VERSION = "previous_day_same_hour_v1"
ANOMALY_RULE_VERSION = "validation_residual_mad_v1"
HORIZON_HOURS = 24
SEASONAL_HOURS = 168
MIN_LEVEL_OBSERVATIONS = 18
MAD_SCALE = 1.4826
ANOMALY_MULTIPLIER = 6.0
EXPECTED_SOURCE_CODE = "bdg2_v1"
EXPECTED_PROVENANCE = "public_benchmark"
ATTRIBUTION = "Public benchmark data — Building Data Genome Project 2 v1.0"


@dataclass(frozen=True)
class Point:
    timestamp: datetime
    value: float


@dataclass(frozen=True)
class Split:
    start: datetime
    train_end: datetime
    validation_end: datetime
    end: datetime


@dataclass(frozen=True)
class SeasonalProfile:
    by_hour_of_week: tuple[float, ...]
    overall_mean: float

    def expected(self, timestamp: datetime) -> float:
        value = self.by_hour_of_week[timestamp.weekday() * 24 + timestamp.hour]
        return value if math.isfinite(value) else self.overall_mean


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def utc_text(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def metrics(actual: Iterable[float], predicted: Iterable[float]) -> dict[str, float | int]:
    pairs = [(y, y_hat) for y, y_hat in zip(actual, predicted, strict=True) if math.isfinite(y) and math.isfinite(y_hat)]
    if not pairs:
        return {"n": 0, "mae_kwh": 0.0, "rmse_kwh": 0.0}
    n = len(pairs)
    mae = sum(abs(y - y_hat) for y, y_hat in pairs) / n
    rmse = math.sqrt(sum((y - y_hat) ** 2 for y, y_hat in pairs) / n)
    return {"n": n, "mae_kwh": round(mae, 6), "rmse_kwh": round(rmse, 6)}


def chronological_split(series: dict[str, list[Point]]) -> Split:
    common_start = max(points[0].timestamp for points in series.values())
    common_end = min(points[-1].timestamp for points in series.values()) + timedelta(hours=1)
    total_duration = common_end - common_start
    if total_duration < timedelta(days=21):
        raise ValueError("BDG2 evaluation requires at least three weeks of concurrent readings")
    train_duration = timedelta(days=int((total_duration.days * 0.6) // 7) * 7 or 7)
    remaining_days = (total_duration - train_duration).days
    val_duration = timedelta(days=int((remaining_days * 0.5) // 7) * 7 or 7)
    train_end = common_start + train_duration
    validation_end = train_end + val_duration
    return Split(
        start=common_start,
        train_end=train_end,
        validation_end=validation_end,
        end=common_end,
    )


def fit_profile(history: list[Point], boundary: datetime) -> SeasonalProfile:
    buckets: dict[int, list[float]] = defaultdict(list)
    values = []
    for point in history:
        if point.timestamp >= boundary:
            continue
        hour_of_week = point.timestamp.weekday() * 24 + point.timestamp.hour
        buckets[hour_of_week].append(point.value)
        values.append(point.value)
    if not values:
        raise ValueError("Cannot fit seasonal profile on an empty history slice")
    overall_mean = statistics.fmean(values)
    profile = [
        statistics.fmean(buckets[slot]) if len(buckets[slot]) >= 2 else overall_mean
        for slot in range(SEASONAL_HOURS)
    ]
    return SeasonalProfile(by_hour_of_week=tuple(profile), overall_mean=overall_mean)


def evaluate_window(
    series: list[Point],
    profile: SeasonalProfile,
    start: datetime,
    end: datetime,
) -> tuple[list[float], list[float], list[float], list[dict]]:
    actual = []
    seasonal = []
    baseline = []
    rows = []
    history = {point.timestamp: point.value for point in series if point.timestamp < end}
    current = start
    while current < end:
        if current in history and (current - timedelta(hours=24)) in history:
            y = history[current]
            y_seasonal = profile.expected(current)
            y_base = history[current - timedelta(hours=24)]
            actual.append(y)
            seasonal.append(y_seasonal)
            baseline.append(y_base)
            rows.append({
                "timestamp": current,
                "actual": y,
                "prediction": y_seasonal,
                "baseline": y_base,
                "residual": y - y_seasonal,
            })
        current += timedelta(hours=1)
    return actual, seasonal, baseline, rows


def select_blend(val_rows: list[dict]) -> float:
    best = None
    for weight_pct in range(0, 101, 5):
        w = weight_pct / 100.0
        candidate_preds = [w * r["prediction"] + (1.0 - w) * r["baseline"] for r in val_rows]
        score = metrics([r["actual"] for r in val_rows], candidate_preds)["mae_kwh"]
        candidate = (score, w)
        if best is None or candidate < best:
            best = candidate
    return best[1] if best is not None else 0.5


def apply_blend(rows: list[dict], seasonal_weight: float) -> tuple[list[float], list[float], list[dict]]:
    actual = []
    predicted = []
    blended_rows = []
    for row in rows:
        prediction = seasonal_weight * row["prediction"] + (1.0 - seasonal_weight) * row["baseline"]
        actual.append(row["actual"])
        predicted.append(prediction)
        blended_rows.append({
            **row,
            "prediction": prediction,
            "residual": row["actual"] - prediction,
        })
    return actual, predicted, blended_rows


def robust_threshold(validation_residuals: list[float]) -> tuple[float, float, float]:
    center = statistics.median(validation_residuals)
    mad = statistics.median(abs(value - center) for value in validation_residuals)
    threshold = max(ANOMALY_MULTIPLIER * MAD_SCALE * mad, 1e-9)
    return center, mad, threshold


def detect_anomalies(rows: list[dict], center: float, threshold: float, meter_name: str) -> list[dict]:
    detected = []
    for row in rows:
        deviation = abs(row["residual"] - center)
        if deviation <= threshold:
            continue
        timestamp = utc_text(row["timestamp"])
        stable_id = hashlib.sha256(
            f"{ANOMALY_RULE_VERSION}|{meter_name}|{timestamp}".encode()
        ).hexdigest()[:24]
        detected.append({
            "id": stable_id,
            "meter_source_id": meter_name,
            "timestamp": timestamp,
            "label": "unusual_consumption_pattern",
            "direction": "above_expected" if row["residual"] > center else "below_expected",
            "observed_kwh": round(row["actual"], 6),
            "forecast_kwh": round(row["prediction"], 6),
            "residual_kwh": round(row["residual"], 6),
            "absolute_centered_residual_kwh": round(deviation, 6),
            "threshold_kwh": round(threshold, 6),
            "cause": None,
            "unit": "kWh",
        })
    return detected


def forecast_24(profile: SeasonalProfile, history: dict[datetime, float], origin: datetime) -> list[float]:
    forecasts = []
    for hour_offset in range(HORIZON_HOURS):
        target_time = origin + timedelta(hours=hour_offset)
        forecasts.append(profile.expected(target_time))
    return forecasts
