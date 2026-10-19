import pytest
from fastapi.testclient import TestClient

from app import app
import src.video_dispatch as video

ASSET = "689abc84-be69-53b1-826e-4085b66c331c"


def build(after_hour=0):
    return video.build_video_dispatch(video.VideoRequest(asset_id=ASSET, after_hour=after_hour))


def review_request(result, **overrides):
    demo, t = result.video_demo, result.transitions[0]
    values = dict(review_id=demo["review_id"], recommendation_id=result.recommendation_id,
                  transition_id=t["id"], current_source=demo["current_source"],
                  current_hour=demo["after_hour"], battery_soc_kwh=result.hours[demo["after_hour"]].battery_soc_kwh)
    return video.VideoReviewRequest(**(values | overrides))


def test_replay_runs_existing_forecast_with_pinned_history(monkeypatch):
    calls = []
    fit, forecast = video.fit_profile, video.forecast_24
    def checked_fit(points, boundary):
        calls.append((len(points), boundary)); return fit(points, boundary)
    def checked_forecast(profile, history, origin):
        calls.append((len(history), origin)); return forecast(profile, history, origin)
    monkeypatch.setattr(video, "fit_profile", checked_fit)
    monkeypatch.setattr(video, "forecast_24", checked_forecast)
    first, second = build(), build()
    assert calls[0][0] == calls[1][0] == 168
    assert first.recommendation_id == second.recommendation_id
    assert first.hours == second.hours
    assert first.video_demo["review_id"] != second.video_demo["review_id"]
    assert len(first.hours) == 24
    assert first.weather["retrieved_at_utc"] is None
    assert "Authored fixed demo" in first.weather["source"]
    assert "overall mean" in first.demand_basis
    assert first.demand_provenance["source_code"] == "bdg2_v1"


def test_two_calculated_changes_and_reasons_follow_input_math():
    first = build(); t = first.transitions[0]; h = first.hours[t["hour_index"]]
    assert t["from"] == "grid" and t["to"] == "solar"
    expected_pv = 1200 * h.shortwave_radiation_w_m2 / 1000 * .8 * (1 - .004 * max(h.temperature_c - 25, 0))
    assert h.solar_estimate_kwh == pytest.approx(expected_pv, abs=.001)
    assert f"{h.demand_forecast_kwh:.1f} kWh" in t["reasons"][0]
    assert f"{h.shortwave_radiation_w_m2:.0f} W/m²" in t["reasons"][1]
    assert t["at"] == h.weather_timestamp
    second = build(t["hour_index"])
    assert second.transitions[0]["from"] == "solar" and second.transitions[0]["to"] == "grid"
    assert second.transitions[0]["hour_index"] - t["hour_index"] >= 2
    assert build(second.transitions[0]["hour_index"]).transitions == []
    assert all(h.battery_soc_kwh == 50 and h.battery_to_load_kwh == 0 for h in first.hours)


def test_dark_profile_has_no_hardcoded_solar_alert(monkeypatch):
    profile, snapshot, digest = video.read_profile()
    profile["weather"]["radiation_w_m2"] = [0] * 24
    monkeypatch.setattr(video, "read_profile", lambda: (profile, snapshot, digest))
    result = build()
    assert result.transitions == []
    assert all(h.grid_to_load_kwh == h.demand_forecast_kwh for h in result.hours)


def test_single_hour_solar_spike_does_not_switch(monkeypatch):
    profile, snapshot, digest = video.read_profile()
    profile["weather"]["radiation_w_m2"] = [0] * 24
    profile["weather"]["radiation_w_m2"][12] = 1000
    monkeypatch.setattr(video, "read_profile", lambda: (profile, snapshot, digest))
    assert build().transitions == []


def test_changed_forecast_changes_decision_and_zero_load_never_generates_switches(monkeypatch):
    monkeypatch.setattr(video, "forecast_24", lambda *_: [10000] * 24)
    assert build().transitions == []
    monkeypatch.setattr(video, "forecast_24", lambda *_: [0] * 24)
    assert build().transitions == []


def test_all_four_buildings_have_own_fitted_demand_and_balanced_results():
    _, snapshot, _ = video.read_profile()
    demands = []
    for asset in snapshot["assets"]["items"]:
        result = video.build_video_dispatch(video.VideoRequest(asset_id=asset["id"]))
        video.assert_feasible(result)
        demands.append(result.hours[0].demand_forecast_kwh)
        assert result.energy_balance["difference_kwh"] == 0
    assert len(set(demands)) == 4


def test_review_recomputes_and_rejects_changed_state_or_profile(monkeypatch):
    result = build()
    assert video.review_video_dispatch(review_request(result))["valid"] is True
    for overrides in [dict(current_source="solar"), dict(current_hour=1), dict(battery_soc_kwh=60),
                      dict(recommendation_id="0" * 64), dict(transition_id="0" * 24)]:
        with pytest.raises(ValueError): video.review_video_dispatch(review_request(result, **overrides))
    profile, snapshot, _ = video.read_profile()
    monkeypatch.setattr(video, "read_profile", lambda: (profile, snapshot, "changed-profile-hash"))
    with pytest.raises(ValueError, match="inputs changed"):
        video.review_video_dispatch(review_request(result))


def test_expired_reviews_require_fresh_calculation(monkeypatch):
    result = build()
    original = video.monotonic
    monkeypatch.setattr(video, "monotonic", lambda: original() + 601)
    with pytest.raises(LookupError, match="expired"):
        video.review_video_dispatch(review_request(result))


def test_feasibility_rejects_unserved_nan_reserve_and_balance_errors():
    for field, value in [("battery_soc_kwh", 0), ("grid_to_load_kwh", float('nan')),
                         ("unmet_demand_kwh", 1), ("solar_estimate_kwh", 100000)]:
        result = build(); setattr(result.hours[0], field, value)
        with pytest.raises(ValueError): video.assert_feasible(result)


def test_unknown_building_and_bounds_rejected_by_api():
    with TestClient(app) as client:
        assert client.post('/demo/solar-grid/video/recommendation', json={"asset_id": "unknown"}).status_code == 404
        assert client.post('/demo/solar-grid/video/recommendation', json={"asset_id": ASSET, "after_hour": 24}).status_code == 422


def test_video_endpoint_full_offline_review_contract(monkeypatch):
    async def forbidden(*_, **__): raise AssertionError("Fixed demo must not call weather or database")
    monkeypatch.setattr('app.fetch_open_meteo', forbidden)
    with TestClient(app) as client:
        raw = client.post('/demo/solar-grid/video/recommendation', json={"asset_id": ASSET})
        assert raw.status_code == 200
        result = video.VideoRecommendation(**raw.json())
        valid = client.post('/demo/solar-grid/video/revalidate', json=review_request(result).model_dump())
        assert valid.status_code == 200 and valid.json()["valid"] is True
        stale = client.post('/demo/solar-grid/video/revalidate', json=review_request(result, battery_soc_kwh=60).model_dump())
        assert stale.status_code == 409
        assert result.transitions[0]["reasons"]
