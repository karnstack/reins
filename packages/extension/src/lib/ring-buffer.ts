/** Generic FIFO ring buffer that drops the oldest items when capacity is exceeded. */
export class RingBuffer<T> {
  readonly #capacity: number;
  #items: T[] = [];

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("capacity must be a positive integer");
    }
    this.#capacity = capacity;
  }

  push(item: T): void {
    this.#items.push(item);
    if (this.#items.length > this.#capacity) this.#items.shift();
  }

  toArray(): T[] {
    return [...this.#items];
  }

  clear(): void {
    this.#items = [];
  }

  get size(): number {
    return this.#items.length;
  }
}
