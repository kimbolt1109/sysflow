import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ItemService } from "./items";
import type { Item, ItemCreate, ItemsRepo } from "./items";

class FakeItemsRepo implements ItemsRepo {
  private readonly items = new Map<string, Item>();
  private nextId = 1;

  async list(): Promise<Item[]> {
    return [...this.items.values()];
  }

  async get(id: string): Promise<Item | undefined> {
    return this.items.get(id);
  }

  async create(input: ItemCreate): Promise<Item> {
    const item: Item = { id: String(this.nextId++), ...input };
    this.items.set(item.id, item);
    return item;
  }
}

describe("ItemService", () => {
  it("lists items previously created", async () => {
    const service = new ItemService(new FakeItemsRepo());
    await service.create({ name: "widget", price: 9.5 });
    await service.create({ name: "gadget", price: 3 });

    const items = await service.list();

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.name)).toEqual(["widget", "gadget"]);
  });

  it("returns an item by id", async () => {
    const service = new ItemService(new FakeItemsRepo());
    const created = await service.create({ name: "widget", price: 9.5 });

    const found = await service.get(created.id);

    expect(found).toEqual(created);
  });

  it("throws NotFoundError for a missing item", async () => {
    const service = new ItemService(new FakeItemsRepo());

    await expect(service.get("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates an item with a generated id and trimmed name", async () => {
    const service = new ItemService(new FakeItemsRepo());

    const created = await service.create({ name: "  widget  ", price: 1 });

    expect(created.id).not.toBe("");
    expect(created.name).toBe("widget");
    expect(created.price).toBe(1);
  });

  it("throws ValidationError when the body is not an object", async () => {
    const service = new ItemService(new FakeItemsRepo());

    await expect(service.create("not an object")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for an empty name", async () => {
    const service = new ItemService(new FakeItemsRepo());

    await expect(service.create({ name: "", price: 1 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for a negative price", async () => {
    const service = new ItemService(new FakeItemsRepo());

    await expect(service.create({ name: "widget", price: -1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
