# Digital System Model

- `msd`: DSM-MSD, Model Setup Data Generation. A library producing the Model
  Setup Data file of a selected project, platform and system version.
- `vae`: DSM-VAE, Design Verification, Analysis and Evaluation. A Flask API,
  a Celery worker and a browser UI over msd.

Requirements: `docs/SRS.md`.

## Run

Settings: `msd/src/msd/msd.ini`, `vae/src/vae/vae.ini`.

**1. Mock data sources** (MySQL and Gitea):

```bash
cd dev && docker compose up
```

**2. Packages** (into a venv):

```bash
python3 -m venv venv && source venv/bin/activate
pip install -e ./msd -e ./vae
```

**3. Redis, worker and API** (one command, Ctrl+C stops all three):

```bash
dsm            # dsm -c 4 sets the worker process count
```

**4. UI:** <http://127.0.0.1:8080>, sign in as `admin` / `admin`, connect both data sources as `dsm` / `dsm`.

## Test

```bash
cd msd && python3 -m pytest
cd vae && python3 -m pytest
```
