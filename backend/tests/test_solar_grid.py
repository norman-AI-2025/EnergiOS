"""Focused tests for deterministic, reserve-aware solar/grid dispatch scenarios."""

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import app
from src.solar_grid import SolarGridRequest, WeatherUnavailable, fetch_open_meteo, recommend_dispatch


def _inputs(**overrides):
    values = {
        "asset_id": "bdg2-demo-asset",
        "location_name": "User demo location",
        "latitude": 3.139,
        "longitude": 101.6869,
        "pv_capacity_kwp": 20,
        "pv_performance_ratio": 0.8,
        "battery_capacity_kwh": 40,
        "battery_soc_pct": 50,
        "battery_reserve_pct": 25,
        "max_charge_kw": 8,
        "max_discharge_kw": 10,
        "charge_efficiency": 0.9,
        "discharge_efficiency": 0.9,
    }
    values.update(overrides)
    return SolarGridRequest(**values)


def _hourly(demand=10, irradiance=0):
    forecast = [
        {"timestamp": f"2018-01-01T{hour:02d}:00:00Z", "forecast_kwh": demand}
        for hour in range(24)
    ]
    weather = {
        "timezone": "Asia/Kuala_Lumpur",
        "retrieved_at_utc": "2026-10-19T00:00:00Z",
        "rows": [
            {
                "timestamp": f"2026-10-19T{hour:02d}:00",
                "cloud_cover_pct": 40,
                "shortwave_radiation_w_m2": irradiance,
                "temperature_c": 25,
            }
            for hour in range(24)
        ],
    }
    return forecast, weather


def _run(request, demand=10, irradiance=0):
    forecast, weather = _hourly(demand, irradiance)
    return recommend_dispatch(
        request,
        forecast,
        weather,
        asset_name="Hog_office_Bill",
        provenance={"source_title": "Building Data Genome Project 2"},
    )


def test_solar_first_and_deterministic_output():
    result = _run(_inputs(pv_capacity_kwp=20), demand=5, irradiance=500)
    again = _run(_inputs(pv_capacity_kwp=20), demand=5, irradiance=500)

    assert result.model_dump() == again.model_dump()
    assert result.hours[0].solar_to_load_kwh == 5
    assert result.hours[0].battery_to_load_kwh == 0
    assert result.hours[0].source == "solar"
    assert result.label == "Scenario estimate — no live equipment control"
    assert result.energy_balance["difference_kwh"] == 0


def test_battery_never_crosses_configured_reserve():
    result = _run(_inputs(battery_soc_pct=30, battery_reserve_pct=25), demand=20)
    assert result.hours[0].battery_to_load_kwh == pytest.approx(1.8)
    assert result.hours[0].battery_soc_kwh == pytest.approx(10.0)
    assert all(hour.battery_soc_kwh >= 10.0 for hour in result.hours)
    assert all(hour.grid_to_load_kwh > 0 for hour in result.hours)


def test_demo_schedule_retains_battery_until_support_window_without_changing_default_policy():
    forecast, weather = _hourly(demand=5)
    request = _inputs()
    limits = [0]*17 + [2]*5 + [0]*2
    result = recommend_dispatch(request, forecast, weather, asset_name='demo', provenance={},
                                battery_discharge_limits_kw=limits)
    assert all(h.battery_to_load_kwh == 0 for h in result.hours[:17])
    assert result.hours[16].battery_soc_kwh == 20
    assert result.hours[17].battery_to_load_kwh == 2
    assert any('schedule limits' in reason for reason in result.hours[0].reasons)
    assert result.energy_balance['difference_kwh'] == 0
    assert _run(request, demand=5).hours[0].battery_to_load_kwh == 5


@pytest.mark.parametrize('limits', [[0]*23, [-1]*24, [11]*24, [float('nan')]*24, [float('inf')]*24])
def test_demo_schedule_rejects_invalid_limits(limits):
    forecast, weather = _hourly()
    with pytest.raises(ValueError, match='24 finite battery discharge limits'):
        recommend_dispatch(_inputs(), forecast, weather, asset_name='demo', provenance={},
                           battery_discharge_limits_kw=limits)


def test_grid_outage_reports_unmet_demand_and_balances_energy():
    result = _run(
        _inputs(battery_soc_pct=25, battery_reserve_pct=25, grid_available=False),
        demand=10,
    )
    assert result.hours[0].source == "unserved"
    assert result.hours[0].grid_to_load_kwh == 0
    assert result.hours[0].unmet_demand_kwh == 10
    assert result.energy_balance["difference_kwh"] == 0
    assert result.energy_balance["solar_difference_kwh"] == 0


def test_surplus_charge_respects_power_capacity_and_precise_energy_balance():
    result = _run(_inputs(), demand=5.123456, irradiance=987.654321)
    assert all(hour.solar_to_battery_kwh <= 8 for hour in result.hours)
    assert all(hour.battery_soc_kwh <= 40 for hour in result.hours)
    assert result.hours[-1].battery_soc_kwh == 40
    assert result.hours[-1].curtailed_solar_kwh > 0
    assert result.energy_balance['difference_kwh'] == 0
    assert result.energy_balance['solar_difference_kwh'] == 0


def test_invalid_reserve_above_soc_is_rejected():
    with pytest.raises(ValueError, match="reserve_pct cannot exceed"):
        _inputs(battery_soc_pct=20, battery_reserve_pct=30)


def test_optional_tariff_cost_is_only_calculated_from_user_input():
    request = _inputs(
        pv_capacity_kwp=0,
        battery_capacity_kwh=0,
        battery_soc_pct=0,
        battery_reserve_pct=0,
        max_charge_kw=0,
        max_discharge_kw=0,
        grid_price_per_kwh=0.5,
        grid_price_currency="MYR",
    )
    result = _run(request, demand=10)
    assert result.estimated_grid_cost["value"] == 120
    assert result.estimated_grid_cost["currency"] == "MYR"


def test_open_meteo_adapter_parses_24_hour_response(monkeypatch):
    times = [f"2026-10-19T{hour:02d}:00" for hour in range(24)]
    payload = {"timezone": "Asia/Kuala_Lumpur", "hourly": {
        "time": times,
        "cloud_cover": [40] * 24,
        "shortwave_radiation": [500] * 24,
        "temperature_2m": [30] * 24,
    }}

    def handler(request):
        assert request.url.host == "api.open-meteo.com"
        assert request.url.params["hourly"] == "cloud_cover,shortwave_radiation,temperature_2m"
        return httpx.Response(200, json=payload, request=request)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        "src.solar_grid.httpx.AsyncClient",
        lambda *, timeout: real_client(transport=httpx.MockTransport(handler), timeout=timeout),
    )
    weather = asyncio.run(fetch_open_meteo(3.139, 101.6869))
    assert len(weather["rows"]) == 24
    assert weather["timezone"] == "Asia/Kuala_Lumpur"
    assert weather["rows"][0]["shortwave_radiation_w_m2"] == 500
    assert weather["rows"][0]["cloud_cover_pct"] == 40


def test_open_meteo_adapter_rejects_incomplete_response(monkeypatch):
    real_client = httpx.AsyncClient

    def handler(request):
        return httpx.Response(200, json={"hourly": {"time": [], "cloud_cover": [],
            "shortwave_radiation": [], "temperature_2m": []}}, request=request)

    monkeypatch.setattr(
        "src.solar_grid.httpx.AsyncClient",
        lambda *, timeout: real_client(transport=httpx.MockTransport(handler), timeout=timeout),
    )
    with pytest.raises(WeatherUnavailable, match="fewer than 24"):
        asyncio.run(fetch_open_meteo(3.139, 101.6869))


def test_endpoint_uses_bdg2_forecast_and_weather_without_control(monkeypatch):
    async def fake_weather(latitude, longitude):
        assert (latitude, longitude) == (3.139, 101.6869)
        return _hourly(demand=0)[1]

    monkeypatch.setattr(app_module, "fetch_open_meteo", fake_weather)
    payload = _inputs().model_dump()
    # Use an actual cohort ID so demand comes from the existing forecast service.
    payload["asset_id"] = "fa2b11d5-f608-515e-97ab-6445ef048bff"
    with TestClient(app) as client:
        response = client.post("/demo/solar-grid/recommendation", json=payload)

    assert response.status_code == 200
    result = response.json()
    assert result["asset_name"] == "Hog_office_Bill"
    assert result["demand_provenance"]["source_code"] == "bdg2_v1"
    assert result["weather"]["source"] == "Open-Meteo Forecast API"
    assert result["label"] == "Scenario estimate — no live equipment control"
    assert len(result["hours"]) == 24
    assert result["energy_balance"]["difference_kwh"] == 0
    assert "not a time-aligned operational forecast" in result["demand_basis"]


def test_endpoint_rejects_unsafe_request_before_weather_call(monkeypatch):
    async def unexpected_weather(*_):
        raise AssertionError("invalid input must be rejected before requesting weather")

    monkeypatch.setattr(app_module, "fetch_open_meteo", unexpected_weather)
    payload = _inputs().model_dump()
    payload.update({"latitude": 100, "asset_id": "fa2b11d5-f608-515e-97ab-6445ef048bff"})
    with TestClient(app) as client:
        response = client.post("/demo/solar-grid/recommendation", json=payload)
    assert response.status_code == 422


def test_weather_failure_is_a_sanitized_retryable_response(monkeypatch):
    async def unavailable_weather(*_):
        raise WeatherUnavailable('Weather forecast is temporarily unavailable')

    monkeypatch.setattr(app_module, 'fetch_open_meteo', unavailable_weather)
    payload = _inputs(asset_id='fa2b11d5-f608-515e-97ab-6445ef048bff').model_dump()
    with TestClient(app) as client:
        response = client.post('/demo/solar-grid/recommendation', json=payload)
    assert response.status_code == 503
    assert response.json() == {'detail': 'Weather forecast is temporarily unavailable'}


def test_transition_cards_detect_solar_changes_even_when_source_stays_mixed():
    demand, weather = _hourly(demand=100)
    weather['rows'][5]['shortwave_radiation_w_m2'] = 500
    request = _inputs(battery_capacity_kwh=10000, battery_soc_pct=60)
    result = recommend_dispatch(request, demand, weather, asset_name='BDG2 building', provenance={})
    transition = next(t for t in result.transitions if t['hour_index'] == 5)
    assert transition['direction'] == 'Grid → Solar'
    assert transition['from'] == transition['to'] == 'mixed'
    assert transition['to'] == 'mixed'  # partial solar is never represented as full solar
    assert transition['reasons'] == result.hours[5].reasons
    assert transition['source_mix_kwh']['grid_to_load_kwh'] == result.hours[5].grid_to_load_kwh
    assert next(t for t in result.transitions if t['hour_index'] == 6)['direction'] == 'Solar → Grid'
    weather['retrieved_at_utc'] = 'a later retrieval of identical inputs'
    again = recommend_dispatch(request, demand, weather, asset_name='BDG2 building', provenance={})
    assert again.recommendation_id == result.recommendation_id
    assert again.transitions == result.transitions
    updated_request = request.model_copy(update={'pv_capacity_kwp': 30})
    changed = recommend_dispatch(updated_request, demand, weather, asset_name='BDG2 building', provenance={})
    assert changed.transitions[0]['id'] != result.transitions[0]['id']


def test_gemini_timeout_is_sanitized_and_does_not_change_dispatch(monkeypatch):
    import src.dispatch_explanation as module
    result = _run(_inputs(), demand=20)
    module.remember_dispatch(result)
    module._calls.clear()
    monkeypatch.setattr(module, 'get_gemini_api_key', lambda: 'test-placeholder')
    original = httpx.AsyncClient
    def handler(request):
        raise httpx.ReadTimeout('provider internal details', request=request)
    monkeypatch.setattr(module.httpx, 'AsyncClient', lambda *, timeout:
        original(transport=httpx.MockTransport(handler), timeout=timeout))
    payload = module.DispatchExplanationRequest(recommendation_id=result.recommendation_id, transition_id=result.transitions[0]['id'])
    before = result.model_dump()
    with pytest.raises(module.ExplanationUnavailable, match='timed out'):
        asyncio.run(module.explain_dispatch(payload))
    assert result.model_dump() == before


def test_explanation_rejects_unknown_server_result():
    with TestClient(app) as client:
        response = client.post('/demo/solar-grid/explanation', json={
            'recommendation_id': '0' * 64, 'transition_id': '0' * 24})
    assert response.status_code == 404


def test_gemini_explains_only_server_calculated_reasons(monkeypatch):
    import src.dispatch_explanation as module
    request = _inputs()
    result = _run(request, demand=20)
    assert result.transitions
    module.remember_dispatch(result)
    transition = result.transitions[0]
    reason = transition['reasons'][0]
    module._calls.clear()
    monkeypatch.setattr(module, 'get_gemini_api_key', lambda: 'test-only-placeholder')
    original = httpx.AsyncClient
    invented = False

    def handler(req):
        import json
        payload = json.loads(req.content)
        assert 'tools' not in payload
        assert result.asset_name in payload['contents'][0]['parts'][0]['text']
        text = 'Invented switch action and HVAC cause' if invented else reason
        return httpx.Response(200, json={'candidates': [{'content': {'parts': [
            {'text': json.dumps({'sentences': [text]})}]}}]}, request=req)

    monkeypatch.setattr(module.httpx, 'AsyncClient', lambda *, timeout:
        original(transport=httpx.MockTransport(handler), timeout=timeout))
    payload = module.DispatchExplanationRequest(recommendation_id=result.recommendation_id, transition_id=transition['id'])
    explained = asyncio.run(module.explain_dispatch(payload))
    assert explained['explanation'] == reason
    assert explained['transition_id'] == transition['id']
    invented = True
    with pytest.raises(module.ExplanationUnavailable, match='unavailable'):
        asyncio.run(module.explain_dispatch(payload))


def test_missing_gemini_key_has_honest_unavailable_state(monkeypatch):
    import src.dispatch_explanation as module
    result = _run(_inputs(), demand=20)
    module.remember_dispatch(result)
    monkeypatch.setattr(module, 'get_gemini_api_key', lambda: '')
    with TestClient(app) as client:
        response = client.post('/demo/solar-grid/explanation', json={
            'recommendation_id': result.recommendation_id, 'transition_id': result.transitions[0]['id']})
    assert response.status_code == 503
    assert 'not configured' in response.json()['detail']
