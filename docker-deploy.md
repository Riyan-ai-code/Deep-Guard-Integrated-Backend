Local development with Docker Compose
----------------------------------

From the repository root (where this file and `docker-compose.yml` live), build and run both services:

```bash
docker-compose up --build
```

- The backend will be reachable at `http://localhost:5000`.
- The ML engine runs internally in the compose network at `ml-engine:8000` and is NOT published to the host.

Docker quick start
------------------

If you want to build and run the two containers manually instead of using Compose, use the Dockerfiles in each service folder:

```bash
docker build -t deep-guard-backend ./Deep-Guard-Backend
docker build -t deep-guard-ml-engine ./Deep-Guard-ML-Engine
docker run --rm -p 8000:8000 deep-guard-ml-engine
docker run --rm -p 5000:5000 --env-file .env deep-guard-backend
```

- Start the ML engine first so the backend can reach it.
- When running without Compose, set `ML_API_URL`, `ML_VIDEO_URL`, and `ML_IMAGE_URL` to the ML engine address reachable from the backend container.

How it works
------------

- `backend` service builds from `Deep-Guard-Backend/Dockerfile` and exposes port `5000`.
- `ml-engine` builds from `Deep-Guard-ML-Engine/Dockerfile` and listens on port `8000` inside the compose network.
- The backend receives the ML engine address via the env `ML_API_URL=http://ml-engine:8000` so all calls go over the internal Docker network.

Deploying to Render (guidance)
------------------------------

Render supports multi-service deployments. Recommended approach:

1. Create two services on Render:
   - Backend: a public Web Service (use the `Deep-Guard-Backend` Dockerfile or Docker image). Set the service to listen on port `5000`.
   - ML engine: a Private Service (or internal service) using the `Deep-Guard-ML-Engine` Dockerfile. Configure it to listen on port `8000`.

2. In the Backend service environment variables, set `ML_API_URL` to the ML service's internal URL. On Render this typically looks like `http://<private-service-name>:8000` or the internal hostname Render provides for private services. (Check Render docs for the exact internal hostname pattern.)

3. Ensure the backend service has the required environment variables (database, supabase keys, etc.) and that the ML service has access to any model files or storage it needs.

Notes
-----
- For local development `docker-compose` provides the private/public separation you requested.
- For production on Render, use a private/internal service for the ML engine so only the backend can reach it.
- If you prefer, I can also create a `render.yaml` template to define both services programmatically for Render's infrastructure as code.
