"""Cross-building demand comparison and benchmarking engine."""

from __future__ import annotations

import statistics
from typing import Any
from src.models import BenchmarkReference, BuildingComparisonItem, ComparisonResponse, Provenance


GBI_COMMERCIAL_BASELINE_ANNUAL = 185.0  # kWh/m² · year (Green Building Index Malaysia)
GBI_COMMERCIAL_BASELINE_DAILY = round(GBI_COMMERCIAL_BASELINE_ANNUAL / 365.0, 4)  # ~0.5068 kWh/m² · day


def compare_buildings(
    buildings_data: dict[str, dict[str, Any]],
    window_hours: int = 24,
) -> ComparisonResponse:
    """
    Perform cross-building demand comparison across all monitored BDG2 cohort assets.
    Calculates total energy, peak demand, average demand, load factor, EUI, and delta vs GBI baseline.
    """
    comparison_items: list[BuildingComparisonItem] = []
    
    for asset_id, data in buildings_data.items():
        asset = data["asset"]
        readings = data.get("readings", {}).get("items", [])
        
        # Take the most recent window_hours readings
        window_readings = readings[-window_hours:] if len(readings) >= window_hours else readings
        if not window_readings:
            continue
            
        values = [float(r["consumption_kwh"]) for r in window_readings]
        area = float(asset.get("floor_area_m2") or 1.0)
        
        total_kwh = sum(values)
        peak_kw = max(values)
        avg_kw = statistics.fmean(values)
        min_kw = min(values)
        
        load_factor = (avg_kw / peak_kw * 100.0) if peak_kw > 0 else 0.0
        
        # Normalize to daily rate
        effective_days = max(len(values) / 24.0, 1.0 / 24.0)
        daily_eui = (total_kwh / effective_days) / area
        annualized_eui = daily_eui * 365.0
        
        vs_benchmark = ((annualized_eui - GBI_COMMERCIAL_BASELINE_ANNUAL) / GBI_COMMERCIAL_BASELINE_ANNUAL) * 100.0
        
        comparison_items.append(
            BuildingComparisonItem(
                asset_id=str(asset["id"]),
                name=asset["name"],
                usage=asset.get("primary_space_usage") or asset.get("asset_type") or "Commercial",
                floor_area_m2=round(area, 1),
                total_consumption_kwh=round(total_kwh, 2),
                peak_demand_kw=round(peak_kw, 2),
                avg_demand_kw=round(avg_kw, 2),
                min_demand_kw=round(min_kw, 2),
                load_factor_pct=round(load_factor, 1),
                daily_eui_kwh_m2=round(daily_eui, 4),
                annualized_eui_kwh_m2=round(annualized_eui, 1),
                vs_benchmark_pct=round(vs_benchmark, 1),
            )
        )
        
    # Sort items by floor area or name
    comparison_items.sort(key=lambda b: b.name)
    
    # Calculate cohort summary
    if comparison_items:
        cohort_total = sum(b.total_consumption_kwh for b in comparison_items)
        cohort_peak = max(b.peak_demand_kw for b in comparison_items)
        cohort_avg_lf = statistics.fmean(b.load_factor_pct for b in comparison_items)
        cohort_avg_daily_eui = statistics.fmean(b.daily_eui_kwh_m2 for b in comparison_items)
        highest_intensity = max(comparison_items, key=lambda b: b.daily_eui_kwh_m2).name
        lowest_intensity = min(comparison_items, key=lambda b: b.daily_eui_kwh_m2).name
    else:
        cohort_total = 0.0
        cohort_peak = 0.0
        cohort_avg_lf = 0.0
        cohort_avg_daily_eui = 0.0
        highest_intensity = "N/A"
        lowest_intensity = "N/A"
        
    cohort_summary = {
        "cohort_building_count": len(comparison_items),
        "cohort_total_consumption_kwh": round(cohort_total, 2),
        "cohort_coincident_peak_kw": round(cohort_peak, 2),
        "cohort_mean_load_factor_pct": round(cohort_avg_lf, 1),
        "cohort_mean_daily_eui_kwh_m2": round(cohort_avg_daily_eui, 4),
        "highest_intensity_building": highest_intensity,
        "lowest_intensity_building": lowest_intensity,
    }
    
    benchmark = BenchmarkReference(
        name="GBI Commercial Baseline (Green Building Index Malaysia)",
        annual_eui_kwh_m2=GBI_COMMERCIAL_BASELINE_ANNUAL,
        daily_eui_kwh_m2=GBI_COMMERCIAL_BASELINE_DAILY,
        description="Standard whole-building electricity consumption baseline for non-residential commercial properties in Malaysia",
    )
    
    return ComparisonResponse(
        result_type="cross_building_comparison",
        window_hours=window_hours,
        provenance=Provenance(),
        benchmark=benchmark,
        cohort_summary=cohort_summary,
        buildings=comparison_items,
    )
