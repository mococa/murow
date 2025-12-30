import { Component } from "./component";
import { ComponentStore } from "./component-store";

/**
 * Configuration for creating a World
 */
export interface WorldConfig {
  /** Maximum number of entities that can exist simultaneously */
  maxEntities?: number;

  /** Component types to register */
  components: Component<any>[];
}

/**
 * Entity ID type (just a number, indexing into component arrays)
 */
export type Entity = number;

/**
 * World manages entities and their components.
 * Provides efficient ECS storage using typed arrays.
 *
 * Performance optimizations:
 * - Array iteration instead of Set for 2-5x faster queries
 * - Query bitmask caching for repeated queries
 * - Array-indexed component stores for O(1) access
 * - Pre-allocated ring buffer for entity ID reuse
 *
 * @example
 * ```typescript
 * const world = new World({
 *   maxEntities: 10000,
 *   components: [Transform, Health, Velocity]
 * });
 *
 * const entity = world.spawn();
 * world.add(entity, Transform, { x: 100, y: 200, rotation: 0 });
 * world.add(entity, Health, { current: 100, max: 100 });
 *
 * // Query entities
 * for (const entity of world.query(Transform, Velocity)) {
 *   const transform = world.get(entity, Transform);
 *   const velocity = world.get(entity, Velocity);
 *   // transform is readonly, use update() to modify
 *   world.update(entity, Transform, {
 *     x: transform.x + velocity.vx,
 *     y: transform.y + velocity.vy
 *   });
 * }
 * ```
 */
export class World {
  private maxEntities: number;
  private nextEntityId: number = 0;

  // Entity ID reuse (ring buffer for O(1) push/pop)
  private freeEntityIds: Uint32Array;
  private freeEntityHead: number = 0;
  private freeEntityTail: number = 0;
  private freeEntityCount: number = 0;
  private freeEntityMask: number = 0; // Bitwise AND mask for power-of-2 modulo

  // Entity storage: Array for fast iteration, bitmask for O(1) alive checks
  private aliveEntitiesArray: Entity[] = [];
  private aliveEntitiesIndices: Uint32Array; // Index lookup for O(1) despawn
  private aliveEntityFlags: Uint8Array; // 1 byte per entity for alive check

  // Component system (array-indexed for O(1) access)
  private componentStoresArray: (ComponentStore<any> | undefined)[];
  private componentMasks: Uint32Array;

  // Component registry (Map only for initial lookup)
  private componentMap: Map<Component<any>, number> = new Map();
  private components: Component<any>[] = [];

  // Query result cache (reusable buffers for zero allocations)
  private queryResultBuffers: Map<number, Entity[]> = new Map();

  // Debug ID
  private worldId = Math.random().toString(36).slice(2, 9);

  constructor(config: WorldConfig) {
    this.maxEntities = config.maxEntities ?? 10000;
    this.componentMasks = new Uint32Array(this.maxEntities);

    // Round up to next power of 2 for ring buffer (enables bitwise modulo)
    const ringBufferSize = Math.pow(2, Math.ceil(Math.log2(this.maxEntities)));
    this.freeEntityIds = new Uint32Array(ringBufferSize);
    this.freeEntityMask = ringBufferSize - 1; // For x % size → x & mask

    // Pre-allocate index lookup for O(1) despawn
    this.aliveEntitiesIndices = new Uint32Array(this.maxEntities);

    // Pre-allocate alive flags for O(1) alive checks
    this.aliveEntityFlags = new Uint8Array(this.maxEntities);

    // Pre-allocate arrays for all possible components (max 32)
    this.componentStoresArray = new Array(32);

    // Register components
    config.components.forEach((component, index) => {
      if (index >= 32) {
        throw new Error("Maximum 32 components supported (limited by 32-bit bitmask)");
      }

      this.components.push(component);
      this.componentMap.set(component, index);

      // Create component store with typed arrays
      const store = new ComponentStore(component, this.maxEntities);
      this.componentStoresArray[index] = store;
    });
  }

  /**
   * Get component index (with caching via Map)
   */
  private getComponentIndex(component: Component<any>): number {
    const index = this.componentMap.get(component);
    if (index === undefined) {
      const registered = this.components.map((c) => c.name).join(", ");
      throw new Error(
        `Component ${component.name} not registered in World[${this.worldId}]. ` +
        `Registered components: [${registered}]. ` +
        `Did you forget to include it in the WorldConfig?`
      );
    }
    return index;
  }

  /**
   * Get or compute query bitmask (optimized - computes mask without caching)
   */
  private getQueryMask(components: Component<any>[]): number {
    let requiredMask = 0;
    for (const component of components) {
      const index = this.componentMap.get(component);
      if (index === undefined) return -1; // Invalid mask sentinel
      requiredMask |= 1 << index;
    }
    return requiredMask;
  }

  /**
   * Spawn a new entity.
   * Returns the entity ID.
   */
  spawn(): Entity {
    // Hot path: allocate new ID (most common case, no branching)
    let id = this.nextEntityId;

    // Cold path: reuse freed ID if available
    if (this.freeEntityCount > 0) {
      id = this.freeEntityIds[this.freeEntityTail];
      this.freeEntityTail = (this.freeEntityTail + 1) & this.freeEntityMask;
      this.freeEntityCount--;
    } else {
      this.nextEntityId++;
    }

    // Bounds check (unlikely to fail in normal operation)
    if (id >= this.maxEntities) {
      throw new Error(
        `Maximum entities (${this.maxEntities}) reached. ` +
        `Current alive: ${this.aliveEntitiesArray.length}, ` +
        `Free list: ${this.freeEntityCount}`
      );
    }

    // Fast path: setup entity (no branches)
    this.aliveEntityFlags[id] = 1;
    this.aliveEntitiesIndices[id] = this.aliveEntitiesArray.length;
    this.aliveEntitiesArray.push(id);
    this.componentMasks[id] = 0;

    return id;
  }

  /**
   * Despawn an entity, removing all its components.
   * The entity ID will be reused.
   */
  despawn(entity: Entity): void {
    if (this.aliveEntityFlags[entity] === 0) {
      return; // Already despawned
    }

    this.aliveEntityFlags[entity] = 0;

    // Remove from array (swap with last for O(1) removal)
    const idx = this.aliveEntitiesIndices[entity];
    const last = this.aliveEntitiesArray.length - 1;

    if (idx !== last) {
      // Swap with last element
      const lastEntity = this.aliveEntitiesArray[last];
      this.aliveEntitiesArray[idx] = lastEntity;
      this.aliveEntitiesIndices[lastEntity] = idx;
    }

    this.aliveEntitiesArray.pop();

    // Clear all components for this entity
    const mask = this.componentMasks[entity];
    for (let i = 0; i < this.components.length; i++) {
      if (mask & (1 << i)) {
        this.componentStoresArray[i]!.clear(entity);
      }
    }

    this.componentMasks[entity] = 0;

    // Push to free list
    this.freeEntityIds[this.freeEntityHead] = entity;
    this.freeEntityHead = (this.freeEntityHead + 1) & this.freeEntityMask; // Bitwise AND instead of modulo
    this.freeEntityCount++;
  }

  /**
   * Check if an entity is alive
   */
  isAlive(entity: Entity): boolean {
    return this.aliveEntityFlags[entity] === 1;
  }

  /**
   * Add a component to an entity with initial data.
   */
  add<T extends object>(entity: Entity, component: Component<T>, data: T): void {
    if (this.aliveEntityFlags[entity] === 0) {
      throw new Error(
        `Cannot add component ${component.name} to entity ${entity}: ` +
        `entity is not alive (was it despawned?). ` +
        `Current alive entities: ${this.aliveEntitiesArray.length}`
      );
    }

    const index = this.getComponentIndex(component);
    const store = this.componentStoresArray[index]!;

    this.componentMasks[entity] |= 1 << index;
    store.set(entity, data);
  }

  /**
   * Remove a component from an entity.
   */
  remove<T extends object>(entity: Entity, component: Component<T>): void {
    const index = this.componentMap.get(component);
    if (index === undefined) return;

    this.componentMasks[entity] &= ~(1 << index);

    const store = this.componentStoresArray[index];
    if (store) {
      store.clear(entity);
    }
  }

  /**
   * Check if an entity has a component.
   */
  has<T extends object>(entity: Entity, component: Component<T>): boolean {
    const index = this.componentMap.get(component);
    if (index === undefined) return false;

    return (this.componentMasks[entity] & (1 << index)) !== 0;
  }

  /**
   * Get a component's data for an entity.
   * Returns a READONLY reusable object (zero allocations).
   *
   * ⚠️ IMPORTANT: The returned object is reused and will be overwritten on the next get().
   * To modify, use set() or update() instead.
   * To keep multiple components, use getMutable() or spread operator.
   *
   * @example
   * // ✅ CORRECT: Use immediately
   * const t = world.get(entity, Transform);
   * console.log(t.x, t.y);
   *
   * // ❌ WRONG: Storing reference
   * const t1 = world.get(entity1, Transform);
   * const t2 = world.get(entity2, Transform); // t1 is now corrupted!
   *
   * // ✅ CORRECT: Copy if you need to keep
   * const t1 = { ...world.get(entity1, Transform) };
   * const t2 = { ...world.get(entity2, Transform) };
   */
  get<T extends object>(entity: Entity, component: Component<T>): Readonly<T> {
    const index = this.getComponentIndex(component);

    if ((this.componentMasks[entity] & (1 << index)) === 0) {
      const entityComponents = this.getEntityComponentNames(entity);
      throw new Error(
        `Cannot get component ${component.name} from entity ${entity}: ` +
        `entity does not have this component. ` +
        `Entity has: [${entityComponents.join(", ")}]. ` +
        `Did you forget to call world.add()?`
      );
    }

    return this.componentStoresArray[index]!.get(entity);
  }

  /**
   * Get a mutable copy of component data.
   * Use this when you need to modify and keep the data.
   *
   * Note: This allocates a new object. Use sparingly in hot paths.
   */
  getMutable<T extends object>(entity: Entity, component: Component<T>): T {
    const index = this.getComponentIndex(component);

    if ((this.componentMasks[entity] & (1 << index)) === 0) {
      throw new Error(`Entity ${entity} does not have component ${component.name}`);
    }

    return this.componentStoresArray[index]!.getMutable(entity);
  }

  /**
   * Set a component's data for an entity.
   * Overwrites all fields.
   */
  set<T extends object>(entity: Entity, component: Component<T>, data: T): void {
    const index = this.getComponentIndex(component);

    if ((this.componentMasks[entity] & (1 << index)) === 0) {
      throw new Error(
        `Cannot set component ${component.name} on entity ${entity}: ` +
        `entity does not have this component. Use add() first.`
      );
    }

    this.componentStoresArray[index]!.set(entity, data);
  }

  /**
   * Update specific fields of a component.
   * More efficient than get + modify + set.
   *
   * @example
   * // ✅ GOOD: Partial update
   * world.update(entity, Transform, { x: 150 });
   *
   * // ❌ BAD: Full get/set for single field
   * const t = world.getMutable(entity, Transform);
   * t.x = 150;
   * world.set(entity, Transform, t);
   */
  update<T extends object>(entity: Entity, component: Component<T>, partial: Partial<T>): void {
    const index = this.getComponentIndex(component);

    if ((this.componentMasks[entity] & (1 << index)) === 0) {
      throw new Error(`Entity ${entity} does not have component ${component.name}`);
    }

    this.componentStoresArray[index]!.update(entity, partial);
  }

  /**
   * Query entities that have all specified components.
   * Returns a readonly array for zero-allocation iteration.
   *
   * Uses reusable buffers and direct bitmask checks for maximum performance.
   * The returned array is reused on subsequent queries with the same mask.
   *
   * @example
   * ```typescript
   * for (const entity of world.query(Transform, Velocity)) {
   *   const t = world.get(entity, Transform);
   *   const v = world.get(entity, Velocity);
   *   world.update(entity, Transform, {
   *     x: t.x + v.vx * dt,
   *     y: t.y + v.vy * dt
   *   });
   * }
   * ```
   */
  query(...components: Component<any>[]): readonly Entity[] {
    const requiredMask = this.getQueryMask(components);
    if (requiredMask === -1) return []; // Component not registered

    // Get or create reusable buffer for this query mask
    let buffer = this.queryResultBuffers.get(requiredMask);
    if (!buffer) {
      buffer = [];
      this.queryResultBuffers.set(requiredMask, buffer);
    }

    // Fast array iteration with direct bitmask access
    const entities = this.aliveEntitiesArray;
    const masks = this.componentMasks;
    const length = entities.length;

    // Use write cursor pattern instead of buffer.length = 0 + push
    let writeIdx = 0;

    // Unrolled loop for better performance (8x unrolling)
    let i = 0;
    const remainder = length % 8;

    // Process 8 entities at a time
    for (; i < length - remainder; i += 8) {
      const e0 = entities[i];
      const e1 = entities[i + 1];
      const e2 = entities[i + 2];
      const e3 = entities[i + 3];
      const e4 = entities[i + 4];
      const e5 = entities[i + 5];
      const e6 = entities[i + 6];
      const e7 = entities[i + 7];

      if ((masks[e0] & requiredMask) === requiredMask) buffer[writeIdx++] = e0;
      if ((masks[e1] & requiredMask) === requiredMask) buffer[writeIdx++] = e1;
      if ((masks[e2] & requiredMask) === requiredMask) buffer[writeIdx++] = e2;
      if ((masks[e3] & requiredMask) === requiredMask) buffer[writeIdx++] = e3;
      if ((masks[e4] & requiredMask) === requiredMask) buffer[writeIdx++] = e4;
      if ((masks[e5] & requiredMask) === requiredMask) buffer[writeIdx++] = e5;
      if ((masks[e6] & requiredMask) === requiredMask) buffer[writeIdx++] = e6;
      if ((masks[e7] & requiredMask) === requiredMask) buffer[writeIdx++] = e7;
    }

    // Process remaining entities
    for (; i < length; i++) {
      const entity = entities[i];
      if ((masks[entity] & requiredMask) === requiredMask) {
        buffer[writeIdx++] = entity;
      }
    }

    // Truncate buffer to actual size
    buffer.length = writeIdx;

    return buffer;
  }

  /**
   * Get all alive entity IDs.
   *
   * ⚠️ WARNING: The returned array is a direct reference and should not be modified.
   * For a safe copy, use [...world.getEntities()].
   */
  getEntities(): readonly Entity[] {
    return this.aliveEntitiesArray;
  }

  /**
   * Get the number of alive entities.
   */
  getEntityCount(): number {
    return this.aliveEntitiesArray.length;
  }

  /**
   * Get the maximum number of entities.
   */
  getMaxEntities(): number {
    return this.maxEntities;
  }

  /**
   * Get all registered components.
   */
  getComponents(): readonly Component<any>[] {
    return this.components;
  }

  /**
   * Get component names for an entity (for debugging)
   */
  private getEntityComponentNames(entity: Entity): string[] {
    const mask = this.componentMasks[entity];
    const result: string[] = [];

    for (let i = 0; i < this.components.length; i++) {
      if (mask & (1 << i)) {
        result.push(this.components[i].name);
      }
    }

    return result;
  }

  /**
   * Serialize entities with specific components to binary.
   * Uses PooledCodec internally for efficient encoding.
   *
   * @param components Components to include in the snapshot
   * @param entities Optional list of entities to serialize (defaults to all)
   * @returns Binary buffer with serialized data
   */
  serialize(components: Component<any>[], entities?: Entity[]): Uint8Array {
    const entityList = entities ?? Array.from(this.aliveEntitiesArray);

    // Build data structure for each component
    const componentArrays: any[] = [];

    for (const component of components) {
      const index = this.componentMap.get(component);
      if (index === undefined) continue;

      const store = this.componentStoresArray[index];
      if (!store) continue;

      const items: any[] = [];

      for (const entity of entityList) {
        if (this.has(entity, component)) {
          items.push({
            entity,
            ...store.getMutable(entity),
          });
        }
      }

      if (items.length > 0) {
        // Use the component's arrayCodec (PooledCodec.array) to encode
        const encoded = component.arrayCodec.encode(items);
        componentArrays.push(encoded);
      }
    }

    // Combine all buffers
    // TODO: Could optimize this with a proper multi-buffer format
    const totalSize = componentArrays.reduce((sum, buf) => sum + buf.length, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const buf of componentArrays) {
      result.set(buf, offset);
      offset += buf.length;
    }

    return result;
  }

  /**
   * Deserialize binary data into entities.
   * Uses PooledCodec internally for efficient decoding.
   *
   * Note: This is a basic implementation. For production use,
   * you'd want a more sophisticated format with component IDs, etc.
   */
  deserialize(components: Component<any>[], buffer: Uint8Array): void {
    // TODO: Implement proper deserialization with component IDs
    // For now, this is a placeholder
    throw new Error("Deserialization not yet implemented");
  }
}
