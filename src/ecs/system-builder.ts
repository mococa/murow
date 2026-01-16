import { Component } from "./component";
import { Entity, World } from "./world";

/**
 * Extract component data type from Component<T>
 */
type InferComponentData<C> = C extends Component<infer T> ? T : never;

/**
 * Extract the alias (key) and fields from a field mapping object.
 * { transform2d: ['x', 'y'] } => { alias: 'transform2d', fields: ['x', 'y'] }
 */
type ExtractFieldMapping<T> = T extends Record<string, readonly any[]>
  ? {
      [K in keyof T]: {
        alias: K;
        fields: T[K];
      }
    }[keyof T]
  : never;

/**
 * Build flattened entity proxy from components and field mappings.
 * Maps fields directly as alias_field (e.g., transform_x, velocity_vx)
 * This eliminates one property lookup for maximum performance.
 */
export type BuildEntityProxy<
  Components extends readonly Component<any>[],
  FieldMappings extends readonly any[]
> = {
  eid: number;
} & UnionToIntersection<{
  [Index in keyof FieldMappings]: Index extends keyof Components
    ? Components[Index] extends Component<any>
      ? ExtractFieldMapping<FieldMappings[Index]>["fields"] extends readonly (keyof InferComponentData<Components[Index]>)[]
        ? {
            [F in ExtractFieldMapping<FieldMappings[Index]>["fields"][number] as `${ExtractFieldMapping<FieldMappings[Index]>["alias"] & string}_${F & string}`]: F extends keyof InferComponentData<Components[Index]>
              ? InferComponentData<Components[Index]>[F]
              : never
          }
        : never
      : never
    : never
}[keyof FieldMappings]>;

// Helper type to convert union to intersection
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/**
 * Builder for creating ergonomic systems with automatic field array caching.
 *
 * Fully chainable API with type safety:
 * - User writes ergonomic code with entity.component.field syntax
 * - System automatically caches TypedArrays and creates proxies
 * - Runtime performance matches direct array access
 * - Full type safety with IntelliSense support
 *
 * **Recommended pattern for full type safety:**
 * ```typescript
 * world.addSystem()
 *   .with(Transform2D, Velocity)
 *   .fields([{ transform2d: ['x', 'y'] }, { velocity: ['vx', 'vy'] }])
 *   .run((entity, deltaTime) => {
 *     // entity.transform2d and entity.velocity are fully typed!
 *     entity.transform2d.x += entity.velocity.vx * deltaTime;
 *   });
 * ```
 *
 * **Note:** If you provide the callback first (before fields), the entity parameter
 * will be typed as `any` due to TypeScript limitations. Use `.with().fields().run()`
 * for full type safety.
 */
export class SystemBuilder<
  C extends Component<any>[] = Component<any>[],
  FM extends any[] | undefined = undefined,
  CB extends boolean = false
> {
  constructor(
    private world: World,
    private components: C,
    private fieldMappings?: FM,
    private userCallback?: (entity: any, deltaTime: number, world: World) => void
  ) {}

  /**
   * Specify which components this system should query for.
   */
  query<NewC extends Component<any>[]>(
    ...components: NewC
  ): SystemBuilder<NewC, FM, CB> {
    return new SystemBuilder(this.world, components, this.fieldMappings, this.userCallback);
  }

  /**
   * Specify which component fields should be accessible via proxy.
   */
  fields<
    const NewFM extends {
      [K in keyof C]: C[K] extends Component<infer T>
        ? Record<string, readonly (keyof T)[]>
        : never
    }
  >(
    fieldMappings: NewFM
  ): SystemBuilder<C, NewFM, CB> {
    return new SystemBuilder(this.world, this.components, fieldMappings as any, this.userCallback);
  }

  /**
   * Set the system callback. If components and fields are set, builds the system.
   */
  run(
    callback: FM extends undefined
      ? (entity: any, deltaTime: number, world: World) => void
      : (entity: BuildEntityProxy<C, FM>, deltaTime: number, world: World) => void
  ): ExecutableSystem {
    const builder = new SystemBuilder(
      this.world,
      this.components,
      this.fieldMappings,
      callback as any
    );

    return builder.buildAndRegister();
  }

  /**
   * Build and register the system.
   * @internal
   */
  buildAndRegister(): ExecutableSystem {
    if (!this.userCallback) {
      throw new Error('System callback must be set');
    }
    if (!this.fieldMappings) {
      throw new Error('Field mappings must be set');
    }

    const world = this.world;
    const components = this.components;
    const fieldMappings = this.fieldMappings;
    const userCallback = this.userCallback;

    // Cache field arrays once at system creation
    const fieldArrayCache: Record<string, Record<string, any>> = {};
    const componentByAlias: Record<string, Component<any>> = {};

    // Iterate over components and their field mappings
    for (let i = 0; i < components.length; i++) {
      const component = components[i]!;
      const mapping = fieldMappings[i];

      if (!mapping) continue;

      // Extract alias and fields from { alias: ['fields'] } object
      const alias = Object.keys(mapping)[0]!;
      const fields = mapping[alias];

      componentByAlias[alias] = component;
      fieldArrayCache[alias] = {};

      // Cache all field arrays for this component
      for (const fieldName of fields) {
        const array = (world as any).getFieldArray(component, fieldName);
        fieldArrayCache[alias][fieldName as string] = array;
      }
    }

    // Create the executable system
    const system = new ExecutableSystem(
      world,
      components,
      userCallback,
      fieldArrayCache,
      componentByAlias
    );

    // Register with world
    world._registerSystem(system);

    return system;
  }
}

/**
 * Executable system that can be run with world.runSystems().
 *
 * Contains cached field arrays and generates proxy entities for ergonomic access.
 */
export class ExecutableSystem {
  private proxyEntity: any;
  // Mutable box for currentEid - allows monomorphic inline caching
  private eidBox = { value: 0 };

  constructor(
    private world: World,
    private components: Component<any>[],
    private userCallback: (entity: any, deltaTime: number, world: World) => void,
    private fieldArrayCache: Record<string, Record<string, any>>,
    private componentByAlias: Record<string, Component<any>>
  ) {
    // Create proxy once and reuse it - major performance win
    this.proxyEntity = this.createProxyEntity();
  }

  /**
   * Execute the system for all matching entities.
   * Optimized to reuse proxy entity and minimize allocations.
   *
   * @param deltaTime - Time delta to pass to system callback
   */
  execute(deltaTime: number): void {
    const entities = this.world.query(...this.components);
    const proxyEntity = this.proxyEntity;
    const callback = this.userCallback;
    const world = this.world;
    const eidBox = this.eidBox;

    // Hoist array length lookup for better JIT optimization
    const length = entities.length;
    for (let i = 0; i < length; i++) {
      eidBox.value = entities[i]!;
      callback(proxyEntity, deltaTime, world);
    }
  }

  /**
   * Create a proxy entity with FLATTENED properties for maximum performance.
   * Instead of entity.transform.x, use entity.transform_x (one lookup instead of two).
   * @private
   */
  private createProxyEntity(): any {
    const eidBox = this.eidBox;
    const entity: any = {};

    // Add eid property
    Object.defineProperty(entity, 'eid', {
      get() { return eidBox.value; },
      enumerable: true,
      configurable: false
    });

    // Define FLATTENED field getters directly on entity (alias_field pattern)
    for (const [alias, fields] of Object.entries(this.fieldArrayCache)) {
      for (const [fieldName, array] of Object.entries(fields)) {
        const flattenedName = `${alias}_${fieldName}`;

        // Single property lookup: entity.transform_x instead of entity.transform.x
        Object.defineProperty(entity, flattenedName, {
          get() { return array[eidBox.value]; },
          set(value: any) { array[eidBox.value] = value; },
          enumerable: true,
          configurable: false
        });
      }
    }

    // Seal to lock shape for inline caching
    Object.seal(entity);

    return entity;
  }

  /**
   * Get the components this system operates on.
   */
  getComponents(): Component<any>[] {
    return this.components;
  }
}
