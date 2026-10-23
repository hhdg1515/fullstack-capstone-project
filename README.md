# GiftLink

GiftLink is a React, Express, and MongoDB application for browsing and sharing free household items. This repository preserves the completed capstone application while establishing a testable foundation for future development. Move-out plans and other marketplace features are not implemented yet.

## Requirements

- Node.js 22 and npm.
- Docker for the isolated backend integration tests and the local MongoDB example below.
- A browser for the React application.

No IBM Skills Network account, Kubernetes environment, or original course database is required.

## Repository structure

```text
giftlink-backend/
  app.js                  Express application factory; does not listen or seed
  server.js               Environment loading, database connection, HTTP startup
  models/                 MongoDB native-driver connection management
  routes/                 Existing gift, search, and authentication APIs
  test/                   Isolated backend integration tests
  util/import-mongo/      Explicit seed command and 16 original demo records
giftlink-frontend/        Existing React application
sentiment/               Separate course example; not part of the app workflow
.github/workflows/       Backend checks and frontend build
```

## Local setup

Install dependencies from the repository root:

```bash
npm --prefix giftlink-backend ci
npm --prefix giftlink-frontend ci
```

Start a local development database. Its port is bound to loopback; the named volume preserves development data between container restarts.

```bash
docker run --detach --name giftlink-mongo \
  --publish 127.0.0.1:27017:27017 \
  --mount source=giftlink-mongo-data,target=/data/db \
  mongo:8.0
```

If this container already exists, use `docker start giftlink-mongo` instead. The integration tests create their own separate container and never use this volume.

Copy the backend sample, then edit the local configuration:

```bash
cp -n giftlink-backend/.env.sample giftlink-backend/.env
```

Use these settings for the local database:

```dotenv
MONGO_URL=mongodb://127.0.0.1:27017
MONGO_DB_NAME=giftdb
JWT_SECRET=replace-with-a-random-local-secret
PORT=3060
```

Generate a local signing secret with Node's `crypto.randomBytes`, or use your secret manager. Replace the placeholder before starting the backend. Keep secrets and actual `.env` files out of version control. Process environment variables take precedence over `.env` values.

Configure the frontend:

```bash
cp -n giftlink-frontend/.env.sample giftlink-frontend/.env.local
```

Set its value to:

```dotenv
REACT_APP_BACKEND_URL=http://127.0.0.1:3060
```

Restart the frontend after changing this value; Create React App reads it at startup/build time.

### Environment variables

| Variable | Used by | Required/default |
| --- | --- | --- |
| `MONGO_URL` | Backend server and seed command | Required MongoDB connection string. The server can use a configured deployment database; demo seeding accepts only a loopback `mongodb://` target. |
| `MONGO_DB_NAME` | Backend server and seed command | Defaults to `giftdb`; selects the database explicitly. Letters, numbers, underscores, and hyphens only. |
| `JWT_SECRET` | Backend server | Required signing secret; seed and integration tests do not need the application's secret. |
| `PORT` | Backend server | Defaults to `3060`. |
| `NODE_ENV` | Backend logging and seed safety | Use `production` for production runtime; demo seeding refuses this mode. |
| `REACT_APP_BACKEND_URL` | React development server/build | Backend origin, such as `http://127.0.0.1:3060`. Never put secrets in `REACT_APP_*` variables. |

### Start the application

In one terminal:

```bash
cd giftlink-backend
npm start
```

The server connects to MongoDB before opening its HTTP listener. A failed connection prevents startup. `npm run dev` uses nodemon with the same startup path.

In another terminal:

```bash
cd giftlink-frontend
npm start
```

The React development server normally uses port `3000`. The backend root endpoint returns `Inside the server` after successful startup.

**Normal server startup does not insert demo data.** A new database initially returns an empty gift list. Seed it explicitly if you want the bundled examples.

## Explicit demo seeding

Before running the command, verify that the service reached through `MONGO_URL` and the selected `MONGO_DB_NAME` belong to your intended local/development database. Do not use production credentials, a production database, or a local tunnel to a production service.

For the local configuration above:

```bash
cd giftlink-backend
npm run seed -- --confirm-db giftdb
```

The command requires `--confirm-db` to match `MONGO_DB_NAME`, connects and pings the selected database, verifies its name, and reports the credential-free host/database before writing. It refuses:

- `NODE_ENV=production` and any database name containing `prod` (case-insensitive).
- Remote hosts and `mongodb+srv://` connections.
- Replica-set or load-balanced cluster discovery options.

Only `mongodb://` connections to `127.0.0.1`, `::1`, or `localhost` resolving entirely to loopback are accepted. The command forces `directConnection=true` so the driver cannot discover remote members. The confirmation is a guard against choosing the wrong database name, not a substitute for identifying the local service.

Seed URI options are limited to `authSource` and `directConnection`. Proxy and other connection options are refused; mixed-case `directConnection` options are normalized before connecting. The server's normal MongoDB connection is not subject to these demo-seed restrictions.

Seeding inserts the 16 original gift records using their legacy `id` values. It does not delete records, reset collections, create indexes, or overwrite matching gifts. Repeating it skips records that already exist and can fill in missing demo IDs. Existing users and unrelated gifts are left unchanged. Keep a custom `MONGO_DB_NAME` and `--confirm-db` value in agreement.

The historical importer entry point remains available through `npm start -- --confirm-db giftdb` from `giftlink-backend/util/import-mongo`, using the dependencies installed in the backend. Installing that nested package separately is unnecessary; its historical lockfile is not the backend's dependency source.

## Tests and checks

Run the backend checks:

```bash
cd giftlink-backend
npm run lint
npm test
```

The integration suite uses the real MongoDB native driver against fresh, disposable Docker MongoDB containers. Each suite uses a unique database and a random loopback port, without host data mounts. The harness verifies its container identity before database writes. Test targets and signing keys are constructed by the tests; application database settings and credentials do not select those targets. Seed CLI tests supply their own isolated database settings even when the CLI loads dotenv. Cleanup removes only the containers created by the tests.

Docker must be running and able to obtain the pinned MongoDB test image on the first run. A missing Docker daemon or failed image download fails the suite; the tests do not fall back to an existing database. If a process is forcibly killed before cleanup, inspect and remove only its clearly labeled disposable test container.

Tests cover gift listing, item details, search, registration/login, password hashing, and the existing profile-update authorization rules. They also exercise import safety, database-before-listener startup, and the explicit seed command's target checks, preservation, and repeatability. The test command fails if no tests are found. `npm run test:integration` runs only the existing-API integration suite; `npm test` runs the full backend suite.

Build the frontend:

```bash
cd giftlink-frontend
CI=false npm run build
```

The frontend currently has no automated test files. `CI=true npm test -- --watchAll=false` reports no tests; it is not presented as a successful test check. `CI=false` preserves the existing frontend build policy while the older toolchain's warnings remain.

GitHub Actions runs backend dependency installation, lint, and real isolated tests, plus a frontend frozen-lockfile install and production build for pull requests targeting `main` and pushes to `main`. CI does not need application database credentials or deployment secrets and does not deploy.

## Existing API contracts

| Method and path | Existing behavior |
| --- | --- |
| `GET /` | Returns `Inside the server`. |
| `GET /api/gifts` | Returns the gift array. |
| `GET /api/gifts/:id` | Looks up the legacy string `id`; missing gifts return `404`. |
| `POST /api/gifts` | Creates a gift and returns `201` with `acknowledged` and `insertedId`. |
| `GET /api/search` | Filters by `name`, `category`, `condition`, and maximum `age_years`. |
| `POST /api/auth/register` | Registers an account; returns `authtoken` and normalized `email`. |
| `POST /api/auth/login` | Returns `authtoken`, `userName`, and `userEmail`. |
| `PUT /api/auth/update` | Updates a name using JSON `{ "name": "..." }`, an `email` header, and an owning `Authorization: Bearer ...` token. |

The React UI and the 16 bundled gift records are unchanged by the baseline work. Directly running `node app.js` is no longer the server entry point; use `npm start` or `node server.js`.

## Current limitations

- Anonymous gift creation, unrestricted gift payloads, non-expiring JWTs, and broad CORS are existing behavior retained for compatibility. This baseline is not a production-security hardening milestone.
- The profile React page has an unfinished update flow and is not registered in the current router.
- The separate sentiment example requires a missing `logger.js` and is not required for running or testing GiftLink.
- No deployment or new marketplace functionality is included. Production hosting, secrets, operational controls, and future authorization/privacy changes require their own reviewed work.

## License and provenance

The repository derives from the IBM Developer Skills Network capstone and retains its [Apache 2.0 license](LICENSE) and applicable attribution. Review individual image and icon licensing before redistributing assets in a portfolio release.
