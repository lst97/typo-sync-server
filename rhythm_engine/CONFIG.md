# Configuration Guide

This application can run in two modes: **In-Memory** (default) or **Celery with Redis**.

## In-Memory Mode (Default)

This is the default mode and requires no extra setup. It is suitable for local development and testing.

- **How it works:** The API uses FastAPI's built-in `BackgroundTasks` to process audio analysis. Task results are stored in a simple Python dictionary in memory.
- **Pros:** No external dependencies needed. Just run the app.
- **Cons:** If the server restarts, all task results are lost.

## Celery with Redis Mode (Production)

This mode is recommended for production as it uses a robust task queue.

- **How it works:** The API offloads analysis to a Celery worker, which uses Redis as a message broker and result backend.
- **Pros:** Scalable and persistent. Tasks and results are managed by Redis and will survive server restarts.
- **Cons:** Requires a running Redis server.

### How to Enable Celery Mode

1. **Create an environment file:** Copy the `.env.example` file to a new file named `.env`.

    ```bash
    cp .env.example .env
    ```

2. **Uncomment the setting:** Open the `.env` file and uncomment the `REDIS_URL` line:

    ```bash
    REDIS_URL=redis://redis:6379/0
    ```

3. **Run with Docker Compose:** When you run `docker-compose up`, the `web` and `worker` services will automatically detect this environment variable and enable Celery.

    ```bash
    docker-compose up --build
    ```

The application will now use Redis for task management. If you wish to switch back to In-Memory mode, simply comment out the `REDIS_URL` line in your `.env` file and restart the services.
