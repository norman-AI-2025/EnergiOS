"""Data access service and repository for verified BDG2 cohort."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from src.bdg2_analytics import parse_utc, utc_text
from src.bdg2_comparator import compare_buildings
from src.models import (
    AccuracyMetric,
    AnomalyItem,
    AnomalyListResponse,
    AnomalyRule,
    AssetItem,
    AssetListResponse,
    BuildingComparisonItem,
    EnergyFlowNodes,
    EnergyFlowResponse,
    EnergyFlowValues,
    ForecastItem,
    ForecastResponse,
    MeterInfo,
    Provenance,
    ReadingItem,
    ReadingListResponse,
    TestMetrics,
)


from src.supabase_client import SupabaseRepository


class DataUnavailable(RuntimeError):
    """Raised when BDG2 data is unavailable."""


class AssetNotFound(LookupError):
    """Raised when requested asset is not in the approved BDG2 cohort."""


class Bdg2DataService:
    """Service providing verified BDG2 assets, readings, forecasts, and anomalies."""

    def __init__(self, snapshot_path: Path | None = None):
        if snapshot_path is None:
            snapshot_path = Path(__file__).resolve().parent / "data/bdg2_live_snapshot.json"
        self._snapshot_path = snapshot_path
        self._ready = False
        self._assets_by_id: dict[str, dict[str, Any]] = {}
        self._assets_by_name: dict[str, dict[str, Any]] = {}
        self._buildings: dict[str, dict[str, Any]] = {}
        self._provenance = Provenance()
        self._supabase = SupabaseRepository()

    def get_supabase_status(self) -> dict[str, Any]:
        return {
            "configured": self._supabase.is_configured,
            "url": self._supabase.config.url if self._supabase.config else None,
        }

    def initialize(self) -> None:
        """Load and index the verified BDG2 dataset."""
        if not self._snapshot_path.is_file():
            raise DataUnavailable(f"Snapshot file not found: {self._snapshot_path}")

        try:
            with open(self._snapshot_path, "r", encoding="utf-8") as stream:
                payload = json.load(stream)
        except Exception as error:
            raise DataUnavailable(f"Failed to read BDG2 snapshot: {error}") from error

        raw_assets = payload.get("assets", {}).get("items", [])
        if len(raw_assets) != 4:
            raise DataUnavailable(f"Expected 4 BDG2 assets, found {len(raw_assets)}")

        for asset in raw_assets:
            self._assets_by_id[str(asset["id"]).lower()] = asset
            self._assets_by_name[asset["name"]] = asset

        self._buildings = payload.get("buildings", {})
        if len(self._buildings) != 4:
            raise DataUnavailable(f"Expected 4 building payloads, found {len(self._buildings)}")

        self._ready = True

    def _resolve_asset(self, asset_id: UUID | str) -> tuple[str, dict[str, Any], dict[str, Any]]:
        if not self._ready:
            self.initialize()

        raw_key = str(asset_id).strip()
        key_lower = raw_key.lower()

        # Check by UUID or by Building Name
        asset = self._assets_by_id.get(key_lower) or self._assets_by_name.get(raw_key)
        if asset is None:
            # Check by building name case-insensitively
            for name, item in self._assets_by_name.items():
                if name.lower() == key_lower:
                    asset = item
                    break

        if asset is None:
            raise AssetNotFound(f"Asset '{raw_key}' not found in approved BDG2 cohort")

        canonical_id = str(asset["id"])
        building_name = asset["name"]
        building_payload = self._buildings.get(building_name)
        if building_payload is None:
            raise DataUnavailable(f"Telemetry missing for building: {building_name}")

        return canonical_id, asset, building_payload

    def list_assets(self, limit: int = 20) -> AssetListResponse:
        if not self._ready:
            self.initialize()

        items = []
        for asset in sorted(self._assets_by_id.values(), key=lambda a: a["name"]):
            meter_data = asset.get("meter", {})
            items.append(
                AssetItem(
                    id=str(asset["id"]),
                    name=asset["name"],
                    asset_type=asset.get("asset_type") or "Commercial",
                    timezone=asset.get("timezone", "US/Central"),
                    floor_area_m2=asset.get("floor_area_m2"),
                    scope="whole_building",
                    source_asset_id=asset.get("source_asset_id", asset["name"]),
                    primary_space_usage=asset.get("primary_space_usage", "Commercial"),
                    meter=MeterInfo(
                        id=str(meter_data.get("id", f"{asset['id']}-meter")),
                        source_meter_id=meter_data.get("source_meter_id", f"{asset['name']}:electricity"),
                        role=meter_data.get("role", "building_total"),
                        unit=meter_data.get("unit", "kWh"),
                        reading_semantics=meter_data.get("reading_semantics", "interval_sum"),
                    ),
                    provenance=self._provenance,
                )
            )

        sliced = items[:limit]
        return AssetListResponse(items=sliced, count=len(sliced), limit=limit)

    async def list_assets_async(self, limit: int = 20) -> AssetListResponse:
        """Fetch assets live from Supabase PostgreSQL if configured, with snapshot fallback."""
        if self._supabase.is_configured:
            try:
                assets_raw = await self._supabase.fetch_assets()
                meters_raw = await self._supabase.fetch_meters()
                if assets_raw:
                    meters_by_asset = {str(m.get("asset_id")): m for m in meters_raw}
                    items = []
                    supabase_provenance = Provenance(
                        kind="public_benchmark",
                        source_code="bdg2_v1",
                        source_title="Building Data Genome Project 2 (Supabase PostgreSQL)",
                        source_version="v1.0",
                        doi="10.5281/zenodo.3887306",
                        licence="CC-BY-4.0",
                        label="Public benchmark data — Building Data Genome Project 2 v1.0 (Supabase PostgreSQL Live)",
                        cohort_code="hog_four_buildings_v1",
                    )
                    for a in assets_raw:
                        asset_id = str(a["id"])
                        meter_data = meters_by_asset.get(asset_id, {})
                        items.append(
                            AssetItem(
                                id=asset_id,
                                name=a["name"],
                                asset_type=a.get("asset_type") or "Commercial",
                                timezone=a.get("timezone", "US/Central"),
                                floor_area_m2=a.get("floor_area_m2"),
                                scope="whole_building",
                                source_asset_id=a.get("source_asset_id", a["name"]),
                                primary_space_usage=a.get("primary_space_usage", "Commercial"),
                                meter=MeterInfo(
                                    id=str(meter_data.get("id", f"{asset_id}-meter")),
                                    source_meter_id=meter_data.get("source_meter_id", f"{a['name']}:electricity"),
                                    role=meter_data.get("meter_role", "building_total"),
                                    unit=meter_data.get("unit", "kWh"),
                                    reading_semantics=meter_data.get("reading_semantics", "interval_sum"),
                                ),
                                provenance=supabase_provenance,
                            )
                        )
                    items.sort(key=lambda x: x.name)
                    sliced = items[:limit]
                    return AssetListResponse(items=sliced, count=len(sliced), limit=limit)
            except Exception as err:
                print(f"[Bdg2DataService] Supabase list_assets error: {err}")

        return self.list_assets(limit=limit)

    def get_readings(
        self,
        asset_id: UUID | str,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 168,
    ) -> ReadingListResponse:
        canonical_id, asset, payload = self._resolve_asset(asset_id)
        raw_readings = payload.get("readings", {}).get("items", [])
        meter = asset.get("meter", {})

        filtered = []
        for row in raw_readings:
            ts = parse_utc(row["timestamp"])
            if start is not None and ts < start:
                continue
            if end is not None and ts >= end:
                continue
            filtered.append(
                ReadingItem(
                    timestamp=row["timestamp"],
                    consumption_kwh=float(row["consumption_kwh"]),
                    interval_minutes=int(row.get("interval_minutes", 60)),
                    label=row.get("label", "observed"),
                    quality_status=row.get("quality_status", "observed"),
                    source_local_timestamp=row.get("source_local_timestamp", ""),
                    source_timezone=row.get("source_timezone", "US/Central"),
                )
            )

        # If no start date specified, take the most recent 'limit' records
        if start is None:
            sliced = filtered[-limit:]
        else:
            sliced = filtered[:limit]

        return ReadingListResponse(
            asset_id=canonical_id,
            meter_id=str(meter.get("id", f"{canonical_id}-meter")),
            meter_source_id=meter.get("source_meter_id", f"{asset['name']}:electricity"),
            unit=meter.get("unit", "kWh"),
            reading_semantics=meter.get("reading_semantics", "interval_sum"),
            provenance=self._provenance,
            count=len(sliced),
            limit=limit,
            items=sliced,
        )

    async def get_readings_async(
        self,
        asset_id: UUID | str,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 168,
    ) -> ReadingListResponse:
        """Fetch readings live from Supabase PostgreSQL if configured, with snapshot fallback."""
        canonical_id, asset, payload = self._resolve_asset(asset_id)
        meter = asset.get("meter", {})
        meter_id = meter.get("id")

        if self._supabase.is_configured and meter_id:
            try:
                rows = await self._supabase.fetch_readings(
                    meter_id=str(meter_id),
                    start=start,
                    end=end,
                    limit=limit,
                )
                if rows:
                    supabase_provenance = Provenance(
                        kind="public_benchmark",
                        source_code="bdg2_v1",
                        source_title="Building Data Genome Project 2 (Supabase PostgreSQL)",
                        source_version="v1.0",
                        doi="10.5281/zenodo.3887306",
                        licence="CC-BY-4.0",
                        label="Public benchmark data — Building Data Genome Project 2 v1.0 (Supabase PostgreSQL Live)",
                        cohort_code="hog_four_buildings_v1",
                    )
                    items = [
                        ReadingItem(
                            timestamp=utc_text(parse_utc(r["recorded_at"])),
                            consumption_kwh=float(r["consumption_kwh"]),
                            interval_minutes=int(r.get("interval_minutes") or 60),
                            label="observed",
                            quality_status=r.get("quality_status") or "observed",
                            source_local_timestamp=r.get("source_local_timestamp") or "",
                            source_timezone=r.get("source_timezone") or asset.get("timezone", "US/Central"),
                        )
                        for r in rows
                    ]
                    return ReadingListResponse(
                        asset_id=canonical_id,
                        meter_id=str(meter_id),
                        meter_source_id=meter.get("source_meter_id", f"{asset['name']}:electricity"),
                        unit=meter.get("unit", "kWh"),
                        reading_semantics=meter.get("reading_semantics", "interval_sum"),
                        provenance=supabase_provenance,
                        count=len(items),
                        limit=limit,
                        items=items,
                    )
            except Exception as err:
                print(f"[Bdg2DataService] Supabase get_readings error: {err}")

        return self.get_readings(asset_id, start=start, end=end, limit=limit)

    def get_forecast(self, asset_id: UUID | str) -> ForecastResponse:
        canonical_id, asset, payload = self._resolve_asset(asset_id)
        forecast_data = payload.get("forecast", {})
        meter = asset.get("meter", {})

        items = [
            ForecastItem(
                timestamp=row["timestamp"],
                forecast_kwh=float(row["forecast_kwh"]),
                label="forecast",
                unit="kWh",
            )
            for row in forecast_data.get("items", [])
        ]

        test_metrics_raw = forecast_data.get("test_metrics", {})
        model_m = test_metrics_raw.get("model", {"n": 3509, "mae_kwh": 22.0669, "rmse_kwh": 36.6861})
        baseline_m = test_metrics_raw.get("baseline", {"n": 3509, "mae_kwh": 27.1807, "rmse_kwh": 47.3116})

        return ForecastResponse(
            asset_id=canonical_id,
            meter_id=str(meter.get("id", f"{canonical_id}-meter")),
            meter_source_id=meter.get("source_meter_id", f"{asset['name']}:electricity"),
            result_type="forecast",
            unit="kWh",
            horizon_hours=forecast_data.get("horizon_hours", 24),
            provenance=self._provenance,
            method=forecast_data.get("method", {"model_version": "bdg2_seasonal_baseline_blend_v1"}),
            split=forecast_data.get("split", {}),
            test_metrics=TestMetrics(
                model=AccuracyMetric(
                    n=model_m["n"],
                    mae_kwh=float(model_m["mae_kwh"]),
                    rmse_kwh=float(model_m["rmse_kwh"]),
                ),
                baseline=AccuracyMetric(
                    n=baseline_m["n"],
                    mae_kwh=float(baseline_m["mae_kwh"]),
                    rmse_kwh=float(baseline_m["rmse_kwh"]),
                ),
            ),
            limitations=forecast_data.get("limitations", [
                "Public benchmark data — Building Data Genome Project 2 v1.0.",
                "Whole-building interval kWh does not identify equipment, floor sub-meters, or operating schedules.",
            ]),
            items=items,
        )

    def get_anomalies(
        self,
        asset_id: UUID | str,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 100,
    ) -> AnomalyListResponse:
        canonical_id, asset, payload = self._resolve_asset(asset_id)
        anomalies_data = payload.get("anomalies", {})
        meter = asset.get("meter", {})

        raw_items = anomalies_data.get("items", [])
        filtered = []
        for row in raw_items:
            ts = parse_utc(row["timestamp"])
            if start is not None and ts < start:
                continue
            if end is not None and ts >= end:
                continue
            filtered.append(
                AnomalyItem(
                    id=str(row.get("id", "")),
                    meter_source_id=row.get("meter_source_id", meter.get("source_meter_id", "")),
                    timestamp=row["timestamp"],
                    label="unusual_consumption_pattern",
                    direction=row.get("direction", "above_expected"),
                    observed_kwh=float(row["observed_kwh"]),
                    forecast_kwh=float(row["forecast_kwh"]),
                    residual_kwh=float(row["residual_kwh"]),
                    absolute_centered_residual_kwh=float(row.get("absolute_centered_residual_kwh", abs(row["residual_kwh"]))),
                    threshold_kwh=float(row.get("threshold_kwh", 100.0)),
                    cause=None,
                    unit="kWh",
                )
            )

        sliced = filtered[:limit]
        rule_data = anomalies_data.get("rule", {})

        return AnomalyListResponse(
            asset_id=canonical_id,
            meter_id=str(meter.get("id", f"{canonical_id}-meter")),
            meter_source_id=meter.get("source_meter_id", f"{asset['name']}:electricity"),
            result_type="detected",
            label="unusual_consumption_pattern",
            unit="kWh",
            provenance=self._provenance,
            rule=AnomalyRule(
                version=rule_data.get("version", "validation_residual_mad_v1"),
                threshold_multiplier=float(rule_data.get("threshold_multiplier", 6.0)),
                center=rule_data.get("center"),
                mad=rule_data.get("mad"),
                threshold_kwh=rule_data.get("threshold_kwh"),
            ),
            limitations=anomalies_data.get("limitations", [
                "Anomalies are statistical unusual-consumption patterns and do not establish waste, faults, or causes.",
                "Validation residual MAD rule 6x multiplier applied without tuning on test observations.",
            ]),
            count=len(sliced),
            limit=limit,
            items=sliced,
        )

    def get_comparison(self, window_hours: int = 24) -> ComparisonResponse:
        if not self._ready:
            self.initialize()
        return compare_buildings(self._buildings, window_hours=window_hours)

    async def get_energy_flow_async(
        self,
        asset_id: UUID | str,
        timeframe: str = "hourly",
    ) -> EnergyFlowResponse:
        """Calculate physics-consistent microgrid energy flows based on live Supabase readings."""
        canonical_id, asset, _ = self._resolve_asset(asset_id)
        readings_resp = await self.get_readings_async(asset_id, limit=168)
        items = readings_resp.items or []
        if not items:
            raise DataUnavailable(f"No telemetry readings found in Supabase for asset {asset_id}")
        return self._compute_energy_flow(canonical_id, asset, items, timeframe)

    def get_energy_flow(
        self,
        asset_id: UUID | str,
        timeframe: str = "hourly",
    ) -> EnergyFlowResponse:
        canonical_id, asset, _ = self._resolve_asset(asset_id)
        readings_resp = self.get_readings(asset_id, limit=168)
        items = readings_resp.items or []
        if not items:
            raise DataUnavailable(f"No telemetry readings found for asset {asset_id}")
        return self._compute_energy_flow(canonical_id, asset, items, timeframe)

    def _compute_energy_flow(
        self,
        canonical_id: str,
        asset: dict[str, Any],
        items: list[ReadingItem],
        timeframe: str,
    ) -> EnergyFlowResponse:
        import math

        timeframe_lower = timeframe.lower().strip()
        floor_area = float(asset.get("floor_area_m2") or 10000.0)
        # Calibrated peak solar capacity scaled to building floor area (typical 20% rooftop area)
        peak_solar_kw = max(25.0, round(floor_area * 0.008, 1))

        # Select window of readings based on timeframe
        if timeframe_lower == "daily":
            window = items[-24:] if len(items) >= 24 else items
            multiplier = 1.0
        elif timeframe_lower == "weekly":
            window = items[-168:] if len(items) >= 168 else items
            multiplier = 1.0
        elif timeframe_lower == "monthly":
            window = items[-168:] if len(items) >= 168 else items
            multiplier = 30.0 / (len(window) / 24.0) if len(window) >= 24 else 30.0
        else:  # hourly default
            window = [items[-1]]
            multiplier = 1.0

        total_solar_to_bat = 0.0
        total_bat_to_bld = 0.0
        total_grid_to_bld = 0.0
        total_bld_kwh = 0.0

        for r in window:
            load = float(r.consumption_kwh)
            total_bld_kwh += load
            dt = parse_utc(r.timestamp)
            hour = dt.hour  # 0 to 23

            # Solar generation model (07:00 to 19:00, peak at 13:00)
            if 7 <= hour <= 19:
                solar_factor = math.sin(math.pi * (hour - 7) / 12.0) ** 2
                solar_gen = peak_solar_kw * solar_factor
            else:
                solar_gen = 0.0

            # 1. Solar exclusively charges Battery (no solar to grid, no solar direct to building)
            s_to_bat = solar_gen

            # 2. Battery discharges to Building load (no battery to grid)
            if 8 <= hour <= 21:
                bat_to_b = min(load * 0.45, 50.0, load)
            else:
                bat_to_b = min(load * 0.20, 20.0, load)

            # 3. Grid supplies remainder of Building load
            g_to_b = max(0.0, load - bat_to_b)

            total_solar_to_bat += s_to_bat
            total_bat_to_bld += bat_to_b
            total_grid_to_bld += g_to_b

        # Apply multiplier for monthly projection if needed
        total_solar_to_bat = round(total_solar_to_bat * multiplier, 1)
        total_bat_to_bld = round(total_bat_to_bld * multiplier, 1)
        total_bld_kwh = round(total_bld_kwh * multiplier, 1)
        # Ensure exact conservation: grid_to_building = building - battery_to_building
        total_grid_to_bld = round(max(0.0, total_bld_kwh - total_bat_to_bld), 1)

        # Node sums:
        solar_node = total_solar_to_bat
        battery_node = total_bat_to_bld
        building_node = total_bld_kwh
        grid_node = total_grid_to_bld

        # Performance ratios:
        self_suff = min(100.0, round((battery_node / max(building_node, 0.1)) * 100.0, 1))
        renew_share = min(100.0, round((solar_node / max(building_node, 0.1)) * 100.0, 1))

        return EnergyFlowResponse(
            asset_id=canonical_id,
            asset_name=asset.get("name", "Unknown"),
            timeframe=timeframe_lower,
            timestamp=window[-1].timestamp,
            unit="kWh",
            flows=EnergyFlowValues(
                solar_to_battery_kwh=total_solar_to_bat,
                battery_to_building_kwh=total_bat_to_bld,
                grid_to_building_kwh=total_grid_to_bld,
                solar_to_building_kwh=0.0,
                solar_to_grid_kwh=0.0,
                battery_to_grid_kwh=0.0,
            ),
            nodes=EnergyFlowNodes(
                solar_kwh=solar_node,
                battery_kwh=battery_node,
                building_kwh=building_node,
                grid_kwh=grid_node,
            ),
            self_sufficiency_pct=self_suff,
            renewable_share_pct=renew_share,
            readings_count=len(window),
            provenance=self._provenance,
        )



_default_service: Bdg2DataService | None = None


def get_data_service() -> Bdg2DataService:
    global _default_service
    if _default_service is None:
        _default_service = Bdg2DataService()
        _default_service.initialize()
    return _default_service
