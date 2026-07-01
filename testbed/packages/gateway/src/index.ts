import {
  createServer,
  start,
  env,
  envInt,
  type FastifyReply,
  type FastifyRequest,
} from "@shopwave/shared";

async function main(): Promise<void> {
  const app = createServer();

  // Open CORS: the SPA is served from a different origin than the gateway. Fine for a
  // local testbed; a real deployment would allowlist origins.
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "authorization,content-type");
    reply.header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  });
  app.options("/*", async (_req, reply) => reply.code(204).send());

  const authUrl = env("AUTH_URL", "http://localhost:3001");
  const catalogUrl = env("CATALOG_URL", "http://localhost:3002");
  const cartUrl = env("CART_URL", "http://localhost:3003");
  const orderUrl = env("ORDER_URL", "http://localhost:3004");

  // Forward a request to a downstream service. The HTTP-client instrumentation
  // records the outbound span and injects the traceparent, so the whole path is
  // one trace with context propagated across every process boundary.
  async function forward(
    reply: FastifyReply,
    url: string,
    opts: { method?: string; body?: unknown; userId?: string } = {},
  ): Promise<string> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.userId) headers["x-user-id"] = opts.userId;

    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    reply.code(res.status);
    reply.header("content-type", res.headers.get("content-type") ?? "application/json");
    const cache = res.headers.get("x-cache");
    if (cache) reply.header("x-cache", cache);
    return text;
  }

  // Authenticate by asking the auth service to validate the bearer token. Returns
  // the userId, or sends a 401 and returns null. That extra hop is deliberate: it
  // keeps the gateway stateless and shows auth in the trace.
  async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const authorization = req.headers["authorization"];
    if (!authorization) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    const res = await fetch(`${authUrl}/verify`, { headers: { authorization } });
    if (!res.ok) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    const { userId } = (await res.json()) as { userId: string };
    return userId;
  }

  // --- public: auth ---
  app.post("/api/signup", async (req, reply) =>
    forward(reply, `${authUrl}/signup`, { method: "POST", body: req.body }),
  );
  app.post("/api/login", async (req, reply) =>
    forward(reply, `${authUrl}/login`, { method: "POST", body: req.body }),
  );

  // --- public: catalog ---
  app.get("/api/products", async (_req, reply) => forward(reply, `${catalogUrl}/products`));
  app.get<{ Params: { id: string } }>("/api/products/:id", async (req, reply) =>
    forward(reply, `${catalogUrl}/products/${encodeURIComponent(req.params.id)}`),
  );

  // --- protected: cart ---
  app.get("/api/cart", async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return reply;
    return forward(reply, `${cartUrl}/cart`, { userId });
  });
  app.post("/api/cart/items", async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return reply;
    return forward(reply, `${cartUrl}/cart/items`, { method: "POST", body: req.body, userId });
  });
  app.delete<{ Params: { productId: string } }>("/api/cart/items/:productId", async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return reply;
    return forward(reply, `${cartUrl}/cart/items/${encodeURIComponent(req.params.productId)}`, {
      method: "DELETE",
      userId,
    });
  });
  app.post("/api/checkout", async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return reply;
    return forward(reply, `${cartUrl}/cart/checkout`, { method: "POST", userId });
  });

  // --- protected: orders ---
  app.get("/api/orders", async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return reply;
    return forward(reply, `${orderUrl}/orders?userId=${encodeURIComponent(userId)}`, { userId });
  });
  app.get<{ Params: { id: string } }>("/api/orders/:id", async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return reply;
    return forward(reply, `${orderUrl}/orders/${encodeURIComponent(req.params.id)}`, { userId });
  });

  await start(app, envInt("GATEWAY_PORT", 3000));
}

main().catch((err) => {
  console.error("gateway failed to start", err);
  process.exit(1);
});
