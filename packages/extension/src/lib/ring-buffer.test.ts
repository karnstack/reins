import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer.js";

describe("RingBuffer", () => {
  it("throws when capacity is 0", () => {
    expect(() => new RingBuffer(0)).toThrow("capacity must be a positive integer");
  });

  it("throws when capacity is negative", () => {
    expect(() => new RingBuffer(-1)).toThrow("capacity must be a positive integer");
  });

  it("throws when capacity is not a positive integer (NaN, fractional)", () => {
    expect(() => new RingBuffer(Number.NaN)).toThrow("capacity must be a positive integer");
    expect(() => new RingBuffer(0.5)).toThrow("capacity must be a positive integer");
  });

  it("size starts at 0", () => {
    expect(new RingBuffer<number>(5).size).toBe(0);
  });

  it("push within capacity keeps all items in insertion order", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
    expect(buf.size).toBe(3);
  });

  it("pushing beyond capacity drops the oldest items", () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) buf.push(i);
    expect(buf.toArray()).toEqual([3, 4, 5]);
    expect(buf.size).toBe(3);
  });

  it("capacity=1 always retains only the last item", () => {
    const buf = new RingBuffer<string>(1);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    expect(buf.toArray()).toEqual(["c"]);
    expect(buf.size).toBe(1);
  });

  it("toArray returns a copy — mutating it does not affect the buffer", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    const copy = buf.toArray();
    copy.push(99);
    expect(buf.toArray()).toEqual([1, 2]);
    expect(buf.size).toBe(2);
  });

  it("clear empties the buffer and resets size", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.toArray()).toEqual([]);
    expect(buf.size).toBe(0);
  });

  it("can push again after clear", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    buf.push(42);
    expect(buf.toArray()).toEqual([42]);
    expect(buf.size).toBe(1);
  });

  it("works with object items", () => {
    type Item = { id: number; val: string };
    const buf = new RingBuffer<Item>(2);
    buf.push({ id: 1, val: "a" });
    buf.push({ id: 2, val: "b" });
    buf.push({ id: 3, val: "c" });
    expect(buf.toArray()).toEqual([
      { id: 2, val: "b" },
      { id: 3, val: "c" },
    ]);
  });
});
