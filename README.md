# nestjs-base

A starting point for NestJS services on MongoDB. It is built from what works
in `core-backend`, without its domain code.

- **NestJS 11**, **Prisma 6** on MongoDB
- **Two processes from one codebase**: the HTTP API, and BullMQ workers
- **Redis** (cache + queues), **S3-compatible storage** (S3 / R2 / MinIO)
- **JWT** guard, secure by default
- Structured JSON logs with a `traceId` that follows a request into its jobs
- Validated configuration; the process refuses to boot on bad env

## Quick start

```bash
cp .env.example .env
docker compose up -d          # mongo (replica set), redis, minio + bucket
npm install                   # also runs `prisma generate`
npm run db:push               # create collections and indexes
npm run start:dev             # API on :3000, Swagger on /docs
npm run start:dev:worker      # in a second terminal
```

There is no login endpoint. That belongs to a feature module. To call the API
locally, mint a token with the same secret:

```bash
node -e "const {JwtService}=require('@nestjs/jwt');console.log(new JwtService({secret:process.env.JWT_SECRET}).sign({sub:'507f1f77bcf86cd799439011',roles:['admin']}))"
```

## Layout

```
src/
  main.ts                 API entrypoint
  main.worker.ts          worker entrypoint (no HTTP)
  app.module.ts           API root: database + producer side of queues
  worker.module.ts        worker root: queues + storage, NO database
  core/
    config/               env schema (shared vs API-only), validated at boot
    context/              AsyncLocalStorage trace scope + x-request-id middleware
    logging/              nestjs-pino setup: shared pino options, request logging
    http/                 response envelope, exception filter, error codes, app setup
    database/             PrismaService (API only)
    auth/                 global JwtAuthGuard + RolesGuard, @Public/@Roles/@CurrentUser
    redis/                cache client (degrades on outage, never source of truth)
    queue/                BullMQ registration, queue names, BaseProcessor
    storage/              S3 client: write-once puts, presigned URLs
    health/               /health/live, /health/ready
    pagination/ validation/ utils/
  modules/
    notes/                example feature: delete or copy
```

## Conventions

**Layers.** A controller parses input and delegates. The service holds the
business rules and throws HTTP exceptions with a `code`. The repository is
the only place that touches `PrismaService`. See `modules/notes`.

**Responses.** Every route answers with the same envelope. Handlers return
plain data.

```jsonc
{ "statusCode": 200, "success": true,  "message": "OK", "data": { } }
{ "statusCode": 404, "success": false, "message": "Note not found",
  "code": "NOTE_NOT_FOUND", "data": null, "traceId": "…" }
```

Validation errors carry `details: string[]`. Unknown errors become a 500
without leaking the cause. The cause is logged with the same `traceId`.

**Logging.** Logging uses [pino](https://getpino.io) through `nestjs-pino`.
Keep using Nest's `Logger` with a structured object. Each line also gets
`module` (the logger context), `service`, `hostname`, `pid` and, inside a
request or job, `traceId`/`userId`. Pass errors as `err` so pino's
serializer handles them. `console.log` is a lint error.

```ts
private readonly logger = new Logger('notes');
this.logger.log({ operation: 'notes.create', status: 'ok', durationMs, noteId });
this.logger.error({ operation: 'notes.enqueueSnapshot', status: 'error', err: error });
```

`pino-http` writes one line per request, with method, path (no query
string), statusCode, durationMs and traceId. Credential fields are redacted.
Set `LOG_PRETTY=true` for readable local output.

**Auth.** Every route needs a bearer token unless it is marked `@Public()`.
Use `@Roles('admin')` to require a role, and `@CurrentUser()` to get the
caller.

**MongoDB.**
- Every model has `createdAt` and `updatedAt`.
- Every query path has an explicit `@@index`.
- References use `@db.ObjectId`.
- Validate path ids with `ParseObjectIdPipe`.
- Prisma has no migrations on MongoDB, so run `npm run db:push`.
- Soft-delete fields must be written explicitly as `null`, because
  `{ field: null }` does not match a missing field.

**Workers.**
- `WorkerModule` never imports `DatabaseModule`, and the worker env schema
  does not even accept `DATABASE_URL`. A job payload carries everything the
  worker needs.
- Jobs must be idempotent: BullMQ delivers each job at least once.
  - Give each job a deterministic `jobId`, which dedupes enqueues.
  - Derive outputs only from the payload.
  - Write immutable artifacts with `StorageService.putIfAbsent`. It never
    overwrites, and a retry returns `'exists'`.
- Throw `UnrecoverableError` for payloads a retry cannot fix.
- Scale by adding worker replicas.

### Adding a feature module

1. Add the model, with its indexes, to `prisma/schema.prisma`. Run
   `npm run db:push`.
2. Create `modules/<name>/` with `<name>.module.ts`, `.controller.ts`,
   `.service.ts`, `.repository.ts`, and `dto/`.
3. Import the module in `app.module.ts`.

### Adding a queue and job

1. Add the name to `QueueName` in `core/queue/queue.constants.ts`.
2. Define the payload, the jobId and output keys in
   `modules/<name>/jobs/<job>.job.ts`. Import Prisma types with
   `import type` only.
3. Write the processor: extend `BaseProcessor`, and implement an idempotent
   `handle`.
4. Register the processor in `worker.module.ts`. Never register it in
   `app.module.ts`.
5. Enqueue with `@InjectQueue(QueueName.X)`, under the deterministic
   `jobId`.

## Operations

| | |
|---|---|
| Liveness | `GET /health/live` has no dependencies. Never restart on a DB outage. |
| Readiness | `GET /health/ready` checks MongoDB and Redis, with a 3 s bound each. |
| Tracing | `x-request-id` is honoured or generated, echoed back, and carried into jobs. |
| Shutdown | SIGTERM drains HTTP and lets active jobs finish. |
| Image | `docker build .` builds one image. Run the worker with `node dist/main.worker.js`. |

## Deliberately not included

- **Rate limiting.** In-memory throttling is per instance, which breaks
  under horizontal scaling. Add `@nestjs/throttler` with a Redis store
  when needed.
- **Metrics.** Add prom-client on a separate port, as in core-backend's
  `ObservabilityModule`.
- **Slow-query logging.** Prisma 6 removed `$use` middleware. Use a
  `$extends` query extension.
- **Transactional outbox.** An enqueue that fails after a DB write is
  logged, not retried. Add an outbox where a lost job is unacceptable.
- **User and login flows.**
