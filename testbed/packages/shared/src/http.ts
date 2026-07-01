import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

export type { FastifyInstance, FastifyReply, FastifyRequest };

export function createServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    // OpenTelemetry's HTTP instrumentation manages the request id / trace context.
    disableRequestLogging: false,
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
