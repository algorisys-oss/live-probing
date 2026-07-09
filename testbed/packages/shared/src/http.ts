import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { InjectedFault } from "./chaos.js";
import { CircuitOpenError } from "./resilient.js";

export type { FastifyInstance, FastifyReply, FastifyRequest };

export function createServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    // OpenTelemetry's HTTP instrumentation manages the request id / trace context.
    disableRequestLogging: false,
  });

  // Map the testbed's deliberate faults to clean HTTP statuses so a handler only has to
  // `await applyFault(...)` (chaos) and a caller can just let a shed call throw (breaker), with
  // no try/catch at every site. When chaos is off these are never thrown, so the default
  // Fastify error handling is unaffected.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof InjectedFault) {
      return reply.code(err.statusCode).send({ error: "injected_fault" });
    }
    if (err instanceof CircuitOpenError) {
      return reply.code(err.statusCode).send({ error: "circuit_open" });
    }
    reply.log.error(err);
    const e = err as { statusCode?: number; message?: string };
    return reply.code(e.statusCode ?? 500).send({ error: e.message || "internal_error" });
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}

// Starts listening and wires SIGINT/SIGTERM to a clean shutdown so containers
// stop fast and connections drain.
export async function start(
  app: FastifyInstance,
  port: number,
  onClose?: () => Promise<void>,
): Promise<void> {
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      if (onClose) await onClose();
      process.exit(0);
    } catch (err) {
      app.log.error(err, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port, host: "0.0.0.0" });
}
