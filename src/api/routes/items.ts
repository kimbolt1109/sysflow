import { Router } from "express";
import type { ItemService } from "@/domain/items";

export function itemsRouter(service: ItemService): Router {
  const router = Router();

  router.get("/items", async (_req, res) => {
    res.json(await service.list());
  });

  router.get("/items/:id", async (req, res) => {
    res.json(await service.get(req.params.id));
  });

  router.post("/items", async (req, res) => {
    res.status(201).json(await service.create(req.body));
  });

  return router;
}
