"""Unit tests for mathematical models, MAE/RMSE metrics, and MAD 6x anomaly detector."""

import math
from datetime import datetime, timezone
from src.bdg2_analytics import (
    Point,
    SeasonalProfile,
    detect_anomalies,
    metrics,
    robust_threshold,
)


def test_metrics_calculation():
    actual = [10.0, 20.0, 30.0]
    predicted = [12.0, 18.0, 35.0]

    res = metrics(actual, predicted)
    assert res["n"] == 3
    # Absolute errors: 2, 2, 5 -> mean = 3.0
    assert res["mae_kwh"] == 3.0
    # Squared errors: 4, 4, 25 -> sum = 33 / 3 = 11 -> sqrt(11) = 3.316625
    assert math.isclose(res["rmse_kwh"], math.sqrt(11.0), rel_tol=1e-5)


def test_robust_threshold_validation_mad():
    residuals = [0.0, 1.0, -1.0, 0.5, -0.5, 2.0, -2.0]
    center, mad, threshold = robust_threshold(residuals)

    assert center == 0.0
    assert mad > 0.0
    # threshold = 6.0 * 1.4826 * mad
    expected_threshold = 6.0 * 1.4826 * mad
    assert math.isclose(threshold, expected_threshold, rel_tol=1e-5)


def test_anomaly_detection_surges_and_drops():
    center = 0.0
    threshold = 10.0

    rows = [
        # Normal
        {
            "timestamp": datetime(2026, 1, 1, 10, tzinfo=timezone.utc),
            "actual": 105.0,
            "prediction": 100.0,
            "residual": 5.0,
        },
        # Surge anomaly
        {
            "timestamp": datetime(2026, 1, 1, 11, tzinfo=timezone.utc),
            "actual": 130.0,
            "prediction": 100.0,
            "residual": 30.0,
        },
        # Drop anomaly
        {
            "timestamp": datetime(2026, 1, 1, 12, tzinfo=timezone.utc),
            "actual": 70.0,
            "prediction": 100.0,
            "residual": -30.0,
        },
    ]

    detected = detect_anomalies(rows, center=center, threshold=threshold, meter_name="test_meter")

    assert len(detected) == 2

    surge = next(d for d in detected if d["direction"] == "above_expected")
    assert surge["observed_kwh"] == 130.0
    assert surge["residual_kwh"] == 30.0
    assert surge["cause"] is None
    assert surge["label"] == "unusual_consumption_pattern"

    drop = next(d for d in detected if d["direction"] == "below_expected")
    assert drop["observed_kwh"] == 70.0
    assert drop["residual_kwh"] == -30.0
    assert drop["cause"] is None
    assert drop["label"] == "unusual_consumption_pattern"


def test_seasonal_profile_expected():
    by_hour = tuple([float(i) for i in range(168)])
    profile = SeasonalProfile(by_hour_of_week=by_hour, overall_mean=50.0)

    # Monday 00:00 UTC (weekday 0, hour 0) -> index 0
    dt_mon_0 = datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc)
    assert profile.expected(dt_mon_0) == 0.0

    # Tuesday 14:00 UTC (weekday 1, hour 14) -> index 1*24 + 14 = 38
    dt_tue_14 = datetime(2026, 1, 6, 14, 0, tzinfo=timezone.utc)
    assert profile.expected(dt_tue_14) == 38.0
