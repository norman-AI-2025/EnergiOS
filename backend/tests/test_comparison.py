"""Unit tests for cross-building demand comparison and GBI benchmarking."""

import math
from src.bdg2_comparator import (
    GBI_COMMERCIAL_BASELINE_ANNUAL,
    compare_buildings,
)


def test_compare_buildings_metrics():
    mock_data = {
        "b1": {
            "asset": {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "Tower Alpha",
                "primary_space_usage": "Commercial Office",
                "floor_area_m2": 10000.0,
            },
            "readings": {
                # 24 hours of 100 kWh
                "items": [{"consumption_kwh": 100.0} for _ in range(24)]
            },
        },
        "b2": {
            "asset": {
                "id": "22222222-2222-2222-2222-222222222222",
                "name": "Tower Beta",
                "primary_space_usage": "Retail Mall",
                "floor_area_m2": 5000.0,
            },
            "readings": {
                # 24 hours varying between 50 and 150 kWh (mean 100 kWh, peak 150 kWh)
                "items": [{"consumption_kwh": 50.0 if i % 2 == 0 else 150.0} for i in range(24)]
            },
        },
    }

    resp = compare_buildings(mock_data, window_hours=24)
    assert resp.result_type == "cross_building_comparison"
    assert len(resp.buildings) == 2

    b1 = next(b for b in resp.buildings if b.name == "Tower Alpha")
    # Total = 24 * 100 = 2400 kWh
    assert b1.total_consumption_kwh == 2400.0
    assert b1.peak_demand_kw == 100.0
    assert b1.avg_demand_kw == 100.0
    # Flat load -> load factor = 100%
    assert b1.load_factor_pct == 100.0
    # Daily EUI = 2400 / 10000 = 0.24 kWh/m² · day
    assert math.isclose(b1.daily_eui_kwh_m2, 0.24, rel_tol=1e-3)
    # Annualized EUI = 0.24 * 365 = 87.6 kWh/m² · year
    assert math.isclose(b1.annualized_eui_kwh_m2, 87.6, rel_tol=1e-3)
    # vs Benchmark (185): (87.6 - 185) / 185 = -52.6%
    assert math.isclose(b1.vs_benchmark_pct, ((87.6 - 185.0) / 185.0) * 100.0, rel_tol=1e-2)

    b2 = next(b for b in resp.buildings if b.name == "Tower Beta")
    assert b2.total_consumption_kwh == 2400.0
    assert b2.peak_demand_kw == 150.0
    assert b2.avg_demand_kw == 100.0
    # Load factor = 100 / 150 = 66.7%
    assert math.isclose(b2.load_factor_pct, 66.7, rel_tol=1e-2)
    # Daily EUI = 2400 / 5000 = 0.48 kWh/m² · day
    assert math.isclose(b2.daily_eui_kwh_m2, 0.48, rel_tol=1e-3)
