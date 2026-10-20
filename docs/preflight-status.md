# Enefit source preflight — 20 October 2026

- Active checkout: `vincent-integration` in `norman-AI-2025/EnergiOS`; existing uncommitted teammate work was preserved.
- Source: [Enefit Kaggle competition](https://www.kaggle.com/competitions/predict-energy-behavior-of-prosumers/data), listed as CC BY-NC-SA 4.0; owner reports non-commercial use and rules acceptance. Browser was signed out, and no local Kaggle CLI/API credential or downloaded source files were found. Sign-in is pending.
- Added local source audit and Git exclusions for raw Enefit files and derived model artifacts. The audit's isolated fixture tests pass, but **no real Enefit rows have been audited or used for training**.
- The existing local `uv` executable created this checkout's ignored `.venv`; the four focused audit tests pass under locked Python 3.12.15. This validates the audit code, not the unavailable real Enefit source or training.
- BDG2 demand forecasting and the existing solar/grid dispatch remain as before. No Enefit model, forecast accuracy, savings claim, API, UI or deployment is claimed from this preflight.
- Next gate: authenticated download, source hashes/quality, target-unit and timestamp verification, permitted artifact use, chronological holdout evaluation. Keep Enefit, OpenCEM and BDG2 sites and timelines separate.
