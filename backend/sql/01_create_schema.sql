-- ==============================================================================
-- EnergiOS Supabase PostgreSQL Database Schema
-- Public Benchmark & Whole-Building Telemetry (BDG2 v1.0)
-- ==============================================================================

BEGIN;

-- 1. Provenance Data Sources Table
CREATE TABLE IF NOT EXISTS public.data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    version TEXT NOT NULL,
    doi TEXT,
    licence_spdx TEXT NOT NULL DEFAULT 'CC-BY-4.0',
    attribution_label TEXT NOT NULL,
    repository_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Import Runs Table
CREATE TABLE IF NOT EXISTS public.data_import_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE RESTRICT,
    cohort_code TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('loading', 'completed', 'failed')),
    manifest_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT data_import_runs_source_cohort_unique UNIQUE (data_source_id, cohort_code)
);

-- 3. Assets Table (Whole-Building Facilities)
CREATE TABLE IF NOT EXISTS public.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    floor_area_m2 NUMERIC(14, 4) NOT NULL CHECK (floor_area_m2 > 0),
    timezone TEXT NOT NULL DEFAULT 'US/Central',
    primary_space_usage TEXT NOT NULL,
    source_asset_id TEXT NOT NULL,
    data_status TEXT NOT NULL DEFAULT 'public_benchmark',
    data_source_id UUID REFERENCES public.data_sources(id) ON DELETE RESTRICT,
    import_run_id UUID REFERENCES public.data_import_runs(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT assets_source_asset_unique UNIQUE (source_asset_id)
);

-- 4. Electricity Meters Table
CREATE TABLE IF NOT EXISTS public.meters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
    meter_role TEXT NOT NULL DEFAULT 'building_total' CHECK (meter_role IN ('building_total', 'submeter', 'diagnostic')),
    source_meter_id TEXT NOT NULL UNIQUE,
    unit TEXT NOT NULL DEFAULT 'kWh',
    reading_semantics TEXT NOT NULL DEFAULT 'interval_sum',
    is_active BOOLEAN NOT NULL DEFAULT true,
    data_source_id UUID REFERENCES public.data_sources(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meters_asset_id ON public.meters(asset_id);

-- 5. Time-Series Energy Readings Table
CREATE TABLE IF NOT EXISTS public.energy_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE RESTRICT,
    recorded_at TIMESTAMPTZ NOT NULL,
    interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (interval_minutes = 60),
    consumption_kwh NUMERIC(14, 4) NOT NULL CHECK (consumption_kwh >= 0),
    quality_status TEXT NOT NULL DEFAULT 'observed',
    source_local_timestamp TEXT,
    source_timezone TEXT NOT NULL DEFAULT 'US/Central',
    provenance TEXT NOT NULL DEFAULT 'public_benchmark',
    data_source_id UUID REFERENCES public.data_sources(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT energy_readings_meter_recorded_unique UNIQUE (meter_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_readings_meter_time ON public.energy_readings(meter_id, recorded_at DESC);

-- 6. Row Level Security (RLS) Configuration
ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_readings ENABLE ROW LEVEL SECURITY;

-- Allow read-only access for anon & authenticated users
CREATE POLICY "Allow public read access to data_sources" ON public.data_sources FOR SELECT USING (true);
CREATE POLICY "Allow public read access to data_import_runs" ON public.data_import_runs FOR SELECT USING (true);
CREATE POLICY "Allow public read access to assets" ON public.assets FOR SELECT USING (true);
CREATE POLICY "Allow public read access to meters" ON public.meters FOR SELECT USING (true);
CREATE POLICY "Allow public read access to energy_readings" ON public.energy_readings FOR SELECT USING (true);

COMMIT;
