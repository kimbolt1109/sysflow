import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import { createApp } from "@/app";
import { loadConfig } from "@/config";

describe("app", () => {
  let app: Express;

  beforeEach(() => {
    const config = loadConfig({ APP_PORT: "0", APP_LOG_LEVEL: "error" });
    app = createApp(config).app;
  });

  it("reports ok on the health endpoint", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("creates, lists, and fetches an item (happy path)", async () => {
    const created = await request(app)
      .post("/items")
      .send({ name: "widget", price: 9.5 })
      .set("content-type", "application/json");

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "widget", price: 9.5 });
    expect(typeof created.body.id).toBe("string");

    const listed = await request(app).get("/items");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([created.body]);

    const fetched = await request(app).get(`/items/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
  });

  it("returns 404 for a missing item", async () => {
    const res = await request(app).get("/items/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "item does-not-exist not found" });
  });

  it("returns 422 for an invalid item body", async () => {
    const res = await request(app)
      .post("/items")
      .send({ name: "", price: 1 })
      .set("content-type", "application/json");

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "name must be a non-empty string" });
  });

  it("returns 404 for an unknown route", async () => {
    const res = await request(app).get("/nope");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "route not found" });
  });
});
