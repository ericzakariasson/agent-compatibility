import * as Sentry from "@sentry/node";
import Fastify from "fastify";
import pino from "pino";

const logger = pino();
const app = Fastify({ logger });

app.get("/health", async () => ({ ok: true }));

app.get("/work", async () => {
  try {
    return { ok: true };
  } catch (error) {
    Sentry.captureException(error);
    logger.error({ error }, "request failed");
    throw error;
  }
});

app.listen({ port: Number(process.env.PORT ?? 3000) });
