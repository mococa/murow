import { BinaryCodec, Schema } from "../binary-codec";

/**
 * Generic object pool for reusing objects and minimizing allocations.
 * @template T Type of objects stored in the pool.
 */
export class ObjectPool<T> {
  private pool: T[] = [];

  /**
   * @param factory Function to create a new instance when the pool is empty.
   */
  constructor(private factory: () => T) { }

  /**
   * Acquire an object from the pool, or create a new one if empty.
   * @returns {T} The acquired object.
   */
  acquire(): T {
    return this.pool.pop() ?? this.factory();
  }

  /**
   * Return an object to the pool for reuse.
   * @param {T} obj Object to release.
   */
  release(obj: T) {
    this.pool.push(obj);
  }

  /**
   * Return multiple objects to the pool at once.
   * @param {T[]} objs Array of objects to release.
   */
  releaseAll(objs: T[]) {
    this.pool.push(...objs);
  }
}

/**
 * Pooled decoder for single objects or nested schemas.
 * @template T Type of object to decode.
 */
export class PooledDecoder<T extends object> {
  private pool: ObjectPool<T>;

  /**
   * @param schema Schema or record describing the object structure.
   * @param initial Initial object used as template for pooling.
   */
  constructor(private schema: Schema<T> | Record<string, any>) {
    this.pool = new ObjectPool(() => this.createNil());
  }

  private createNil(): T {
    const obj = {} as T;
    for (const key of Object.keys(this.schema) as (keyof T)[]) {
      const field = (this.schema as any)[key];
      obj[key] = "toNil" in field ? field.toNil() : undefined;
    }
    return obj;
  }

  /**
   * Decode a buffer into a pooled object.
   * @param {Uint8Array} buf Buffer to decode.
   * @returns {T} Decoded object.
   */
  decode(buf: Uint8Array): T {
    const obj = this.pool.acquire();
    this.decodeInto(buf, obj);
    return obj;
  }

  /**
   * Decode a buffer into a provided target object.
   * @param {Uint8Array} buf Buffer to decode.
   * @param {T} target Object to write decoded data into.
   */
  decodeInto(buf: Uint8Array, target: T) {
    for (const key of Object.keys(this.schema) as (keyof T)[]) {
      const field = (this.schema as any)[key];
      if ("decodeAll" in field) {
        target[key] = field.decodeAll(buf);
      } else if ("decode" in field) {
        target[key] = field.decode(buf);
      } else {
        BinaryCodec.decodeInto({ [key]: field } as Schema<T>, buf, target);
      }
    }
  }

  /**
   * Release a decoded object back to the pool.
   * @param {T} obj Object to release.
   */
  release(obj: T) {
    this.pool.release(obj);
  }
}

/**
 * Pooled decoder for arrays of objects.
 * @template T Type of object to decode.
 */
export class PooledArrayDecoder<T extends object> {
  private pooledDecoder: PooledDecoder<T>;

  /**
   * @param schema Schema or record describing object structure.
   * @param initial Initial object used as template for pooling.
   */
  constructor(schema: Schema<T> | Record<string, any>) {
    this.pooledDecoder = new PooledDecoder(schema);
  }

  /**
   * Decode multiple buffers into pooled objects.
   * @param {Uint8Array[]} buffers Array of buffers to decode.
   * @returns {T[]} Array of decoded objects.
   */
  decodeAll(buffers: Uint8Array[]): T[] {
    return buffers.map((b) => this.pooledDecoder.decode(b));
  }

  /**
   * Release multiple decoded objects back to the pool.
   * @param {T[]} objs Array of objects to release.
   */
  releaseAll(objs: T[]) {
    objs.forEach((o) => this.pooledDecoder.release(o));
  }
}

/**
 * Pooled encoder for single objects or nested schemas.
 * @template T Type of object to encode.
 */
export class PooledEncoder<T extends object> {
  private pool: ObjectPool<Uint8Array>;

  /**
   * @param schema Schema or record describing object structure.
   * @param bufferSize Size of buffer to allocate per encoding (default: 1024).
   */
  constructor(private schema: Schema<T> | Record<string, any>, private bufferSize = 1024) {
    this.pool = new ObjectPool(() => new Uint8Array(bufferSize));
  }

  /**
   * Encode an object into a pooled buffer.
   * @param {T} obj Object to encode.
   * @returns {Uint8Array} Encoded buffer.
   */
  encode(obj: T): Uint8Array {
    const buf = this.pool.acquire();
    let offset = 0;

    for (const key of Object.keys(this.schema) as (keyof T)[]) {
      const field = (this.schema as any)[key];

      if ("encode" in field) {
        const nested = field.encode(obj[key]);
        buf.set(nested, offset);
        offset += nested.length;
      } else if ("encodeAll" in field) {
        const nestedArr = field.encodeAll(obj[key]);
        let arrOffset = 0;
        for (const item of nestedArr) {
          buf.set(item, offset + arrOffset);
          arrOffset += item.length;
        }
        offset += arrOffset;
      } else {
        const tmp = BinaryCodec.encode({ [key]: field }, { [key]: obj[key] });
        buf.set(tmp, offset);
        offset += tmp.length;
      }
    }

    return buf.subarray(0, offset);
  }

  /**
   * Release a buffer back to the pool.
   * @param {Uint8Array} buf Buffer to release.
   */
  release(buf: Uint8Array) {
    this.pool.release(buf);
  }
}

/**
 * Combined pooled encoder and decoder for a single schema.
 * Provides a convenient wrapper around PooledEncoder and PooledDecoder.
 * @template T Type of object to encode/decode.
 */
export class PooledCodec<T extends object> {
  /** Pooled encoder for the schema */
  encoder: PooledEncoder<T>;

  /** Pooled decoder for the schema */
  decoder: PooledDecoder<T>;

  /**
   * @param schema Schema describing the object structure.
   * @param initial Initial object used as a template for pooling decoded objects.
   */
  constructor(schema: Schema<T>) {
    this.encoder = new PooledEncoder(schema);
    this.decoder = new PooledDecoder(schema);
  }

  /**
   * Encode an object into a pooled buffer.
   * @param {T} data Object to encode.
   * @returns {Uint8Array} Encoded buffer.
   */
  encode(data: T) {
    return this.encoder.encode(data);
  }

  /**
   * Decode a buffer into a pooled object.
   * @param {Uint8Array} buf Buffer to decode.
   * @returns {T} Decoded object.
   */
  decode(buf: Uint8Array) {
    return this.decoder.decode(buf);
  }

  /**
   * Release a decoded object back to the pool.
   * @param {T} obj Object to release.
   */
  release(obj: T) {
    this.decoder.release(obj);
  }
}
