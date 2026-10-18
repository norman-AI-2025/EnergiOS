"""Tests for Supabase PostgreSQL database integration."""

import pytest
from src.supabase_client import SupabaseConfig, SupabaseRepository


@pytest.mark.anyio
async def test_supabase_config_and_connection():
    config = SupabaseConfig.from_env()
    assert config is not None
    assert "supabase.co" in config.url
    assert len(config.key) > 10

    repo = SupabaseRepository(config)
    assert repo.is_configured

    # Test database connectivity
    connected = await repo.ping()
    assert connected is True, "Supabase database ping failed"

    # Test fetching live assets from Supabase
    assets = await repo.fetch_assets()
    assert len(assets) == 4, f"Expected 4 assets in Supabase, found {len(assets)}"

    names = {a["name"] for a in assets}
    assert "Hog_office_Bill" in names
    assert "Hog_education_Donnie" in names
    assert "Hog_assembly_Dona" in names
    assert "Hog_lodging_Francisco" in names

    # Test fetching meters
    meters = await repo.fetch_meters()
    assert len(meters) == 4

    await repo.close()
