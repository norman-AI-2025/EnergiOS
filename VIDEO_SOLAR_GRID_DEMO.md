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

## Recording flow

Open `http://127.0.0.1:4176/digital-twin.html` with the backend on port 8000. Fixed mode starts after the building picker loads. Alternatively choose a BDG2 building and press **Run fixed demo / next source change**. The separate live-weather form remains available; fixed mode explicitly overrides those form values with its profile.

1. Show the Grid → Solar alert and its calculated timing/numeric bullets.
2. Approve: forecast, dispatch and feasibility are rechecked; township and shared impacts update. The following Solar → Grid alert appears automatically.
3. Dismiss it to demonstrate unchanged Solar state, or approve it to complete the transition to Grid.
4. **Restart fixed demo** clears this building's video cards/feedback and restores its captured prior non-video plan, if any. Other buildings/plans are preserved, and a fresh review enables another recording.

The fixed walkthrough itself needs neither internet nor Gemini. Existing externally served frontend libraries/assets may still need the browser's cache or a network connection. The authored inputs are not measurements, and the geometry remains illustrative.
