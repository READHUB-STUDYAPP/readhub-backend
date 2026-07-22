# ReadHub Backend

TypeScript + Express (ESM) REST API for the ReadHub reading platform. Uses
MongoDB (Mongoose), Cloudinary for file/image storage, Brevo for transactional
email, and Google OAuth.

## Tech stack

- Node.js 20 · TypeScript (strict, `NodeNext` ESM) · Express 5
- Mongoose · JWT auth · Multer · Cloudinary · Brevo · Swagger (`/api-docs`)

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
Key groups: MongoDB (`MONGODB_URI`), JWT secrets, Cloudinary, Brevo, Google
OAuth, and the CORS allowlist (`FRONTEND_URL`, `WAITLIST_URL`).

> `NODE_ENV=production` sets the `Secure` flag on the refresh-token cookie, so
> the API must be served over HTTPS in production for the auth/refresh flow.

## Project structure

```
src/
├── server.ts            # app entry: middleware, route mounting
├── config/              # db, cloudinary, swagger
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

Deployment (compose / multi-cloud Terraform) is managed in the
**readhub-infra** repository.
