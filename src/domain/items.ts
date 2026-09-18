import { NotFoundError, ValidationError } from "@/lib/errors";

export interface Item {
  id: string;
  name: string;
  price: number;
}

export interface ItemCreate {
  name: string;
  price: number;
}

export interface ItemsRepo {
  list(): Promise<Item[]>;
  get(id: string): Promise<Item | undefined>;
  create(input: ItemCreate): Promise<Item>;
}

function parseItemCreate(input: unknown): ItemCreate {
  if (typeof input !== "object" || input === null) {
    throw new ValidationError("item body must be a JSON object");
  }
  const { name, price } = input as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") {
    throw new ValidationError("name must be a non-empty string");
  }
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    throw new ValidationError("price must be a non-negative finite number");
  }
  return { name: name.trim(), price };
}

export class ItemService {
  constructor(private readonly repo: ItemsRepo) {}

  list(): Promise<Item[]> {
    return this.repo.list();
  }

  async get(id: string): Promise<Item> {
    const item = await this.repo.get(id);
    if (item === undefined) {
      throw new NotFoundError(`item ${id} not found`);
    }
    return item;
  }

  async create(input: unknown): Promise<Item> {
    return this.repo.create(parseItemCreate(input));
  }
}
