"""Reproducible video replay: existing demand model -> PV calculation -> dispatch -> review.

No provider, database write, equipment command or new switching classifier is used.
"""
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import monotonic
import hashlib
import json
import math
import secrets

from pydantic import BaseModel, Field

from src.bdg2_analytics import MODEL_VERSION, Point, fit_profile, forecast_24, parse_utc, utc_text
from src.solar_grid import SolarGridRecommendation, SolarGridRequest, recommend_dispatch

DATA = Path(__file__).parent / "data"
PROFILE = DATA / "video_solar_grid_v1.json"
SNAPSHOT = DATA / "bdg2_live_snapshot.json"
_reviews = OrderedDict()
REVIEW_TTL_SECONDS = 600


class VideoRequest(BaseModel):
    asset_id: str = Field(min_length=1, max_length=100)
    after_hour: int = Field(default=0, ge=0, le=23)


class VideoReviewRequest(BaseModel):
    review_id: str = Field(min_length=16, max_length=100)
    recommendation_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    transition_id: str = Field(pattern=r"^[a-f0-9]{24}$")
    current_source: str = Field(pattern=r"^(solar|grid)$")
    current_hour: int = Field(ge=0, le=23)
    battery_soc_kwh: float = Field(ge=0, allow_inf_nan=False)


class VideoRecommendation(SolarGridRecommendation):
    video_demo: dict


def read_profile():
    profile_bytes = PROFILE.read_bytes()
    profile = json.loads(profile_bytes)
    snapshot_bytes = SNAPSHOT.read_bytes()
    if hashlib.sha256(snapshot_bytes).hexdigest() != profile["demand"]["snapshot_sha256"]:
        raise ValueError("Pinned demo demand history has changed; review the profile before running it.")
    return profile, json.loads(snapshot_bytes), hashlib.sha256(profile_bytes).hexdigest()


def build_video_dispatch(request: VideoRequest, *, issue_review=True):
    profile, snapshot, profile_hash = read_profile()
    assets = snapshot["assets"]["items"]
    asset = next((a for a in assets if request.asset_id in (a["id"], a["name"])), None)
    if asset is None:
        raise LookupError("Building is not in the pinned four-building BDG2 cohort.")
    readings = snapshot["buildings"][asset["name"]]["readings"]["items"]
    points = [Point(parse_utc(r["timestamp"]), float(r["consumption_kwh"])) for r in readings
              if r.get("label") == "observed" and r.get("quality_status") == "observed"
              and r.get("interval_minutes") == 60 and math.isfinite(float(r["consumption_kwh"]))
              and float(r["consumption_kwh"]) >= 0]
    points.sort(key=lambda point: point.timestamp)
    if len(points) != 168 or any((b.timestamp - a.timestamp).total_seconds() != 3600
                                  for a, b in zip(points, points[1:])):
        raise ValueError("Demo requires the pinned complete 168-hour observed demand window; no gap filling.")
    origin = points[-1].timestamp + timedelta(hours=1)
    fitted = fit_profile(points, origin)
    values = forecast_24(fitted, {p.timestamp: p.value for p in points}, origin)
    forecasts = [{"timestamp": utc_text(origin + timedelta(hours=i)), "forecast_kwh": value}
                 for i, value in enumerate(values)]
    w = profile["weather"]
    weather = {"timezone": w["timezone"], "retrieved_at_utc": None, "rows": [
        {"timestamp": f'{w["scenario_date"]}T{i:02d}:00',
         "shortwave_radiation_w_m2": w["radiation_w_m2"][i],
         "cloud_cover_pct": w["cloud_cover_pct"][i], "temperature_c": w["temperature_c"][i]}
        for i in range(24)]}
    inputs = SolarGridRequest(asset_id=asset["id"], **profile["inputs"])
    base = recommend_dispatch(inputs, forecasts, weather, asset_name=asset["name"], provenance=asset["provenance"])
    policy = profile["switch_policy"]
    source, streak, last_change = "grid", 0, -policy["minimum_dwell_hours"]
    primary = []
    transitions = []
    for i, hour in enumerate(base.hours):
        ratio = hour.solar_estimate_kwh / max(hour.demand_forecast_kwh, 1e-9)
        target = "solar" if source == "grid" and ratio >= policy["solar_enter_ratio"] else (
            "grid" if source == "solar" and ratio < policy["solar_exit_ratio"] else source)
        if hour.demand_forecast_kwh <= .001:
            target = source
        streak = streak + 1 if target != source else 0
        if target != source and streak >= policy["confirmation_hours"] and i - last_change >= policy["minimum_dwell_hours"]:
            before, source = source, target
            identity = f'{profile_hash}|{asset["id"]}|{i}|{before}|{source}'
            mix = {key: getattr(hour, key) for key in
                   ("solar_to_load_kwh", "battery_to_load_kwh", "grid_to_load_kwh", "unmet_demand_kwh")}
            threshold = policy["solar_enter_ratio"] if source == "solar" else policy["solar_exit_ratio"]
            reasons = [
                f"Demand model forecasts {hour.demand_forecast_kwh:.1f} kWh for this hourly interval from {len(points)} pinned BDG2 observations.",
                f"Demo radiation {hour.shortwave_radiation_w_m2:.0f} W/m² and temperature {hour.temperature_c:.1f} °C produce {hour.solar_estimate_kwh:.1f} kWh estimated PV with {inputs.pv_capacity_kwp:.0f} kWp and performance ratio {inputs.pv_performance_ratio:.2f}.",
                f"PV/demand is {ratio:.2f}; the {source.title()} condition ({'at least' if source == 'solar' else 'below'} {threshold:.2f}) held for {streak} consecutive hourly intervals.",
                f"Supply allocation: solar {hour.solar_to_load_kwh:.1f}, battery {hour.battery_to_load_kwh:.1f}, grid {hour.grid_to_load_kwh:.1f} kWh; unmet demand {hour.unmet_demand_kwh:.1f} kWh.",
                f"Battery is {hour.battery_soc_kwh:.1f} kWh; reserve is {inputs.battery_capacity_kwh * inputs.battery_reserve_pct / 100:.1f} kWh. Charging is disabled in this fixed walkthrough.",
                f"At the demo tariff {inputs.grid_price_currency} {inputs.grid_price_per_kwh:.2f}/kWh, this interval's grid purchase costs {inputs.grid_price_currency} {hour.grid_to_load_kwh * inputs.grid_price_per_kwh:.2f}. Tariff values the plan; it does not train or change the solar-first policy.",
            ]
            transitions.append({"id": hashlib.sha256(identity.encode()).hexdigest()[:24],
                "at": hour.weather_timestamp, "hour_index": i, "from": before, "to": source,
                "direction": f"{before.title()} → {source.title()}", "reasons": reasons,
                "source_mix_kwh": mix,
                "note": "Primary source preference in a fixed demo. Actual allocation may remain mixed; all values are scenario calculations, with no live equipment control."})
            last_change, streak = i, 0
        primary.append(source)
    upcoming = [t for t in transitions if t["hour_index"] > request.after_hour]
    base.transitions = upcoming[:1]
    base.next_transition = upcoming[0] if upcoming else None
    base.recommendation_id = hashlib.sha256(json.dumps({"profile": profile_hash, "asset": asset["id"],
        "cursor": request.after_hour, "hours": [h.model_dump() for h in base.hours]}, sort_keys=True).encode()).hexdigest()
    base.weather = {"source": w["source"], "timezone": w["timezone"], "retrieved_at_utc": None,
                    "uncertainty": "Authored demo values; no operational forecast accuracy is claimed.",
                    "citation": "EnergiOS fixed demonstration profile", "profile_version": profile["version"]}
    base.location["label"] = "Fictional demonstration coordinates; unrelated to the BDG2 building location"
    base.demand_basis = "Existing seasonal demand model fitted to a pinned 168-hour BDG2 benchmark window. With one observation per weekly slot, the existing model falls back to its fitted overall mean. Historical demand timestamps and fixed demo weather dates are independent. This is a reproducible walkthrough, not operational prediction or measured savings."
    base.assumptions.update({"profile_version": profile["version"], "source_notes": profile["assumptions"],
                             "switch_policy": policy})
    demo = {"version": profile["version"], "profile_hash": profile_hash,
            "label": profile["label"], "after_hour": request.after_hour,
            "current_source": primary[request.after_hour], "primary_source_by_hour": primary,
            "demand_model": {"version": MODEL_VERSION, "fit_functions": ["fit_profile", "forecast_24"],
                             "observations": len(points), "source_sha256": profile["demand"]["snapshot_sha256"]},
            "inputs": inputs.model_dump(), "training": "No switching classifier is trained in this walkthrough.",
            "review_id": None, "expires_at_utc": None}
    result = VideoRecommendation(**base.model_dump(), video_demo=demo)
    assert_feasible(result)
    if issue_review:
        review_id = secrets.token_hex(16)
        result.video_demo.update({"review_id": review_id,
            "expires_at_utc": utc_text(datetime.now(timezone.utc) + timedelta(seconds=REVIEW_TTL_SECONDS))})
        _reviews[review_id] = (monotonic(), request, result)
        while len(_reviews) > 128:
            _reviews.popitem(last=False)
    return result


def assert_feasible(result):
    inputs = result.video_demo["inputs"]
    reserve = inputs["battery_capacity_kwh"] * inputs["battery_reserve_pct"] / 100
    if len(result.hours) != 24:
        raise ValueError("A complete 24-hour scenario is required.")
    for h in result.hours:
        quantities = [h.demand_forecast_kwh, h.solar_estimate_kwh, h.solar_to_load_kwh,
                      h.solar_to_battery_kwh, h.battery_to_load_kwh, h.grid_to_load_kwh,
                      h.battery_soc_kwh, h.unmet_demand_kwh, h.curtailed_solar_kwh]
        if any(not math.isfinite(v) or v < 0 for v in quantities):
            raise ValueError("Scenario has invalid energy values.")
        supply = h.solar_to_load_kwh + h.battery_to_load_kwh + h.grid_to_load_kwh
        if abs(h.demand_forecast_kwh - supply) > .01 or h.unmet_demand_kwh > 0:
            raise ValueError("Scenario cannot meet demand safely.")
        if not reserve - .01 <= h.battery_soc_kwh <= inputs["battery_capacity_kwh"] + .01:
            raise ValueError("Battery reserve or capacity violated.")
        if h.battery_to_load_kwh > inputs["max_discharge_kw"] + .01 or h.solar_to_battery_kwh > inputs["max_charge_kw"] + .01:
            raise ValueError("Battery power limit violated.")
        if abs(h.solar_estimate_kwh - h.solar_to_load_kwh - h.solar_to_battery_kwh - h.curtailed_solar_kwh) > .01:
            raise ValueError("Solar energy balance violated.")


def review_video_dispatch(request: VideoReviewRequest):
    cached = _reviews.get(request.review_id)
    if not cached or monotonic() - cached[0] > REVIEW_TTL_SECONDS:
        raise LookupError("Demo review expired. Run the fixed demo again before approval.")
    old_request, old = cached[1:]
    if request.recommendation_id != old.recommendation_id:
        raise ValueError("Recommendation does not match its server review.")
    fresh = build_video_dispatch(old_request, issue_review=False)
    if fresh.recommendation_id != old.recommendation_id:
        raise ValueError("Demo inputs changed. Review a fresh recommendation before approval.")
    transition = next((t for t in fresh.transitions if t["id"] == request.transition_id), None)
    if transition is None:
        raise ValueError("Source transition is not in the reviewed plan.")
    if request.current_hour != old.video_demo["after_hour"] or request.current_source != transition["from"]:
        raise ValueError("Demo source or timeline changed. Run the next demo step to refresh the alert.")
    expected_soc = fresh.hours[request.current_hour].battery_soc_kwh
    if abs(request.battery_soc_kwh - expected_soc) > .01:
        raise ValueError("Battery state changed. Review fresh demo inputs before approval.")
    assert_feasible(fresh)
    return {"valid": True, "recommendation_id": old.recommendation_id,
            "transition_id": transition["id"], "review_id": request.review_id,
            "validated_at_utc": utc_text(datetime.now(timezone.utc)),
            "expires_at_utc": old.video_demo["expires_at_utc"], "profile_hash": fresh.video_demo["profile_hash"]}
