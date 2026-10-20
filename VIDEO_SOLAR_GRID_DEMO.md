# Fixed solar/grid video walkthrough

This mode is a reproducible scenario with no live equipment control. It uses the existing demand-forecast routines and deterministic dispatch policy. No new solar/grid classifier is trained or represented as trained.

## Central inputs and sources

`backend/src/data/video_solar_grid_v1.json` is the single versioned profile. All four BDG2 cohort buildings use their own 168 observed hourly readings (25–31 December 2017, site-local time), already bundled in `bdg2_live_snapshot.json`. Snapshot SHA-256: `f75131c84b6a77de9bd555dd1dbbe15a842028fac88d56c2a08c2f8777b0ebc0`. A changed snapshot fails explicitly until the provenance/profile is reviewed. No readings are generated or inserted.

Demand source: [Building Data Genome Project 2 v1.0](https://doi.org/10.5281/zenodo.3887306), CC BY 4.0; Miller et al., [Scientific Data 7, 368 (2020)](https://doi.org/10.1038/s41597-020-00712-x). BDG2 remains public benchmark data, never Sime Darby or Elmina telemetry.

The weather is an authored fixed 24-hour daylight scenario on the fictional demonstration date 19 October 2026 in Asia/Kuala_Lumpur. Radiation, cloud and temperature arrays are in the profile. They are not retrieved from Open-Meteo, have no operational significance and do not establish the BDG2 asset location.

Fixed assumptions: PV 1,200 kWp, performance ratio 0.8, temperature coefficient 0.004/°C above 25°C; battery 250 kWh with initial charge/reserve 20%, charge power 0 kW, discharge limit 50 kW, efficiencies 0.92; grid available. Charging is disabled so the battery stays at its 50 kWh reserve during this Solar/Grid walkthrough. MYR 0.50/kWh is an arbitrary flat demo price, without an applicable-market-tariff claim. No equipment, tariff or emissions benchmarks are introduced.

## Calculations

The endpoint calls existing `fit_profile` and `forecast_24` code on the pinned history. A single week has one observation per weekly slot, so the existing minimum-support rule falls back to its fitted overall mean. This produces a flat 24-hour forecast. Existing dashboard evaluation metrics do not evaluate this short-window replay fit, and this demo has no operational-accuracy or verified-savings claim.

Hourly PV kWh = capacity kWp × radiation W/m² / 1000 × performance ratio × max(0, 1 − temperature coefficient × max(temperature − 25°C, 0)). Radiation includes the authored cloud assumptions; cloud percentage is context, without a second derating.

The existing dispatch engine allocates PV to demand, battery only above reserve and within power limits, then grid. Surplus and unmet energy stay explicit; hourly energy balance is checked. Grid purchases × tariff gives scenario purchase cost. Tariff does not train or change the solar-first policy. Cost excludes CAPEX, battery charging, degradation and tariff schedules. Estimated grid purchase savings compare with all-grid supply of the same forecast demand; total building consumption need not decrease.

Notification timing: PV/demand ≥ 1.05 for two consecutive hours permits a Solar preference; PV/demand < 0.95 for two hours returns the preference to Grid. Minimum dwell is two scenario hours. Actual allocation is shown even when preference is binary. Zero demand produces no switching alert. Every bullet and timestamp is computed from inputs and results. Altered forecasts or weather change or remove the recommendations.

## Endpoints and approval

- `POST /demo/solar-grid/video/recommendation`: `{ "asset_id": "<cohort UUID>", "after_hour": 0 }`. Runs the forecast and dispatch offline. Returns the existing dispatch shape plus `video_demo` metadata and the next calculated transition.
- `POST /demo/solar-grid/video/revalidate`: reruns calculations and checks review ID, recommendation/transition IDs, profile hash, source, scenario hour and battery state before approval. Reviews expire after 10 minutes. Cache is bounded to 128 entries and resets on backend restart.
- The existing explanation endpoint explains the server-cached result. Gemini selects supplied factual sentences; it neither chooses the source nor calculates values. It receives fixed-demo labels, and Open-Meteo is not cited as this mode's weather source. Missing Gemini/provider failures leave computed reasons and approval usable.

Approval updates only shared browser-local scenario state, after fresh server review and an unchanged applied-plan token/pending-card check. Township, energy-flow/battery and KPI views receive the existing update event. Dismissal keeps the applied plan. Stable transition IDs prevent repeat popups; a 15-second popup cooldown prevents rapid reopening. Further calculated cards can appear in an already open panel. No equipment-command or database-write path exists.

## Historical dashboard views

Daily and Monthly use `GET /assets/{asset_id}/readings/summary?period=daily|monthly`.
The default window is the latest observed calendar month in the asset timezone.
Optional paired `from`/`to` UTC bounds are limited to 32 days and hourly boundaries;
the server reads at most 1,000 hourly rows. Calendar grouping accounts for daylight
saving transitions. Responses retain BDG2 provenance, kWh units, observed interval
counts, expected interval counts and partial/missing status. Missing buckets remain
null; a monthly subtotal with incomplete coverage is never presented as a full month.

The current bundled cohort has 168 hours in December 2017, hence 168/744 monthly
coverage. Historical totals contain no forecasts or generated readings.

Dashboard requests additionally set `include_forecast=true`. The response then
includes a separate `forecast` object summing only the existing `/forecast` endpoint's
24 hourly predictions into local calendar days/months. No horizon is extended,
no forecast is inserted into readings, and existing model evaluation remains unchanged.
Both chart series use lines: observed orange, forecast dashed green. The green
connection starts at the final observed point, explicitly identified as an observed
anchor in the tooltip. Monthly predicted points are partial-month 24-hour subtotals,
not complete monthly predictions; coverage counts remain separate for each series.

## Recording flow

### Battery cycle demonstration

`GET /demo/battery-cycle/{asset_id}?period=hourly|daily|monthly` serves the separate
versioned `battery_cycle_demo_v2.json` profile. This is synthetic demonstration data,
not battery measurements or an extended ML forecast. The existing 24-hour BDG2 model
shape is varied with authored month/weekend factors, bounded hourly demand changes,
and seeded, correlated day-to-day weather/cloud inputs. Each building has a stable
seed; there is no repeating seven-day weather loop and no jitter applied to results.
An explicit 17:00–21:00 evening-support schedule uses 30–85% of discharge rating,
with an additional 80–100% hourly multiplier. Grid supports demand outside that
window, retaining stored energy. These are demonstration policy assumptions, not
an established tariff-optimal policy. Existing dispatch formulas carry SOC through a fictional
2026 year. Hourly shows 19 October (24 intervals), Daily shows October (31 days), and
Monthly shows the synthetic year (12 months). Daily/monthly charts display charge and
discharge kWh plus final SOC; tables also disclose the min/max SOC within each period.

Demo equipment assumptions (capacity kWh / PV kWp / charge kW / discharge kW):
Dona 800/1200/150/100; Donnie 200/200/50/30; Francisco 600/900/100/80;
Bill 650/1000/125/90. Initial SOC 60%, reserve 20%, charge/discharge efficiency 92%,
PV ratio 0.8. The central profile records all calendar/weather multipliers and sources.
These are authored examples, not installed equipment specifications or local benchmarks.
All variability bounds, seed, persistence and overcast assumptions are recorded in the
central profile and displayed in the assumptions disclosure. Charge/discharge bars,
SOC, tables and storage cards derive from the same energy-balanced hourly series.
The observed Energy Overview remains unmodified: a genuinely flatter measured
building profile is not replaced with synthetic variability for appearance.

The Battery data selector keeps this view separate from approved plans and savings.
Switch to Approved / forecast plan to inspect the actual existing 24-hour scenario,
including a correctly flat reserve-only plan. No demo cycle can approve or control anything.
Monthly Energy Overview now uses observed daily detail within the recorded month with
only the existing 24-hour forecast, instead of joining incomparable partial-month sums.

Dashboard cards follow the selected period. Hourly shows the latest observed hourly
average and 24-hour range; Daily uses the latest recorded local day; Monthly uses
the latest recorded local month with coverage counts. Demand is kW averaged over
hourly intervals. Load factor is mean/peak hourly demand; intensity is observed
period kWh divided by measured building area. Missing area is not replaced. Model
MAE retains its original hourly evaluation basis in every view.

In Approved / forecast plan mode, battery operations and storage use one dispatch response: approved plans first,
otherwise an unapproved calculated preview. If live weather is unavailable, the
existing central fixed demo profile is used explicitly. No sine-wave SOC, inferred
equipment capacity or independent battery flows are generated by the frontend.
Daily/monthly battery charts group only the existing 24 scenario hours, sum charge
and discharge, and show the final SOC per group. No month-long battery history is
invented. A battery held at reserve correctly remains in standby. Backup duration
accounts for reserve, discharge efficiency and power limits. No physical battery
measurements or control connection are established.

Open `http://127.0.0.1:4176/digital-twin.html` with the backend on port 8000. Fixed mode starts after the building picker loads. Alternatively choose a BDG2 building and press **Run fixed demo / next source change**. The separate live-weather form remains available; fixed mode explicitly overrides those form values with its profile.

1. Show the Grid → Solar alert and its calculated timing/numeric bullets.
2. Approve: forecast, dispatch and feasibility are rechecked; township and shared impacts update. The following Solar → Grid alert appears automatically.
3. Dismiss it to demonstrate unchanged Solar state, or approve it to complete the transition to Grid.
4. **Restart fixed demo** clears this building's video cards/feedback and restores its captured prior non-video plan, if any. Other buildings/plans are preserved, and a fresh review enables another recording.

The fixed walkthrough itself needs neither internet nor Gemini. Existing externally served frontend libraries/assets may still need the browser's cache or a network connection. The authored inputs are not measurements, and the geometry remains illustrative.
