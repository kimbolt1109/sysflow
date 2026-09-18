import { randomUUID } from "node:crypto";
import type { Item, ItemCreate, ItemsRepo } from "@/domain/items";

export class InMemoryItemsRepo implements ItemsRepo {
  private readonly items = new Map<string, Item>();

  async list(): Promise<Item[]> {
    return [...this.items.values()];
  }

  async get(id: string): Promise<Item | undefined> {
    return this.items.get(id);
  }

  async create(input: ItemCreate): Promise<Item> {
    const item: Item = { id: randomUUID(), ...input };
    this.items.set(item.id, item);
    return item;
  }
}
