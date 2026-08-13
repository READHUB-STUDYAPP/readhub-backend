# ReadHub Backend

TypeScript + Express (ESM) REST API for the ReadHub reading platform. Uses
MongoDB (Mongoose), **S3-compatible object storage (MinIO)** for file/image
storage, Brevo for transactional email, and Google OAuth.

## Tech stack

- Node.js 20 · TypeScript (strict, `NodeNext` ESM) · Express 5
- Mongoose · JWT auth · Multer · AWS SDK v3 (S3 / MinIO) · Brevo · Swagger (`/api-docs`)

## Getting started

```bash
npm install
cp .env.example .env     # fill in real values
npm run dev              # tsx watch, hot reload
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run with hot reload (`tsx watch src/server.ts`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server (`node dist/server.js`) |
| `npm run typecheck` | Type-check without emitting |

## Environment

All configuration is via environment variables — see [.env.example](.env.example).
Key groups: MongoDB (`MONGODB_URI`), JWT secrets, object storage (`S3_*`), Brevo,
Google OAuth, and the CORS allowlist (`FRONTEND_URL`, `WAITLIST_URL`,
`DEVELOPMENT_TEST`).

### Object storage (`S3_*`)

| Variable | Purpose |
|---|---|
| `S3_ENDPOINT` | **Internal** endpoint the server uses (e.g. `http://minio:9000`) |
| `S3_PUBLIC_URL` | **Public** base URL the browser hits (e.g. `https://files.readhub.study`) |
| `S3_BUCKET` | Bucket name (public-read for delivery) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credentials |
| `S3_REGION` | Defaults to `us-east-1` |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO (default) |

Uploads use **presigned PUT** URLs: the client requests a short-lived signed URL
(`GET /api/cloudinary-signature/pdf` or `/image`) and uploads the file straight to
storage. Presigned URLs are **signed against `S3_PUBLIC_URL`** (not the internal
endpoint) so the browser gets a reachable HTTPS URL; delivery is via the
public-read bucket at `${S3_PUBLIC_URL}/${S3_BUCKET}/<key>`.

> `NODE_ENV=production` sets the `Secure` flag on the refresh-token cookie, so
> the API must be served over HTTPS in production for the auth/refresh flow.

## Project structure

```
src/
├── server.ts            # app entry: middleware, route mounting
├── config/              # db, s3 (MinIO), swagger
├── controllers/         # auth, book, notes, userProfile, waitlist
├── middlewares/         # authenticate (JWT), upload (multer)
├── models/              # Mongoose models + TS interfaces
├── routes/              # express routers (carry @swagger docs)
├── services/            # generateToken, GoogleAuth, sendVerificationEmail
└── types/               # Express Request augmentation (req.user)
```

## API docs

With the server running, interactive Swagger docs are at `GET /api-docs`.

## Docker

```bash
docker build -t readhub-backend .
docker run --env-file .env -p 5000:5000 readhub-backend
```

## Deployment

Pushing to **`staging`** or **`main`** triggers `.github/workflows/build.yml`,
which builds and pushes the image to GHCR and dispatches a deploy to the
**readhub-infra** repo (staging → `api.staging.readhub.study`, main →
`api.readhub.study`). Developers ship by merging PRs — see
[readhub-infra](https://github.com/READHUB-STUDYAPP/readhub-infra) for the full
pipeline, secrets, and the shared single-box topology.
