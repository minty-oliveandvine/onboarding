# Onboarding Frontend — Docker (local dev)

Run the onboarding frontend locally with one command.

## Prerequisites

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).

## Run

```bash
cp .env.example .env      # from this docker/ folder
cd docker && docker compose up
```

Then open http://localhost:3001.

> If you copied `.env` while already inside `docker/`, just run `docker compose up`.

## What you get

- Next.js dev server on **port 3001** (distinct from the billing frontend on 3000).
- **Hot-reload**: the repo source is bind-mounted, so edits on your host reload
  in the browser. The container keeps its own `node_modules` and `.next`.

## Configuration

Backend URLs are read from the environment (never hardcoded). Edit `.env` to
point the frontend at a different backend:

| Variable                     | Default                 | Purpose                                             |
| ---------------------------- | ----------------------- | --------------------------------------------------- |
| `NEXT_PUBLIC_MODULE1_API_URL`| `http://localhost:5001` | Primary base URL of the pettycash (Flask) backend.  |
| `NEXT_PUBLIC_API_URL`        | `http://localhost:5001` | Legacy fallback for the above, read by `lib/flaskBase.js`. |
| `NEXT_PUBLIC_ONBOARDING_API_URL` | `http://localhost:8001` | The extracted onboarding API (Django). Routing lives in `lib/apiRoutes.js`. |

`.env.example` ships with safe local defaults — a new dev just copies it.

## Common commands

```bash
docker compose up --build     # rebuild the image (e.g. after a lockfile change)
docker compose up -d          # run detached
docker compose down           # stop and remove the container
docker compose logs -f        # follow logs
```
