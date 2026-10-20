import json
import pytest
from fastapi.testclient import TestClient
from app import app
from src.bdg2_data import get_data_service
from src.battery_cycle_demo import PROFILE, annual_cycle, battery_demo


def test_all_buildings_have_deterministic_consistent_synthetic_cycles():
    service=get_data_service(); service.initialize()
    p=json.loads(PROFILE.read_text())
    capacities=set()
    for asset in service.list_assets().items:
        forecast=service.get_forecast(asset.id).items
        monthly=battery_demo(asset.id,asset.name,forecast,'monthly')
        daily=battery_demo(asset.id,asset.name,forecast,'daily')
        hourly=battery_demo(asset.id,asset.name,forecast,'hourly')
        assert len(monthly['items'])==12
        assert len(daily['items'])==31
        assert len(hourly['items'])==24
        assert hourly==battery_demo(asset.id,asset.name,forecast,'hourly')
        assert hourly['totals']['charge']>0 and hourly['totals']['discharge']>0
        # Input variability must survive the physical dispatch, rather than repeating
        # a seven-day sequence or pinning every daily endpoint to the reserve.
        assert len({round(b['charge'],1) for b in daily['items']})>=20
        assert max(b['soc'] for b in daily['items'])-min(b['soc'] for b in daily['items'])>15
        assert any(abs(daily['items'][i]['charge']-daily['items'][i+7]['charge'])>1 for i in range(24))
        assert max(b['soc'] for b in hourly['items'])-min(b['soc'] for b in hourly['items'])>10
        october=monthly['items'][9]
        assert october['charge']==pytest.approx(sum(b['charge'] for b in daily['items']))
        assert october['discharge']==pytest.approx(sum(b['discharge'] for b in daily['items']))
        focus=next(b for b in daily['items'] if b['key']==p['focus_date'])
        assert focus['charge']==pytest.approx(hourly['totals']['charge'])
        assert 'Demo battery scenario' in monthly['label']
        assert sum(monthly['totals'][k] for k in ['charging','discharging','storing'])==8760
        a=monthly['assumptions'];capacities.add(a['battery_capacity_kwh'])
        rows=annual_cycle(str(asset.id),asset.name,json.dumps([r.forecast_kwh for r in forecast],separators=(',',':')),PROFILE.read_text())
        soc=a['battery_capacity_kwh']*p['battery_initial_soc_pct']/100
        for row in rows:
            assert row['demand_forecast_kwh']==pytest.approx(row['solar_to_load_kwh']+row['battery_to_load_kwh']+row['grid_to_load_kwh'],abs=.003)
            assert row['solar_estimate_kwh']==pytest.approx(row['solar_to_load_kwh']+row['solar_to_battery_kwh']+row['curtailed_solar_kwh'],abs=.003)
            assert row['battery_soc_kwh']==pytest.approx(soc+row['solar_to_battery_kwh']*.92-row['battery_to_load_kwh']/.92,abs=.003)
            assert a['battery_capacity_kwh']*.2-.001 <= row['battery_soc_kwh'] <= a['battery_capacity_kwh']+.001
            assert row['solar_to_battery_kwh']<=a['max_charge_kw']+.001
            assert row['battery_to_load_kwh']<=a['max_discharge_kw']+.001
            if int(row['weather_timestamp'][11:13]) not in p['evening_discharge_hours']:
                assert row['battery_to_load_kwh']==0
            soc=row['battery_soc_kwh']
    assert len(capacities)==4


def test_readonly_cycle_route_and_monthly_real_detail():
    with TestClient(app) as client:
        asset=client.get('/assets').json()['items'][0]['id']
        r=client.get(f'/demo/battery-cycle/{asset}?period=daily')
        assert r.status_code==200
        assert r.json()['scope_hours']==744
        assert client.get(f'/demo/battery-cycle/{asset}?period=invalid').status_code==422
        assert client.post(f'/demo/battery-cycle/{asset}',json={}).status_code==405
        monthly=client.get(f'/assets/{asset}/readings/summary?period=monthly&include_forecast=true').json()
        assert monthly['daily_detail']['period']=='daily'
        assert sum(b['observed_intervals']>0 for b in monthly['daily_detail']['items'])==7
        assert sum(b['forecast_intervals'] for b in monthly['daily_detail']['forecast']['items'])==24
