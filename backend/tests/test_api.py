"""Contract and endpoint test suite for EnergiOS backend."""

import pytest
from fastapi.testclient import TestClient
from app import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload == {"status": "ok", "version": "1"}


def test_assets_endpoint_returns_four_bdg2_buildings(client: TestClient):
    response = client.get("/assets")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 4
    assert len(payload["items"]) == 4

    names = {item["name"] for item in payload["items"]}
    expected_names = {
        "Hog_office_Bill",
        "Hog_education_Donnie",
        "Hog_assembly_Dona",
        "Hog_lodging_Francisco",
    }
    assert names == expected_names

    for item in payload["items"]:
        assert item["scope"] == "whole_building"
        assert item["floor_area_m2"] is not None and item["floor_area_m2"] > 0
        assert item["meter"]["unit"] == "kWh"
        assert item["meter"]["reading_semantics"] == "interval_sum"
        assert item["provenance"]["kind"] == "public_benchmark"
        assert item["provenance"]["source_code"] == "bdg2_v1"


def test_readings_endpoint_bounded(client: TestClient):
    assets_resp = client.get("/assets")
    first_asset = assets_resp.json()["items"][0]
    asset_id = first_asset["id"]

    response = client.get(f"/assets/{asset_id}/readings?limit=24")
    assert response.status_code == 200
    payload = response.json()
    assert payload["asset_id"] == asset_id
    assert payload["unit"] == "kWh"
    assert len(payload["items"]) == 24
    assert payload["count"] == 24

    for row in payload["items"]:
        assert row["label"] == "observed"
        assert row["interval_minutes"] == 60
        assert row["consumption_kwh"] >= 0.0
        assert "T" in row["timestamp"] and "Z" in row["timestamp"]


def test_forecast_endpoint_and_accuracy_metrics(client: TestClient):
    assets_resp = client.get("/assets")
    bill_asset = next(a for a in assets_resp.json()["items"] if "Bill" in a["name"])
    asset_id = bill_asset["id"]

    response = client.get(f"/assets/{asset_id}/forecast")
    assert response.status_code == 200
    payload = response.json()
    assert payload["asset_id"] == asset_id
    assert payload["horizon_hours"] == 24
    assert len(payload["items"]) == 24

    for item in payload["items"]:
        assert item["label"] == "forecast"
        assert item["unit"] == "kWh"
        assert item["forecast_kwh"] > 0.0

    metrics = payload["test_metrics"]
    assert "model" in metrics and "baseline" in metrics
    assert metrics["model"]["mae_kwh"] > 0.0
    assert metrics["model"]["rmse_kwh"] > 0.0
    assert metrics["baseline"]["mae_kwh"] > 0.0
    assert metrics["model"]["mae_kwh"] < metrics["baseline"]["mae_kwh"]


def test_anomalies_endpoint_strict_attribution(client: TestClient):
    assets_resp = client.get("/assets")
    bill_asset = next(a for a in assets_resp.json()["items"] if "Bill" in a["name"])
    asset_id = bill_asset["id"]

    response = client.get(f"/assets/{asset_id}/anomalies?limit=50")
    assert response.status_code == 200
    payload = response.json()
    assert payload["result_type"] == "detected"
    assert payload["label"] == "unusual_consumption_pattern"
    assert payload["rule"]["threshold_multiplier"] == 6.0
    assert payload["count"] > 0

    for item in payload["items"]:
        assert item["label"] == "unusual_consumption_pattern"
        assert item["cause"] is None
        assert item["direction"] in {"above_expected", "below_expected"}
        assert item["threshold_kwh"] > 0.0


def test_comparison_endpoint(client: TestClient):
    response = client.get("/assets/comparison?window_hours=24")
    assert response.status_code == 200
    payload = response.json()

    assert payload["result_type"] == "cross_building_comparison"
    assert payload["window_hours"] == 24
    assert len(payload["buildings"]) == 4

    assert payload["benchmark"]["annual_eui_kwh_m2"] == 185.0
    assert payload["cohort_summary"]["cohort_building_count"] == 4

    for b in payload["buildings"]:
        assert b["floor_area_m2"] > 0
        assert b["total_consumption_kwh"] > 0
        assert b["peak_demand_kw"] >= b["avg_demand_kw"] >= b["min_demand_kw"]
        assert 0.0 <= b["load_factor_pct"] <= 100.0
        assert b["daily_eui_kwh_m2"] > 0.0
        assert b["annualized_eui_kwh_m2"] > 0.0


def test_asset_by_name_resolution(client: TestClient):
    response = client.get("/assets/Hog_office_Bill/forecast")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 24


def test_unknown_asset_returns_404(client: TestClient):
    response = client.get("/assets/non-existent-building/readings")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_mismatched_date_range_returns_422(client: TestClient):
    assets_resp = client.get("/assets")
    asset_id = assets_resp.json()["items"][0]["id"]

    # 'from' provided without 'to'
    response = client.get(f"/assets/{asset_id}/readings?from=2017-10-01T00:00:00Z")
    assert response.status_code == 422

    # 'to' before 'from'
    response = client.get(
        f"/assets/{asset_id}/readings?from=2017-10-05T00:00:00Z&to=2017-10-01T00:00:00Z"
    )
    assert response.status_code == 422


def test_energy_flow_endpoint(client: TestClient):
    assets_resp = client.get("/assets")
    bill_asset = next(a for a in assets_resp.json()["items"] if "Bill" in a["name"])
    asset_id = bill_asset["id"]

    # Hourly test
    response = client.get(f"/assets/{asset_id}/energy-flow?timeframe=hourly")
    assert response.status_code == 200
    payload = response.json()
    assert payload["result_type"] == "energy_flow"
    assert payload["timeframe"] == "hourly"
    assert "flows" in payload and "nodes" in payload
    flows = payload["flows"]
    nodes = payload["nodes"]

    # Strictly 0 export to grid & 0 solar direct to building
    assert flows["solar_to_grid_kwh"] == 0.0
    assert flows["battery_to_grid_kwh"] == 0.0
    assert flows["solar_to_building_kwh"] == 0.0

    # Solar to Battery conservation
    assert flows["solar_to_battery_kwh"] == nodes["solar_kwh"]

    # Physics conservation: building load = battery_to_building + grid_to_building
    bld_sum = round(flows["battery_to_building_kwh"] + flows["grid_to_building_kwh"], 1)
    assert abs(bld_sum - round(nodes["building_kwh"], 1)) <= 0.1

    # Daily test
    daily_resp = client.get(f"/assets/{asset_id}/energy-flow?timeframe=daily")
    assert daily_resp.status_code == 200
    daily_payload = daily_resp.json()
    assert daily_payload["timeframe"] == "daily"
    assert daily_payload["readings_count"] == 24
    assert daily_payload["nodes"]["building_kwh"] > 0.0
    daily_flows = daily_payload["flows"]
    assert daily_flows["solar_to_grid_kwh"] == 0.0
    assert daily_flows["battery_to_grid_kwh"] == 0.0
    assert daily_flows["solar_to_building_kwh"] == 0.0
    daily_bld_sum = round(daily_flows["battery_to_building_kwh"] + daily_flows["grid_to_building_kwh"], 1)
    assert abs(daily_bld_sum - round(daily_payload["nodes"]["building_kwh"], 1)) <= 0.1


