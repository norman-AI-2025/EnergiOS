"""Weather-informed, read-only solar/grid dispatch scenario."""

from __future__ import annotations

from datetime import datetime, timezone
import math
import hashlib
import json
from typing import Literal

import httpx
from pydantic import BaseModel, Field, model_validator


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


class SolarGridRequest(BaseModel):
    asset_id: str = Field(min_length=1, max_length=100)
    location_name: str = Field(default="Demo location", min_length=1, max_length=100)
    latitude: float = Field(default=3.1390, ge=-90, le=90)
    longitude: float = Field(default=101.6869, ge=-180, le=180)
    pv_capacity_kwp: float = Field(default=100, ge=0, le=100_000)
    pv_performance_ratio: float = Field(default=0.8, gt=0, le=1)
    temperature_coefficient_per_c: float = Field(default=0.004, ge=0, le=0.02)
    reference_temperature_c: float = Field(default=25, ge=-40, le=80)
    battery_capacity_kwh: float = Field(default=400, ge=0, le=100_000)
    battery_soc_pct: float = Field(default=60, ge=0, le=100)
    battery_reserve_pct: float = Field(default=20, ge=0, le=100)
    max_charge_kw: float = Field(default=100, ge=0, le=100_000)
    max_discharge_kw: float = Field(default=100, ge=0, le=100_000)
    charge_efficiency: float = Field(default=0.92, gt=0, le=1)
    discharge_efficiency: float = Field(default=0.92, gt=0, le=1)
    grid_available: bool = True
    grid_price_per_kwh: float | None = Field(default=None, ge=0, le=1_000_000)
    grid_price_currency: str = Field(default="user-entered", min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_battery(self) -> "SolarGridRequest":
        if self.battery_reserve_pct > self.battery_soc_pct:
            raise ValueError("battery_reserve_pct cannot exceed battery_soc_pct")
        if self.battery_capacity_kwh == 0 and self.battery_soc_pct > 0:
            raise ValueError("battery_soc_pct must be zero when battery capacity is zero")
        return self

class DispatchHour(BaseModel):
    weather_timestamp: str
    demand_forecast_timestamp: str
    demand_forecast_kwh: float
    solar_estimate_kwh: float
    solar_to_load_kwh: float
    solar_to_battery_kwh: float
    battery_to_load_kwh: float
    grid_to_load_kwh: float
    unmet_demand_kwh: float
    curtailed_solar_kwh: float
    battery_soc_kwh: float
    source: Literal["solar", "battery", "grid", "mixed", "unserved"]
    reasons: list[str]
    cloud_cover_pct: float
    shortwave_radiation_w_m2: float
    temperature_c: float


class SolarGridRecommendation(BaseModel):
    recommendation_id: str = ""
    transitions: list[dict] = Field(default_factory=list)
    result_type: Literal["simulated_solar_grid_recommendation"] = "simulated_solar_grid_recommendation"
    label: Literal["Scenario estimate — no live equipment control"] = "Scenario estimate — no live equipment control"
    asset_id: str
    asset_name: str
    demand_provenance: dict
    demand_basis: str
    location: dict
    weather: dict
    assumptions: dict
    recommended_source: Literal["solar", "battery", "grid", "mixed", "unserved"]
    reasons: list[str]
    source_mix_kwh: dict[str, float]
    estimated_grid_cost: dict | None
    next_transition: dict | None
    energy_balance: dict[str, float]
    hours: list[DispatchHour]


class WeatherUnavailable(RuntimeError):
    """Raised when the external public weather forecast cannot be retrieved."""


async def fetch_open_meteo(latitude: float, longitude: float) -> dict:
    """Fetch 24 hourly weather points. No credentials are sent to Open-Meteo."""
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "cloud_cover,shortwave_radiation,temperature_2m",
        "forecast_hours": 24,
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(OPEN_METEO_URL, params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise WeatherUnavailable("Weather forecast is temporarily unavailable") from error

    if not isinstance(payload, dict) or not isinstance(payload.get("hourly"), dict):
        raise WeatherUnavailable("Weather provider returned an incomplete hourly forecast")
    hourly = payload["hourly"]
    keys = ("time", "cloud_cover", "shortwave_radiation", "temperature_2m")
    if any(not isinstance(hourly.get(key), list) for key in keys):
        raise WeatherUnavailable("Weather provider returned an incomplete hourly forecast")
    count = min(len(hourly[key]) for key in keys)
    rows = []
    for index in range(count):
        values = {key: hourly[key][index] for key in keys}
        if any(value is None for value in values.values()):
            continue
        try:
            cloud_cover = float(values["cloud_cover"])
            radiation = float(values["shortwave_radiation"])
            temperature = float(values["temperature_2m"])
        except (TypeError, ValueError) as error:
            raise WeatherUnavailable("Weather provider returned invalid hourly values") from error
        if (
            not all(math.isfinite(value) for value in (cloud_cover, radiation, temperature))
            or not 0 <= cloud_cover <= 100
            or radiation < 0
            or not -100 <= temperature <= 80
        ):
            raise WeatherUnavailable("Weather provider returned invalid hourly values")
        rows.append({"timestamp": str(values["time"]), "cloud_cover_pct": cloud_cover,
                     "shortwave_radiation_w_m2": radiation, "temperature_c": temperature})
    if len(rows) < 24:
        raise WeatherUnavailable("Weather provider returned fewer than 24 complete hourly points")
    return {
        "timezone": payload.get("timezone", "local time at requested coordinates"),
        "rows": rows[:24],
        "retrieved_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def recommend_dispatch(
    request: SolarGridRequest,
    forecast_items: list[dict],
    weather: dict,
    *,
    asset_name: str,
    provenance: dict,
    battery_discharge_limits_kw: list[float] | None = None,
) -> SolarGridRecommendation:
    """Apply solar-first dispatch and reserve/power-limited battery support."""
    if len(forecast_items) < 24 or len(weather.get("rows", [])) < 24:
        raise ValueError("24 demand-forecast and weather intervals are required")
    if battery_discharge_limits_kw is not None and (
        len(battery_discharge_limits_kw) != 24
        or any(not math.isfinite(value) or value < 0 or value > request.max_discharge_kw
               for value in battery_discharge_limits_kw)
    ):
        raise ValueError("24 finite battery discharge limits within the equipment rating are required")

    battery_soc = request.battery_capacity_kwh * request.battery_soc_pct / 100
    reserve_kwh = request.battery_capacity_kwh * request.battery_reserve_pct / 100
    rows: list[DispatchHour] = []
    totals = {"solar_to_load_kwh": 0.0, "solar_to_battery_kwh": 0.0,
              "battery_to_load_kwh": 0.0, "grid_to_load_kwh": 0.0,
              "unmet_demand_kwh": 0.0, "curtailed_solar_kwh": 0.0,
              "demand_forecast_kwh": 0.0, "solar_estimate_kwh": 0.0}

    for index, (demand, weather_row) in enumerate(zip(forecast_items[:24], weather["rows"][:24])):
        load = float(demand["forecast_kwh"])
        if not math.isfinite(load) or load < 0:
            raise ValueError("Demand forecast values must be finite and non-negative")
        irradiance = max(0.0, float(weather_row["shortwave_radiation_w_m2"]))
        temperature = float(weather_row["temperature_c"])
        # GHI is already weather-adjusted for cloud cover. Do not derate it a second time.
        temperature_factor = max(
            0.0,
            1.0 - request.temperature_coefficient_per_c * max(temperature - request.reference_temperature_c, 0.0),
        )
        solar = request.pv_capacity_kwp * irradiance / 1000 * request.pv_performance_ratio * temperature_factor
        solar_to_load = min(load, solar)
        residual = max(0.0, load - solar_to_load)
        solar_surplus = max(0.0, solar - solar_to_load)

        headroom_input = max(0.0, (request.battery_capacity_kwh - battery_soc) / request.charge_efficiency)
        solar_to_battery = min(solar_surplus, request.max_charge_kw, headroom_input)
        battery_soc = min(request.battery_capacity_kwh, battery_soc + solar_to_battery * request.charge_efficiency)
        curtailed = max(0.0, solar_surplus - solar_to_battery)

        available_output = max(0.0, (battery_soc - reserve_kwh) * request.discharge_efficiency)
        discharge_limit = (request.max_discharge_kw if battery_discharge_limits_kw is None
                           else battery_discharge_limits_kw[index])
        battery_to_load = min(residual, discharge_limit, available_output)
        battery_soc = max(reserve_kwh, battery_soc - battery_to_load / request.discharge_efficiency)
        residual -= battery_to_load

        grid_to_load = residual if request.grid_available else 0.0
        unmet = max(0.0, residual - grid_to_load)
        sources_used = sum(value > 1e-9 for value in (solar_to_load, battery_to_load, grid_to_load))
        if unmet > 1e-9 and sources_used == 0:
            source = "unserved"
        elif sources_used > 1:
            source = "mixed"
        elif solar_to_load > 1e-9:
            source = "solar"
        elif battery_to_load > 1e-9:
            source = "battery"
        else:
            source = "grid"

        reasons = []
        if solar_to_load > 0:
            reasons.append("Use weather-estimated solar for demand first.")
        if solar_to_battery > 0:
            reasons.append("Charge the scenario battery with solar surplus within its power and capacity limits.")
        if battery_to_load > 0:
            reasons.append("Use battery energy only above the configured reserve and within discharge limits.")
        if grid_to_load > 0:
            reasons.append("Use the grid for remaining demand because it is marked available.")
        if battery_discharge_limits_kw is not None and residual > 0 and discharge_limit < request.max_discharge_kw:
            reasons.append(f"The authored demonstration schedule limits battery delivery to {discharge_limit:.3f} kW in this hourly interval; stored energy is retained outside the support window.")
        if solar_to_load < load:
            reasons.append(f"Weather-estimated PV supplies {solar_to_load:.3f} kWh of {load:.3f} kWh demand at {irradiance:.1f} W/m² shortwave radiation.")
        if residual > 0 and battery_to_load == 0:
            if battery_soc <= reserve_kwh + 1e-9:
                reasons.append(f"Battery is at its {reserve_kwh:.3f} kWh reserve; no further discharge is allowed.")
            elif request.max_discharge_kw == 0:
                reasons.append("The configured battery discharge power limit is zero.")
        if unmet > 0:
            reasons.append("Grid is unavailable and solar/battery cannot cover demand; unmet demand is shown explicitly.")
        if not reasons:
            reasons.append("No demand or supply is scheduled for this interval.")

        row = DispatchHour(
            weather_timestamp=weather_row["timestamp"],
            demand_forecast_timestamp=demand["timestamp"],
            demand_forecast_kwh=round(load, 3), solar_estimate_kwh=round(solar, 3),
            solar_to_load_kwh=round(solar_to_load, 3), solar_to_battery_kwh=round(solar_to_battery, 3),
            battery_to_load_kwh=round(battery_to_load, 3), grid_to_load_kwh=round(grid_to_load, 3),
            unmet_demand_kwh=round(unmet, 3), curtailed_solar_kwh=round(curtailed, 3),
            battery_soc_kwh=round(battery_soc, 3), source=source, reasons=reasons,
            cloud_cover_pct=round(float(weather_row["cloud_cover_pct"]), 1),
            shortwave_radiation_w_m2=round(irradiance, 1), temperature_c=round(temperature, 1),
        )
        rows.append(row)
        raw_values = {"demand_forecast_kwh": load, "solar_estimate_kwh": solar,
                      "solar_to_load_kwh": solar_to_load, "solar_to_battery_kwh": solar_to_battery,
                      "battery_to_load_kwh": battery_to_load, "grid_to_load_kwh": grid_to_load,
                      "unmet_demand_kwh": unmet, "curtailed_solar_kwh": curtailed}
        for key in totals:
            totals[key] += raw_values[key]

    source_counts: dict[str, float] = {
        key: round(totals[key], 3)
        for key in ("solar_to_load_kwh", "solar_to_battery_kwh", "battery_to_load_kwh", "grid_to_load_kwh", "unmet_demand_kwh")
    }
    transitions = [
        {"at": rows[index].weather_timestamp, "from": rows[index - 1].source, "to": rows[index].source}
        for index in range(1, len(rows)) if rows[index].source != rows[index - 1].source
    ]
    calculated_transitions = []
    for index in range(1, len(rows)):
        before, after = rows[index - 1], rows[index]
        solar_starts = before.solar_to_load_kwh == 0 and after.solar_to_load_kwh > 0
        solar_ends = before.solar_to_load_kwh > 0 and after.solar_to_load_kwh == 0
        if before.source == after.source and not solar_starts and not solar_ends:
            continue
        direction = ("Grid → Solar" if solar_starts and before.grid_to_load_kwh > 0 else
                     "Solar → Grid" if solar_ends and after.grid_to_load_kwh > 0 else
                     f"{before.source.title()} → {after.source.title()}")
        assumption_id = hashlib.sha256(json.dumps(request.model_dump(), sort_keys=True).encode()).hexdigest()
        identity = f"{asset_name}|{after.weather_timestamp}|{direction}|{assumption_id}"
        calculated_transitions.append({
            "id": hashlib.sha256(identity.encode()).hexdigest()[:24],
            "at": after.weather_timestamp, "hour_index": index,
            "from": before.source, "to": after.source, "direction": direction,
            "reasons": list(after.reasons),
            "source_mix_kwh": {key: getattr(after, key) for key in
                               ("solar_to_load_kwh", "battery_to_load_kwh", "grid_to_load_kwh", "unmet_demand_kwh")},
            "note": "Direction describes solar contribution starting/stopping; mixed supply remains mixed when other sources are needed.",
        })
    identity_payload = {"inputs": request.model_dump(), "hours": [row.model_dump() for row in rows]}
    recommendation_id = hashlib.sha256(json.dumps(identity_payload, sort_keys=True).encode()).hexdigest()
    first = rows[0]
    estimated_cost = None
    if request.grid_price_per_kwh is not None:
        estimated_cost = {
            "value": round(totals["grid_to_load_kwh"] * request.grid_price_per_kwh, 2),
            "currency": request.grid_price_currency,
            "label": "Calculated from scenario grid import and user-entered price assumption",
            "price_per_kwh": request.grid_price_per_kwh,
        }

    demand_sum = round(totals["demand_forecast_kwh"], 3)
    supplied = round(totals["solar_to_load_kwh"] + totals["battery_to_load_kwh"] + totals["grid_to_load_kwh"], 3)
    solar_estimate = round(totals["solar_estimate_kwh"], 3)
    solar_allocated = round(
        totals["solar_to_load_kwh"] + totals["solar_to_battery_kwh"] + totals["curtailed_solar_kwh"],
        3,
    )
    first_reasons = list(first.reasons)
    if transitions:
        next_transition = transitions[0]
    else:
        next_transition = None

    return SolarGridRecommendation(
        recommendation_id=recommendation_id,
        transitions=calculated_transitions,
        asset_id=request.asset_id,
        asset_name=asset_name,
        demand_provenance=provenance,
        demand_basis="BDG2-derived 24-hour forecast; its historical forecast timestamps are shown separately from current demo-location weather timestamps. Pairing is a scenario illustration, not a time-aligned operational forecast.",
        location={"name": request.location_name, "latitude": request.latitude, "longitude": request.longitude,
                  "label": "Demonstration scenario assumption; not asserted to be the BDG2 asset location"},
        weather={"source": "Open-Meteo Forecast API", "url": OPEN_METEO_URL,
                 "timezone": weather.get("timezone"), "retrieved_at_utc": weather.get("retrieved_at_utc"),
                 "uncertainty": "Provider forecast uncertainty is not quantified here; irradiance and PV estimates are indicative.",
                 "citation": "Open-Meteo, Weather Forecast API",
                 "citation_url": "https://open-meteo.com/en/docs"},
        assumptions={
            "label": "Demonstration scenario assumptions",
            "pv_capacity_kwp": request.pv_capacity_kwp,
            "pv_formula": "PV kWh per hourly interval = capacity kWp × shortwave radiation W/m² ÷ 1000 × performance ratio × temperature factor",
            "pv_performance_ratio": request.pv_performance_ratio,
            "temperature_coefficient_per_c": request.temperature_coefficient_per_c,
            "reference_temperature_c": request.reference_temperature_c,
            "shortwave_radiation_note": "Shortwave radiation already reflects weather/cloud conditions; cloud cover is shown as context and is not applied as a second derate.",
            "battery_capacity_kwh": request.battery_capacity_kwh,
            "battery_initial_soc_pct": request.battery_soc_pct,
            "battery_reserve_pct": request.battery_reserve_pct,
            "max_charge_kw": request.max_charge_kw,
            "max_discharge_kw": request.max_discharge_kw,
            "charge_efficiency": request.charge_efficiency,
            "discharge_efficiency": request.discharge_efficiency,
            "grid_available": request.grid_available,
            "grid_price_per_kwh": request.grid_price_per_kwh,
            "tariff_use": "Optional user-entered price estimates grid-import cost only; it does not change the dispatch source policy.",
            "dispatch_policy": "Solar serves load first, surplus charges battery, battery discharges only above reserve and within power limits, then available grid supplies the remainder.",
            "interval_hours": 1,
        },
        recommended_source=first.source,
        reasons=first_reasons,
        source_mix_kwh=source_counts,
        estimated_grid_cost=estimated_cost,
        next_transition=next_transition,
        energy_balance={"demand_kwh": demand_sum, "served_kwh": supplied,
                        "unmet_demand_kwh": round(totals["unmet_demand_kwh"], 3),
                        "difference_kwh": round(totals["demand_forecast_kwh"] - totals["solar_to_load_kwh"]
                                                - totals["battery_to_load_kwh"] - totals["grid_to_load_kwh"]
                                                - totals["unmet_demand_kwh"], 6),
                        "solar_estimate_kwh": solar_estimate,
                        "solar_allocated_kwh": solar_allocated,
                        "solar_difference_kwh": round(totals["solar_estimate_kwh"] - totals["solar_to_load_kwh"]
                                                      - totals["solar_to_battery_kwh"]
                                                      - totals["curtailed_solar_kwh"], 6)},
        hours=rows,
    )
