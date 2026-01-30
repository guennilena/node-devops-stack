import Fastify from "fastify";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import client, { Registry } from "prom-client";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info"
  }
});

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  app.log.fatal("DATABASE_URL missing");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// ---- Prometheus metrics ----
const registry = new Registry();
client.collectDefaultMetrics({ register: registry });

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"]
});
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]
});

registry.registerMetric(httpRequestsTotal);
registry.registerMetric(httpRequestDuration);

app.addHook("onResponse", async (req, reply) => {
  const route = req.routeOptions?.url ?? "unknown";
  const labels = {
    method: req.method,
    route,
    status: String(reply.statusCode)
  };
  httpRequestsTotal.inc(labels);
  // Fastify exposes response time (ms) on reply.getResponseTime()
  const seconds = (reply.getResponseTime() ?? 0) / 1000;
  httpRequestDuration.observe(labels, seconds);
});

// ---- Routes ----
app.get("/health", async () => {
  // Liveness: process up
  return { status: "ok" };
});

app.get("/ready", async () => {
  // Readiness: DB reachable
  const res = await pool.query("SELECT 1 as ok");
  return { status: "ready", db: res.rows[0].ok === 1 };
});

app.get("/metrics", async (_req, reply) => {
  reply.header("Content-Type", registry.contentType);
  return registry.metrics();
});

// Shipments CRUD
app.get("/shipments", async (req) => {
  const { status } = req.query ?? {};
  const params = [];
  let sql = "SELECT id, status, eta, updated_at FROM shipments";
  if (status) {
    params.push(status);
    sql += " WHERE status = $1";
  }
  sql += " ORDER BY updated_at DESC LIMIT 200";
  const res = await pool.query(sql, params);
  return res.rows;
});

app.get("/shipments/:id", async (req, reply) => {
  const { id } = req.params;
  const res = await pool.query(
    "SELECT id, status, eta, updated_at FROM shipments WHERE id = $1",
    [id]
  );
  if (res.rowCount === 0) return reply.code(404).send({ error: "not_found" });
  return res.rows[0];
});

app.post("/shipments", async (req, reply) => {
  const body = req.body ?? {};
  const status = body.status ?? "created";
  const eta = body.eta ?? null;

  const id = randomUUID();
  const res = await pool.query(
    "INSERT INTO shipments (id, status, eta) VALUES ($1, $2, $3) RETURNING id, status, eta, updated_at",
    [id, status, eta]
  );

  return reply.code(201).send(res.rows[0]);
});

app.patch("/shipments/:id", async (req, reply) => {
  const { id } = req.params;
  const body = req.body ?? {};
  const status = body.status;
  const eta = body.eta;

  // partial update
  const res = await pool.query(
    `
    UPDATE shipments
    SET
      status = COALESCE($2, status),
      eta = COALESCE($3, eta),
      updated_at = NOW()
    WHERE id = $1
    RETURNING id, status, eta, updated_at
    `,
    [id, status ?? null, eta ?? null]
  );

  if (res.rowCount === 0) return reply.code(404).send({ error: "not_found" });
  return res.rows[0];
});

app.delete("/shipments/:id", async (req, reply) => {
  const { id } = req.params;
  const res = await pool.query("DELETE FROM shipments WHERE id = $1", [id]);
  if (res.rowCount === 0) return reply.code(404).send({ error: "not_found" });
  return reply.code(204).send();
});

// Graceful shutdown (SIGTERM)
const shutdown = async () => {
  app.log.info("shutting down...");
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

app.listen({ host: "0.0.0.0", port: PORT }).then(() => {
  app.log.info({ port: PORT }, "api started");
});
