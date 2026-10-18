"""Seed Supabase database tables with verified BDG2 cohort telemetry."""

import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.supabase_client import SupabaseConfig, SupabaseRepository


async def seed():
    config = SupabaseConfig.from_env()
    if not config:
        print("ERROR: SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SECRET_KEY) are not set in .env")
        sys.exit(1)

    repo = SupabaseRepository(config)
    snapshot_path = ROOT / "src/data/bdg2_live_snapshot.json"
    with open(snapshot_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"Connecting to Supabase at: {config.url}")

    # 1. Seed data_source
    data_source_id = "11111111-0000-4000-8000-000000000001"
    source_row = [{
        "id": data_source_id,
        "source_code": "bdg2_v1",
        "title": "Building Data Genome Project 2",
        "version": "v1.0",
        "doi": "10.5281/zenodo.3887306",
        "licence_spdx": "CC-BY-4.0",
        "attribution_label": "Public benchmark data — Building Data Genome Project 2 v1.0",
        "repository_url": "https://github.com/buds-lab/building-data-genome-project-2",
    }]
    await repo.insert_rows("data_sources", source_row)
    print("✓ data_sources populated")

    # 2. Seed data_import_run
    run_id = "22222222-0000-4000-8000-000000000001"
    run_row = [{
        "id": run_id,
        "data_source_id": data_source_id,
        "cohort_code": "hog_four_buildings_v1",
        "status": "completed",
        "manifest_json": {"source": "bdg2_v1", "buildings": 4},
    }]
    await repo.insert_rows("data_import_runs", run_row)
    print("✓ data_import_runs populated")

    # 3. Seed assets
    raw_assets = data.get("assets", {}).get("items", [])
    asset_rows = []
    meter_rows = []
    for a in raw_assets:
        asset_rows.append({
            "id": a["id"],
            "name": a["name"],
            "asset_type": a.get("asset_type", "Commercial"),
            "floor_area_m2": a.get("floor_area_m2", 10000.0),
            "timezone": a.get("timezone", "US/Central"),
            "primary_space_usage": a.get("primary_space_usage", "Commercial"),
            "source_asset_id": a.get("source_asset_id", a["name"]),
            "data_status": "public_benchmark",
            "data_source_id": data_source_id,
            "import_run_id": run_id,
        })
        m = a.get("meter", {})
        meter_rows.append({
            "id": m.get("id"),
            "asset_id": a["id"],
            "meter_role": m.get("role", "building_total"),
            "source_meter_id": m.get("source_meter_id", f"{a['name']}:electricity"),
            "unit": m.get("unit", "kWh"),
            "reading_semantics": m.get("reading_semantics", "interval_sum"),
            "is_active": True,
            "data_source_id": data_source_id,
        })

    await repo.insert_rows("assets", asset_rows)
    print(f"✓ assets populated ({len(asset_rows)} buildings)")

    await repo.insert_rows("meters", meter_rows)
    print(f"✓ meters populated ({len(meter_rows)} meters)")

    # 4. Seed energy readings
    total_readings = 0
    buildings_data = data.get("buildings", {})
    for a in raw_assets:
        b_name = a["name"]
        meter_id = a.get("meter", {}).get("id")
        b_payload = buildings_data.get(b_name, {})
        raw_readings = b_payload.get("readings", {}).get("items", [])
        
        batch = []
        for r in raw_readings:
            batch.append({
                "meter_id": meter_id,
                "recorded_at": r["timestamp"],
                "interval_minutes": int(r.get("interval_minutes", 60)),
                "consumption_kwh": float(r["consumption_kwh"]),
                "quality_status": r.get("quality_status", "observed"),
                "source_local_timestamp": r.get("source_local_timestamp", ""),
                "source_timezone": r.get("source_timezone", "US/Central"),
                "provenance": "public_benchmark",
                "data_source_id": data_source_id,
            })
            if len(batch) >= 100:
                await repo.insert_rows("energy_readings", batch)
                total_readings += len(batch)
                batch = []
        if batch:
            await repo.insert_rows("energy_readings", batch)
            total_readings += len(batch)

    print(f"✓ energy_readings populated ({total_readings} records)")
    await repo.close()
    print("\n✅ Supabase database seed completed successfully!")


if __name__ == "__main__":
    asyncio.run(seed())
