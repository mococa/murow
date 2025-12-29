import { Component } from "./component";

/**
 * Stores component data for entities using typed arrays.
 * Provides efficient packed storage with O(1) access by entity ID.
 *
 * Key optimizations:
 * - ArrayBuffer storage (exact byte size, no waste)
 * - Single reusable DataView (no allocations)
 * - Single reusable object for get() (zero allocations)
 * - Pre-computed field offsets (no runtime calculations)
 */
export class ComponentStore<T extends object> {
  private buffer: ArrayBuffer;
  private view: DataView;
  private stride: number; // Component size in bytes
  private component: Component<T>;
  private maxEntities: number;

  // Single reusable object for get() - zero allocations!
  private reusableObject: T;

  // Pre-computed field metadata for fast access
  private fieldOffsets: number[];
  private fields: any[];
  private fieldKeys: (keyof T)[];
  private fieldIndexMap: Map<keyof T, number>; // For O(1) field lookup in update()

  constructor(component: Component<T>, maxEntities: number) {
    this.component = component;
    this.maxEntities = maxEntities;

    // Use exact byte size (no waste like Float32Array)
    this.stride = component.size;

    // Allocate exact memory needed
    this.buffer = new ArrayBuffer(maxEntities * this.stride);
    this.view = new DataView(this.buffer);

    // Pre-compute field metadata once
    this.fieldKeys = component.fieldNames;
    this.fieldOffsets = [];
    this.fields = [];
    this.fieldIndexMap = new Map();

    let offset = 0;
    for (let i = 0; i < this.fieldKeys.length; i++) {
      const key = this.fieldKeys[i];
      const field = component.schema[key];
      this.fieldOffsets.push(offset);
      this.fields.push(field);
      this.fieldIndexMap.set(key, i);
      offset += field.size;
    }

    // Create single reusable object
    this.reusableObject = {} as T;
    for (let i = 0; i < this.fieldKeys.length; i++) {
      this.reusableObject[this.fieldKeys[i]] = this.fields[i].toNil();
    }
  }

  /**
   * Get component data for an entity.
   *
   * ⚠️ IMPORTANT: Returns a REUSED object that is overwritten on the next get() call.
   * Use immediately or copy the data. For safe access, use getMutable() or copyTo().
   *
   * @example
   * // ✅ CORRECT: Use immediately
   * const t = store.get(entity);
   * console.log(t.x, t.y);
   *
   * // ❌ WRONG: Storing reference
   * const t1 = store.get(entity1);
   * const t2 = store.get(entity2); // t1 is now corrupted!
   *
   * // ✅ CORRECT: Copy if you need multiple
   * const t1 = { ...store.get(entity1) };
   * const t2 = { ...store.get(entity2) };
   */
  get(entityId: number): Readonly<T> {
    const baseOffset = entityId * this.stride;

    // Optimized loop using pre-computed offsets
    for (let i = 0; i < this.fields.length; i++) {
      this.reusableObject[this.fieldKeys[i]] = this.fields[i].read(
        this.view,
        baseOffset + this.fieldOffsets[i]
      );
    }

    return this.reusableObject as Readonly<T>;
  }

  /**
   * Get a mutable copy of component data.
   * Use this when you need to modify and keep the data.
   *
   * Note: This allocates a new object. Use sparingly in hot paths.
   */
  getMutable(entityId: number): T {
    const copy = {} as T;
    this.copyTo(entityId, copy);
    return copy;
  }

  /**
   * Copy component data into a provided object.
   * Use this when you need to keep multiple components at once.
   */
  copyTo(entityId: number, target: T): void {
    const baseOffset = entityId * this.stride;

    for (let i = 0; i < this.fields.length; i++) {
      target[this.fieldKeys[i]] = this.fields[i].read(
        this.view,
        baseOffset + this.fieldOffsets[i]
      );
    }
  }

  /**
   * Set component data for an entity.
   * Writes the data directly into the typed array.
   */
  set(entityId: number, data: T): void {
    const baseOffset = entityId * this.stride;

    for (let i = 0; i < this.fields.length; i++) {
      this.fields[i].write(
        this.view,
        baseOffset + this.fieldOffsets[i],
        data[this.fieldKeys[i]]
      );
    }
  }

  /**
   * Update specific fields of a component without reading the whole component first.
   * Optimized to only iterate over the fields being updated.
   */
  update(entityId: number, partial: Partial<T>): void {
    const baseOffset = entityId * this.stride;

    // Only iterate over fields that are being updated (faster for sparse updates)
    for (const key in partial) {
      const i = this.fieldIndexMap.get(key as keyof T)!;
      this.fields[i].write(
        this.view,
        baseOffset + this.fieldOffsets[i],
        partial[key]!
      );
    }
  }

  /**
   * Clear component data for an entity (set to default values)
   */
  clear(entityId: number): void {
    const baseOffset = entityId * this.stride;

    for (let i = 0; i < this.fields.length; i++) {
      this.fields[i].write(
        this.view,
        baseOffset + this.fieldOffsets[i],
        this.fields[i].toNil()
      );
    }
  }

  /**
   * Get direct access to the underlying buffer.
   * Advanced use only - for SIMD operations, GPU uploads, zero-copy networking, etc.
   */
  getRawBuffer(): ArrayBuffer {
    return this.buffer;
  }

  /**
   * Get the stride in bytes.
   */
  getStride(): number {
    return this.stride;
  }
}
