import { describe, it, expect, beforeEach } from "bun:test";
import { IntentRegistry } from "./intent-registry";
import { Intent } from "./intent";
import { Codec } from "./intent-registry";

// Mock intent types
interface MockIntent extends Intent {
  kind: 1;
  tick: number;
  value: number;
}

interface AnotherIntent extends Intent {
  kind: 2;
  tick: number;
  data: string;
}

// Mock codec implementation
class MockCodec implements Codec<MockIntent> {
  encode(value: MockIntent): Uint8Array {
    const buf = new Uint8Array(9);
    buf[0] = value.kind;
    new DataView(buf.buffer).setUint32(1, value.tick, true);
    new DataView(buf.buffer).setUint32(5, value.value, true);
    return buf;
  }

  decode(buf: Uint8Array): MockIntent {
    const view = new DataView(buf.buffer, buf.byteOffset);
    return {
      kind: 1,
      tick: view.getUint32(1, true),
      value: view.getUint32(5, true),
    };
  }
}

class StringCodec implements Codec<AnotherIntent> {
  encode(value: AnotherIntent): Uint8Array {
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(value.data);
    const buf = new Uint8Array(5 + dataBytes.length);
    buf[0] = value.kind;
    new DataView(buf.buffer).setUint32(1, value.tick, true);
    buf.set(dataBytes, 5);
    return buf;
  }

  decode(buf: Uint8Array): AnotherIntent {
    const view = new DataView(buf.buffer, buf.byteOffset);
    const decoder = new TextDecoder();
    return {
      kind: 2,
      tick: view.getUint32(1, true),
      data: decoder.decode(buf.slice(5)),
    };
  }
}

describe("IntentRegistry", () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
  });

  describe("register", () => {
    it("should register a codec for an intent kind", () => {
      const codec = new MockCodec();
      registry.register(1, codec);
      expect(registry.has(1)).toBe(true);
    });

    it("should throw error when registering duplicate kind", () => {
      const codec = new MockCodec();
      registry.register(1, codec);
      expect(() => registry.register(1, codec)).toThrow(
        "Intent kind 1 is already registered"
      );
    });

    it("should allow registering multiple different kinds", () => {
      registry.register(1, new MockCodec());
      registry.register(2, new StringCodec());
      expect(registry.has(1)).toBe(true);
      expect(registry.has(2)).toBe(true);
    });
  });

  describe("encode", () => {
    it("should encode an intent using registered codec", () => {
      registry.register(1, new MockCodec());
      const intent: MockIntent = { kind: 1, tick: 100, value: 42 };
      const buf = registry.encode(intent);

      expect(buf).toBeInstanceOf(Uint8Array);
      expect(buf.length).toBe(9);
      expect(buf[0]).toBe(1); // kind
    });

    it("should throw error when encoding unregistered intent kind", () => {
      const intent: MockIntent = { kind: 1, tick: 100, value: 42 };
      expect(() => registry.encode(intent)).toThrow(
        "No codec registered for intent kind 1"
      );
    });

    it("should encode different intent types correctly", () => {
      registry.register(1, new MockCodec());
      registry.register(2, new StringCodec());

      const intent1: MockIntent = { kind: 1, tick: 100, value: 42 };
      const intent2: AnotherIntent = { kind: 2, tick: 200, data: "test" };

      const buf1 = registry.encode(intent1);
      const buf2 = registry.encode(intent2);

      expect(buf1[0]).toBe(1);
      expect(buf2[0]).toBe(2);
    });
  });

  describe("decode", () => {
    it("should decode a buffer using registered codec", () => {
      registry.register(1, new MockCodec());
      const original: MockIntent = { kind: 1, tick: 100, value: 42 };
      const buf = registry.encode(original);
      const decoded = registry.decode(buf);

      expect(decoded).toEqual(original);
    });

    it("should throw error when decoding with unregistered kind", () => {
      const buf = new Uint8Array([99, 0, 0, 0, 100, 0, 0, 0, 42]); // kind=99 not registered
      expect(() => registry.decode(buf)).toThrow(
        "No codec registered for intent kind 99"
      );
    });

    it("should decode different intent types correctly", () => {
      registry.register(1, new MockCodec());
      registry.register(2, new StringCodec());

      const intent1: MockIntent = { kind: 1, tick: 100, value: 42 };
      const intent2: AnotherIntent = { kind: 2, tick: 200, data: "hello" };

      const buf1 = registry.encode(intent1);
      const buf2 = registry.encode(intent2);

      const decoded1 = registry.decode(buf1);
      const decoded2 = registry.decode(buf2);

      expect(decoded1).toEqual(intent1);
      expect(decoded2).toEqual(intent2);
    });
  });

  describe("has", () => {
    it("should return true for registered kinds", () => {
      registry.register(1, new MockCodec());
      expect(registry.has(1)).toBe(true);
    });

    it("should return false for unregistered kinds", () => {
      expect(registry.has(1)).toBe(false);
    });
  });

  describe("unregister", () => {
    it("should remove a registered codec", () => {
      registry.register(1, new MockCodec());
      expect(registry.has(1)).toBe(true);

      const removed = registry.unregister(1);
      expect(removed).toBe(true);
      expect(registry.has(1)).toBe(false);
    });

    it("should return false when unregistering non-existent kind", () => {
      const removed = registry.unregister(1);
      expect(removed).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all registered codecs", () => {
      registry.register(1, new MockCodec());
      registry.register(2, new StringCodec());

      registry.clear();

      expect(registry.has(1)).toBe(false);
      expect(registry.has(2)).toBe(false);
    });
  });

  describe("getKinds", () => {
    it("should return empty array when no codecs registered", () => {
      expect(registry.getKinds()).toEqual([]);
    });

    it("should return all registered kinds", () => {
      registry.register(1, new MockCodec());
      registry.register(2, new StringCodec());

      const kinds = registry.getKinds();
      expect(kinds).toContain(1);
      expect(kinds).toContain(2);
      expect(kinds.length).toBe(2);
    });
  });

  describe("round-trip encoding/decoding", () => {
    it("should preserve intent data through encode/decode cycle", () => {
      registry.register(1, new MockCodec());

      const original: MockIntent = { kind: 1, tick: 12345, value: 98765 };
      const buf = registry.encode(original);
      const decoded = registry.decode(buf);

      expect(decoded).toEqual(original);
    });

    it("should handle multiple round-trips", () => {
      registry.register(1, new MockCodec());

      const original: MockIntent = { kind: 1, tick: 100, value: 42 };

      for (let i = 0; i < 10; i++) {
        const buf = registry.encode(original);
        const decoded = registry.decode(buf);
        expect(decoded).toEqual(original);
      }
    });
  });
});
