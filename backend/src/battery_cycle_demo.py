"""One deterministic synthetic battery scenario; never a meter-reading source."""
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
import json
import hashlib
import random
from src.solar_grid import SolarGridRequest, recommend_dispatch

PROFILE = Path(__file__).parent / 'data' / 'battery_cycle_demo_v2.json'


@lru_cache(maxsize=4)
def annual_cycle(asset_id, asset_name, forecast_json, profile_json):
    p=json.loads(profile_json)
    template=json.loads(forecast_json)
    if len(template)!=24:
        raise ValueError('Exactly 24 validated forecast values are required')
    equipment=p['assets'][asset_name]
    capacity=equipment['battery_capacity_kwh']
    soc=capacity*p['battery_initial_soc_pct']/100
    day=datetime(p['year'],1,1)
    end=datetime(p['year']+1,1,1)
    rows=[]
    # Stable asset-specific input generation, never randomised result/chart values.
    seed = int(hashlib.sha256(f"{p['seed']}:{asset_name}".encode()).hexdigest()[:16], 16)
    rng = random.Random(seed)
    weather_state = .72
    demand_state = 1.0
    while day<end:
        demand_memory = p['daily_demand_persistence']
        demand_state = demand_memory*demand_state + (1-demand_memory)*rng.uniform(*p['daily_demand_range'])
        persistence = p['weather_persistence']
        weather_state = persistence*weather_state + (1-persistence)*rng.uniform(*p['daily_weather_range'])
        # Occasional overcast days are input assumptions, not assertions about actual weather.
        weather_factor = weather_state * (rng.uniform(*p['overcast_factor_range'])
                                          if rng.random()<p['overcast_day_probability'] else 1)
        factor=p['demand_month_factors'][day.month-1]*(p['weekend_demand_factor'] if day.weekday()>=5 else 1)*demand_state
        radiation_factor=p['solar_month_factors'][day.month-1]*weather_factor
        evening_fraction = rng.uniform(*p['evening_power_fraction_range'])
        discharge_limits = [equipment['max_discharge_kw']*evening_fraction*rng.uniform(*p['evening_hourly_power_fraction_range'])
                            if hour in p['evening_discharge_hours'] else 0 for hour in range(24)]
        request=SolarGridRequest(asset_id=asset_id,**equipment,battery_soc_pct=max(p['battery_reserve_pct'],min(100,soc/capacity*100)),
            battery_reserve_pct=p['battery_reserve_pct'],charge_efficiency=p['charge_efficiency'],
            discharge_efficiency=p['discharge_efficiency'],pv_performance_ratio=p['pv_performance_ratio'])
        demand=[{'timestamp':(day+timedelta(hours=i)).isoformat(),
                 'forecast_kwh':value*factor*(1+rng.uniform(-p['hourly_demand_variation'],p['hourly_demand_variation']))}
                for i,value in enumerate(template)]
        cloud_state=1.0
        hourly_radiation=[]
        for hour in range(24):
            cloud_memory=p['hourly_cloud_persistence']
            cloud_state=cloud_memory*cloud_state+(1-cloud_memory)*rng.uniform(1-p['hourly_cloud_variation'],1+p['hourly_cloud_variation'])
            hourly_radiation.append(p['radiation_w_m2'][hour]*radiation_factor*cloud_state)
        weather={'timezone':p['timezone'],'rows':[{'timestamp':(day+timedelta(hours=i)).isoformat(),
            'shortwave_radiation_w_m2':hourly_radiation[i],
            'temperature_c':p['temperature_c'][i]+(weather_factor-p['temperature_weather_reference'])*p['temperature_weather_sensitivity_c']
                            +rng.uniform(-p['temperature_jitter_c'],p['temperature_jitter_c']),
            'cloud_cover_pct':max(0,min(100,100*(1-hourly_radiation[i]/max(1,p['radiation_w_m2'][i]))))}
            for i in range(24)]}
        result=recommend_dispatch(request,demand,weather,asset_name=asset_name,provenance={'kind':'synthetic_demo'},
                                  battery_discharge_limits_kw=discharge_limits)
        rows.extend(h.model_dump() for h in result.hours)
        soc=result.hours[-1].battery_soc_kwh
        day+=timedelta(days=1)
    return rows


def battery_demo(asset_id, asset_name, forecast_items, period):
    profile_json=PROFILE.read_text(encoding='utf-8')
    p=json.loads(profile_json)
    forecast_json=json.dumps([r.forecast_kwh for r in forecast_items],separators=(',',':'))
    all_rows=annual_cycle(str(asset_id),asset_name,forecast_json,profile_json)
    scope=p['focus_date'] if period=='hourly' else p['focus_date'][:7] if period=='daily' else str(p['year'])
    rows=[h for h in all_rows if h['weather_timestamp'].startswith(scope)]
    capacity=p['assets'][asset_name]['battery_capacity_kwh']
    groups={}
    charging=discharging=storing=0
    for h in rows:
        key=h['weather_timestamp'] if period=='hourly' else h['weather_timestamp'][:10] if period=='daily' else h['weather_timestamp'][:7]
        b=groups.setdefault(key,{'key':key,'count':0,'charge':0,'discharge':0,'min_soc':100,'max_soc':0})
        b['count']+=1;b['charge']+=h['solar_to_battery_kwh'];b['discharge']+=h['battery_to_load_kwh']
        b['soc']=h['battery_soc_kwh']/capacity*100
        b['min_soc']=min(b['min_soc'],b['soc']);b['max_soc']=max(b['max_soc'],b['soc']);b['hour']=h
        if h['solar_to_battery_kwh']>0: charging+=1
        elif h['battery_to_load_kwh']>0: discharging+=1
        else: storing+=1
    items=list(groups.values())
    # A daily/monthly view shows variation within each period, not just the reserve-valued endpoint.
    for b in items:
        b['state']='cycling' if b['charge']>0 and b['discharge']>0 else 'charging' if b['charge']>0 else 'discharging' if b['discharge']>0 else 'storing'
    return {'asset_id':str(asset_id),'asset_name':asset_name,'version':p['version'],'label':p['label'],
        'period':period,'timezone':p['timezone'],'scope':scope,'scope_hours':len(rows),'items':items,
        'totals':{'charge':sum(b['charge'] for b in items),'discharge':sum(b['discharge'] for b in items),
            'charging':charging,'discharging':discharging,'storing':storing,'demand_kwh':sum(h['demand_forecast_kwh'] for h in rows)},
        'storage_hour':rows[p['focus_hour']] if period=='hourly' else rows[-1],'assumptions':{**p,**p['assets'][asset_name]},
        'sources':[{'title':'BDG2 v1.0 — source of the 24h forecast shape only','url':'https://doi.org/10.5281/zenodo.3887306'},
            {'title':'Authored demo demand, weather and equipment assumptions','reference':p['version']}],
        'formulas':['PV and battery dispatch reuse the existing reserve/power/efficiency-constrained engine',
            'SOC(next) = SOC + solar charge × charge efficiency − battery delivery / discharge efficiency',
            'Demo load = 24h model shape × month factor × weekend factor × correlated daily factor × bounded hourly variation',
            'Demo radiation = authored hourly profile × month factor × correlated daily weather × hourly cloud factor',
            'Evening battery delivery ≤ daily/hourly schedule limit ≤ rated power; no battery discharge outside the stated window'],
        'limitations':['No measured battery data','No extended ML forecast or validated battery performance',
            'No live controls; this dataset does not alter approved plans, meter readings or savings']}
