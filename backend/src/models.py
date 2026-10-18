"""Pydantic schemas and typed response models for EnergiOS backend."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str = "1"


class Provenance(BaseModel):
    model_config = ConfigDict(extra="ignore")
    kind: str = "public_benchmark"
    source_code: str = "bdg2_v1"
    source_title: str = "Building Data Genome Project 2"
    source_version: str = "v1.0"
    doi: str = "10.5281/zenodo.3887306"
    licence: str = "CC-BY-4.0"
    label: str = "Public benchmark data — Building Data Genome Project 2 v1.0"
    cohort_code: str = "hog_four_buildings_v1"


class MeterInfo(BaseModel):
    id: str
    source_meter_id: str
    role: str = "building_total"
    unit: str = "kWh"
    reading_semantics: str = "interval_sum"


class AssetItem(BaseModel):
    id: str
    name: str
    asset_type: str
    timezone: str = "US/Central"
    floor_area_m2: float | None = None
    scope: str = "whole_building"
    source_asset_id: str
    primary_space_usage: str
    meter: MeterInfo
    provenance: Provenance = Field(default_factory=Provenance)


class AssetListResponse(BaseModel):
    items: list[AssetItem]
    count: int
    limit: int


class ReadingItem(BaseModel):
    timestamp: str
    consumption_kwh: float
    interval_minutes: int = 60
    label: str = "observed"
    quality_status: str = "observed"
    source_local_timestamp: str
    source_timezone: str = "US/Central"


class ReadingListResponse(BaseModel):
    asset_id: str
    meter_id: str
    meter_source_id: str
    unit: str = "kWh"
    reading_semantics: str = "interval_sum"
    provenance: Provenance = Field(default_factory=Provenance)
    count: int
    limit: int
    items: list[ReadingItem]


class AccuracyMetric(BaseModel):
    n: int
    mae_kwh: float
    rmse_kwh: float


class TestMetrics(BaseModel):
    model: AccuracyMetric
    baseline: AccuracyMetric


class ForecastItem(BaseModel):
    timestamp: str
    forecast_kwh: float
    label: Literal["forecast"] = "forecast"
    unit: str = "kWh"


class ForecastResponse(BaseModel):
    asset_id: str
    meter_id: str
    meter_source_id: str
    result_type: Literal["forecast"] = "forecast"
    unit: str = "kWh"
    horizon_hours: int = 24
    provenance: Provenance = Field(default_factory=Provenance)
    method: dict[str, Any] = Field(default_factory=dict)
    split: dict[str, Any] = Field(default_factory=dict)
    test_metrics: TestMetrics
    limitations: list[str] = Field(default_factory=list)
    items: list[ForecastItem]


class AnomalyRule(BaseModel):
    version: str = "validation_residual_mad_v1"
    threshold_multiplier: float = 6.0
    center: float | None = None
    mad: float | None = None
    threshold_kwh: float | None = None


class AnomalyItem(BaseModel):
    id: str
    meter_source_id: str
    timestamp: str
    label: Literal["unusual_consumption_pattern"] = "unusual_consumption_pattern"
    direction: Literal["above_expected", "below_expected"]
    observed_kwh: float
    forecast_kwh: float
    residual_kwh: float
    absolute_centered_residual_kwh: float
    threshold_kwh: float
    cause: None = None
    unit: str = "kWh"


class AnomalyListResponse(BaseModel):
    asset_id: str
    meter_id: str
    meter_source_id: str
    result_type: Literal["detected"] = "detected"
    label: str = "unusual_consumption_pattern"
    unit: str = "kWh"
    provenance: Provenance = Field(default_factory=Provenance)
    rule: AnomalyRule = Field(default_factory=AnomalyRule)
    limitations: list[str] = Field(default_factory=list)
    count: int
    limit: int
    items: list[AnomalyItem]


class EnergyFlowValues(BaseModel):
    solar_to_battery_kwh: float
    battery_to_building_kwh: float
    grid_to_building_kwh: float
    solar_to_building_kwh: float = 0.0
    solar_to_grid_kwh: float = 0.0
    battery_to_grid_kwh: float = 0.0


class EnergyFlowNodes(BaseModel):
    solar_kwh: float
    battery_kwh: float
    building_kwh: float
    grid_kwh: float


class EnergyFlowResponse(BaseModel):
    result_type: Literal["energy_flow"] = "energy_flow"
    asset_id: str
    asset_name: str
    timeframe: str
    timestamp: str
    unit: str = "kWh"
    flows: EnergyFlowValues
    nodes: EnergyFlowNodes
    self_sufficiency_pct: float
    renewable_share_pct: float
    readings_count: int
    provenance: Provenance = Field(default_factory=Provenance)


class BuildingComparisonItem(BaseModel):
    asset_id: str
    name: str
    usage: str
    floor_area_m2: float
    total_consumption_kwh: float
    peak_demand_kw: float
    avg_demand_kw: float
    min_demand_kw: float
    load_factor_pct: float
    daily_eui_kwh_m2: float
    annualized_eui_kwh_m2: float
    vs_benchmark_pct: float


class BenchmarkReference(BaseModel):
    name: str = "GBI Commercial Baseline (Green Building Index Malaysia)"
    annual_eui_kwh_m2: float = 185.0
    daily_eui_kwh_m2: float = 0.5068
    description: str = "Standardized baseline for commercial energy intensity benchmarking"


class ComparisonResponse(BaseModel):
    result_type: Literal["cross_building_comparison"] = "cross_building_comparison"
    window_hours: int
    provenance: Provenance = Field(default_factory=Provenance)
    benchmark: BenchmarkReference = Field(default_factory=BenchmarkReference)
    cohort_summary: dict[str, Any]
    buildings: list[BuildingComparisonItem]


class ChatMessage(BaseModel):
    role: Literal["user", "model", "system"]
    content: str


class ChatRequest(BaseModel):
    message: str
    building_id: str | None = None
    history: list[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    response: str
    agent_logs: list[str] = Field(default_factory=list)
    building_context: str | None = None
    model: str = "gemini-2.5-flash"
    provenance: Provenance = Field(default_factory=Provenance)
