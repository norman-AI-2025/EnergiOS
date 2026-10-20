from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from src.reading_summary import summarize, summarize_forecast
import pytest


def rows(start, count):
    return [SimpleNamespace(timestamp=(start + timedelta(hours=i)).isoformat(),
        consumption_kwh=2, interval_minutes=60, label='observed', quality_status='observed') for i in range(count)]


def test_daily_dst_and_missing_values():
    start = datetime(2024,3,10,6,tzinfo=timezone.utc)
    data = rows(start,23)
    result = summarize(data,start,start+timedelta(hours=23),'US/Central','daily')
    assert result[0]['period'] == '2024-03-10'
    assert result[0]['expected_intervals'] == 23
    assert result[0]['observed_kwh'] == 46
    assert result[0]['min_hourly_kw'] == 2
    assert result[0]['max_hourly_kw'] == 2
    assert result[0]['latest_hourly_kw'] == 2
    result = summarize(data[1:]+[data[1]],start,start+timedelta(hours=23),'US/Central','daily')
    assert result[0]['observed_intervals'] == 22
    assert result[0]['status'] == 'partial'


def test_month_local_boundary_and_empty_is_not_zero():
    start=datetime(2024,1,1,6,tzinfo=timezone.utc)
    result=summarize(rows(start,24),start,start+timedelta(days=31),'US/Central','monthly')
    assert result[0]['period']=='2024-01'
    assert result[0]['expected_intervals']==744
    assert result[0]['observed_kwh']==48
    assert result[0]['first_observed_date']=='2024-01-01'
    assert result[0]['last_observed_date']=='2024-01-01'
    assert result[0]['missing_intervals']==720
    assert summarize([],start,start+timedelta(days=1),'US/Central','daily')[0]['observed_kwh'] is None


def test_summary_routes_bounds_and_cohort():
    from fastapi.testclient import TestClient
    from app import app
    with TestClient(app) as client:
        asset=client.get('/assets').json()['items'][0]['id']
        daily=client.get(f'/assets/{asset}/readings/summary?period=daily')
        assert daily.status_code==200
        assert sum(b['observed_intervals'] for b in daily.json()['items'])==168
        monthly=client.get(f'/assets/{asset}/readings/summary?period=monthly').json()
        assert monthly['items'][0]['expected_intervals']==744
        assert monthly['items'][0]['status']=='partial'
        forecast=client.get(f'/assets/{asset}/forecast').json()
        projected=client.get(f'/assets/{asset}/readings/summary?period=monthly&include_forecast=true').json()
        assert projected['forecast']['horizon_hours']==24
        assert sum(b['forecast_intervals'] for b in projected['forecast']['items'])==24
        assert sum(b['forecast_kwh'] for b in projected['forecast']['items'])==pytest.approx(sum(r['forecast_kwh'] for r in forecast['items']))
        assert projected['forecast']['items'][0]['status']=='partial'
        assert client.get(f'/assets/{asset}/readings/summary?period=yearly').status_code==422
        assert client.get(f'/assets/{asset}/readings/summary?from=2017-01-01T00:00:00Z&to=2018-01-01T00:00:00Z').status_code==422


def test_forecast_aggregation_never_extends_horizon_and_respects_local_month_boundary():
    start=datetime(2018,1,1,5,tzinfo=timezone.utc)  # Dec 31 23:00 US/Central
    data=[SimpleNamespace(timestamp=(start+timedelta(hours=i)).isoformat(),forecast_kwh=i+1,label='forecast') for i in range(24)]
    month=summarize_forecast(data,'US/Central','monthly')
    assert [b['period'] for b in month]==['2017-12','2018-01']
    assert [b['forecast_intervals'] for b in month]==[1,23]
    assert sum(b['forecast_kwh'] for b in month)==300
    assert all(b['status']=='partial' for b in month)
    assert len(summarize_forecast(data,'US/Central','daily'))==2
    with pytest.raises(ValueError): summarize_forecast(data[:-1],'US/Central','monthly')
    with pytest.raises(ValueError): summarize_forecast(data[:-1]+[data[0]],'US/Central','monthly')
