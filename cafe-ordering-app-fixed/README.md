# Cafe Ordering App

Production-oriented starter for a cafe ordering system.

## Features
- Customer menu without login
- Mobile-number OTP verification flow
- Cart and order creation
- Dine-in / takeaway
- Table number support
- Admin login and protected admin APIs
- Menu CRUD
- Order status updates
- PostgreSQL schema
- Redis-backed OTP/rate-limit primitives
- Docker Compose
- Nginx reverse proxy
- Health endpoint
- TypeScript backend
- React/Vite frontend

## Quick start
1. Copy `.env.example` to `.env`.
2. Set `JWT_SECRET` and OTP provider credentials if using a real SMS provider.
3. Run `docker compose up --build`.
4. Open http://localhost
5. API health: http://localhost/api/health

### Development OTP
If `OTP_DEV_MODE=true`, the backend logs the generated OTP and accepts it for local testing.
Do NOT enable this in production.

## Production notes
Before production, configure a real SMS provider, HTTPS certificates, strong secrets,
managed PostgreSQL/Redis where appropriate, backups, monitoring, and payment provider
webhook verification. The payment integration is intentionally represented as a safe
extension point rather than pretending to be live without merchant credentials.


## Build fix
The Dockerfiles use `npm install` so the project works without pre-generated lockfiles. The frontend includes a Vite React configuration and SPA nginx fallback.
