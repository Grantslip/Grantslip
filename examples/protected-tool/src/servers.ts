import express, { type Express, type RequestHandler } from "express";
import Fastify, { type FastifyInstance } from "fastify";
import {
  keyring,
  keyringFastify,
  type ConnectResponse,
  type KeyringHttpOptions,
  type ReplyLike,
  type RequestLike,
} from "@grantslip/middleware";

export const CALENDAR_AUD = "tool:calendar";
export const CALENDAR_READ = "calendar:read";
export const CALENDAR_WRITE = "calendar:write";

export function calendarGuard(issuerUrl: string): KeyringHttpOptions {
  return {
    issuerUrl,
    audience: CALENDAR_AUD,
    requiredScope: (req) => (req.method === "POST" ? CALENDAR_WRITE : CALENDAR_READ),
    action: (req) => (req.method === "POST" ? "calendar.write" : "calendar.read"),
    cost: 1,
  };
}

/** Express routes. GET requires calendar:read. POST requires calendar:write. */
export function createExpressApp(issuerUrl: string): Express {
  const app = express();
  const protect = keyring(calendarGuard(issuerUrl));
  const guard: RequestHandler = (req, res, next) => {
    protect(req as RequestLike, res as ConnectResponse, next);
  };

  app.get("/events", guard, (req, res) => {
    const claims = (req as RequestLike).keyring;
    res.json({
      ok: true,
      framework: "express",
      sub: claims?.sub,
      events: [{ id: "evt_1", title: "Standup" }],
    });
  });

  app.post("/events", guard, (req, res) => {
    const claims = (req as RequestLike).keyring;
    res.status(201).json({
      ok: true,
      framework: "express",
      written: true,
      sub: claims?.sub,
    });
  });

  return app;
}

/** Fastify routes with the same audience and scope rules. */
export function createFastifyApp(issuerUrl: string): FastifyInstance {
  const app = Fastify({ logger: false });
  const protect = keyringFastify(calendarGuard(issuerUrl));
  app.addHook("preHandler", async (request, reply) => {
    await protect(request as unknown as RequestLike, reply as unknown as ReplyLike);
  });

  app.get("/events", async (request) => {
    const claims = (request as unknown as RequestLike).keyring;
    return {
      ok: true,
      framework: "fastify",
      sub: claims?.sub,
      events: [{ id: "evt_1", title: "Standup" }],
    };
  });

  app.post("/events", async (request, reply) => {
    const claims = (request as unknown as RequestLike).keyring;
    reply.code(201);
    return {
      ok: true,
      framework: "fastify",
      written: true,
      sub: claims?.sub,
    };
  });

  return app;
}
