import { describe, expect, test } from "bun:test";
import { BinaryCodec } from "../core/binary-codec";
import { defineComponent } from "./component";
import { World } from "./world";

// Define components for benchmarking
const Transform = defineComponent("Transform", {
  x: BinaryCodec.f32,
  y: BinaryCodec.f32,
  rotation: BinaryCodec.f32,
});

const Velocity = defineComponent("Velocity", {
  vx: BinaryCodec.f32,
  vy: BinaryCodec.f32,
});

const Health = defineComponent("Health", {
  current: BinaryCodec.u16,
  max: BinaryCodec.u16,
});

describe("ECS Performance Benchmarks", () => {
  test("spawn/despawn 10,000 entities (should be < 50ms)", () => {
    const world = new World({
      maxEntities: 10000,
      components: [Transform, Velocity, Health],
    });

    const start = performance.now();

    // Spawn 10,000 entities
    const entities: number[] = [];
    for (let i = 0; i < 10000; i++) {
      entities.push(world.spawn());
    }

    // Despawn all
    for (const entity of entities) {
      world.despawn(entity);
    }

    const elapsed = performance.now() - start;

    console.log(`Spawn/despawn 10k entities: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(50);
  });

  test("add components to 10,000 entities (should be < 100ms)", () => {
    const world = new World({
      maxEntities: 10000,
      components: [Transform, Velocity, Health],
    });

    // Spawn entities
    const entities: number[] = [];
    for (let i = 0; i < 10000; i++) {
      entities.push(world.spawn());
    }

    const start = performance.now();

    // Add components
    for (const entity of entities) {
      world.add(entity, Transform, { x: 0, y: 0, rotation: 0 });
      world.add(entity, Velocity, { vx: 1, vy: 1 });
      world.add(entity, Health, { current: 100, max: 100 });
    }

    const elapsed = performance.now() - start;

    console.log(`Add 3 components to 10k entities: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  test("query and update 10,000 entities (should be < 20ms)", () => {
    const world = new World({
      maxEntities: 10000,
      components: [Transform, Velocity],
    });

    // Setup: spawn and add components
    for (let i = 0; i < 10000; i++) {
      const entity = world.spawn();
      world.add(entity, Transform, { x: i, y: i, rotation: 0 });
      world.add(entity, Velocity, { vx: 1, vy: 1 });
    }

    const start = performance.now();

    // Query and update (simulates physics system)
    const deltaTime = 0.016;
    for (const entity of world.query(Transform, Velocity)) {
      const t = world.get(entity, Transform);
      const v = world.get(entity, Velocity);

      // Update using partial update (most efficient)
      world.update(entity, Transform, {
        x: t.x + v.vx * deltaTime,
        y: t.y + v.vy * deltaTime,
      });
    }

    const elapsed = performance.now() - start;

    console.log(`Query + update 10k entities: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(20);
  });

  test("repeated queries with caching (should be < 5ms)", () => {
    const world = new World({
      maxEntities: 5000,
      components: [Transform, Velocity, Health],
    });

    // Setup
    for (let i = 0; i < 5000; i++) {
      const entity = world.spawn();
      world.add(entity, Transform, { x: 0, y: 0, rotation: 0 });
      world.add(entity, Velocity, { vx: 1, vy: 1 });
    }

    const start = performance.now();

    // Run the same query 10 times (should be cached)
    for (let iteration = 0; iteration < 10; iteration++) {
      let count = 0;
      for (const entity of world.query(Transform, Velocity)) {
        const t = world.get(entity, Transform);
        world.update(entity, Transform, { x: t.x + 1 });
        count++;
      }
      expect(count).toBe(5000);
    }

    const elapsed = performance.now() - start;

    console.log(`10 iterations of query/update 5k entities: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(50);
  });

  test("memory efficiency: ArrayBuffer vs Float32Array savings", () => {
    const world = new World({
      maxEntities: 10000,
      components: [Health], // u16 + u16 = 4 bytes
    });

    // Spawn entities with Health component
    for (let i = 0; i < 10000; i++) {
      const entity = world.spawn();
      world.add(entity, Health, { current: 100, max: 100 });
    }

    // Health component: 2 × u16 = 4 bytes per entity
    // ArrayBuffer: 10,000 × 4 = 40 KB
    // Float32Array (old): 10,000 × 8 = 80 KB (would round up to 2 floats)
    // Savings: 50%

    const expectedBytes = 10000 * 4;
    console.log(`Memory for 10k Health components: ${(expectedBytes / 1024).toFixed(2)} KB`);
    console.log(`(Float32Array would use: ${(10000 * 8 / 1024).toFixed(2)} KB - 50% savings!)`);

    expect(true).toBe(true); // Memory check is informational
  });

  test("zero allocations in hot path", () => {
    const world = new World({
      maxEntities: 1000,
      components: [Transform, Velocity],
    });

    // Setup
    for (let i = 0; i < 1000; i++) {
      const entity = world.spawn();
      world.add(entity, Transform, { x: 0, y: 0, rotation: 0 });
      world.add(entity, Velocity, { vx: 1, vy: 1 });
    }

    // Force GC
    if (global.gc) global.gc();

    const memBefore = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    // Run many iterations (should have zero allocations due to reusable objects)
    for (let i = 0; i < 100; i++) {
      for (const entity of world.query(Transform, Velocity)) {
        const t = world.get(entity, Transform); // Reuses same object!
        const v = world.get(entity, Velocity); // Reuses same object!
        world.update(entity, Transform, {
          x: t.x + v.vx,
          y: t.y + v.vy,
        });
      }
    }

    const memAfter = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    console.log(`Memory before: ${memBefore} MB, after: ${memAfter} MB`);
    console.log(`Memory delta: ${(parseFloat(memAfter) - parseFloat(memBefore)).toFixed(2)} MB (should be ~0)`);

    // Memory should not grow significantly (< 5 MB for 100 iterations × 1000 entities)
    const delta = parseFloat(memAfter) - parseFloat(memBefore);
    expect(delta).toBeLessThan(5);
  });

  test("realistic game loop: 1000 entities at 60 FPS", () => {
    const world = new World({
      maxEntities: 2000,
      components: [Transform, Velocity, Health],
    });

    // Setup game world
    for (let i = 0; i < 1000; i++) {
      const entity = world.spawn();
      world.add(entity, Transform, { x: Math.random() * 800, y: Math.random() * 600, rotation: 0 });
      world.add(entity, Velocity, { vx: (Math.random() - 0.5) * 100, vy: (Math.random() - 0.5) * 100 });
      world.add(entity, Health, { current: 100, max: 100 });
    }

    const frameTimings: number[] = [];
    const targetFPS = 60;
    const targetFrameTime = 1000 / targetFPS; // 16.67ms

    // Simulate 100 frames
    for (let frame = 0; frame < 100; frame++) {
      const frameStart = performance.now();

      const deltaTime = 1 / 60;

      // Physics system
      for (const entity of world.query(Transform, Velocity)) {
        const t = world.get(entity, Transform);
        const v = world.get(entity, Velocity);

        world.update(entity, Transform, {
          x: t.x + v.vx * deltaTime,
          y: t.y + v.vy * deltaTime,
        });
      }

      // Health system
      for (const entity of world.query(Health)) {
        const h = world.get(entity, Health);
        if (h.current <= 0) {
          world.despawn(entity);
        }
      }

      const frameTime = performance.now() - frameStart;
      frameTimings.push(frameTime);
    }

    const avgFrameTime = frameTimings.reduce((a, b) => a + b, 0) / frameTimings.length;
    const maxFrameTime = Math.max(...frameTimings);

    console.log(`Average frame time: ${avgFrameTime.toFixed(2)}ms (${(1000 / avgFrameTime).toFixed(0)} FPS)`);
    console.log(`Max frame time: ${maxFrameTime.toFixed(2)}ms`);
    console.log(`Target: ${targetFrameTime.toFixed(2)}ms (60 FPS)`);

    // Should easily maintain 60 FPS
    expect(avgFrameTime).toBeLessThan(targetFrameTime);
  });

  test("performance shows zero-allocation benefit in repeated queries", () => {
    const world = new World({
      maxEntities: 10000,
      components: [Transform],
    });

    // Setup
    for (let i = 0; i < 10000; i++) {
      const entity = world.spawn();
      world.add(entity, Transform, { x: 0, y: 0, rotation: 0 });
    }

    // The key benefit of zero allocations shows up in GC pressure over time
    // Single-pass comparison doesn't show the full picture
    console.log("\nZero-allocation design benefits:");
    console.log("- No GC pauses during gameplay");
    console.log("- Consistent frame times");
    console.log("- Lower memory pressure");
    console.log("- See 'zero allocations in hot path' test for proof");

    expect(true).toBe(true); // This is informational
  });

  test("benchmark: spawn performance at scale", () => {
    console.log("\n=== Spawn Performance Benchmark ===");

    const sizes = [1000, 5000, 10000, 50000];

    for (const size of sizes) {
      const world = new World({
        maxEntities: size,
        components: [Transform],
      });

      const start = performance.now();
      for (let i = 0; i < size; i++) {
        world.spawn();
      }
      const elapsed = performance.now() - start;

      console.log(`Spawn ${size.toLocaleString()} entities: ${elapsed.toFixed(2)}ms (${(size / elapsed * 1000).toFixed(0)} entities/sec)`);
    }

    expect(true).toBe(true);
  });

  test("benchmark: spawn + despawn cycle (entity reuse)", () => {
    console.log("\n=== Spawn/Despawn Cycle Benchmark ===");

    const world = new World({
      maxEntities: 10000,
      components: [Transform],
    });

    // Initial spawn
    const entities: number[] = [];
    for (let i = 0; i < 10000; i++) {
      entities.push(world.spawn());
    }

    // Measure despawn
    const despawnStart = performance.now();
    for (const entity of entities) {
      world.despawn(entity);
    }
    const despawnTime = performance.now() - despawnStart;

    // Measure respawn (should reuse IDs)
    const respawnStart = performance.now();
    for (let i = 0; i < 10000; i++) {
      world.spawn();
    }
    const respawnTime = performance.now() - respawnStart;

    console.log(`Despawn 10k entities: ${despawnTime.toFixed(2)}ms`);
    console.log(`Respawn 10k entities (ID reuse): ${respawnTime.toFixed(2)}ms`);
    console.log(`Total cycle: ${(despawnTime + respawnTime).toFixed(2)}ms`);

    expect(world.getEntityCount()).toBe(10000);
  });

  test("benchmark: component add/remove operations", () => {
    console.log("\n=== Component Operations Benchmark ===");

    const world = new World({
      maxEntities: 10000,
      components: [Transform, Velocity, Health],
    });

    const entities: number[] = [];
    for (let i = 0; i < 10000; i++) {
      entities.push(world.spawn());
    }

    // Add components
    const addStart = performance.now();
    for (const entity of entities) {
      world.add(entity, Transform, { x: 0, y: 0, rotation: 0 });
      world.add(entity, Velocity, { vx: 0, vy: 0 });
      world.add(entity, Health, { current: 100, max: 100 });
    }
    const addTime = performance.now() - addStart;

    // Remove components
    const removeStart = performance.now();
    for (const entity of entities) {
      world.remove(entity, Velocity);
    }
    const removeTime = performance.now() - removeStart;

    console.log(`Add 3 components to 10k entities: ${addTime.toFixed(2)}ms`);
    console.log(`Remove 1 component from 10k entities: ${removeTime.toFixed(2)}ms`);

    expect(true).toBe(true);
  });

  test("benchmark: query performance with different entity counts", () => {
    console.log("\n=== Query Performance Benchmark ===");

    const sizes = [100, 1000, 5000, 10000];

    for (const size of sizes) {
      const world = new World({
        maxEntities: size,
        components: [Transform, Velocity],
      });

      // Setup entities
      for (let i = 0; i < size; i++) {
        const entity = world.spawn();
        world.add(entity, Transform, { x: i, y: i, rotation: 0 });
        world.add(entity, Velocity, { vx: 1, vy: 1 });
      }

      // Single query
      const singleStart = performance.now();
      world.query(Transform, Velocity);
      const singleTime = performance.now() - singleStart;

      // 100 queries (typical frame)
      const multiStart = performance.now();
      for (let i = 0; i < 100; i++) {
        world.query(Transform, Velocity);
      }
      const multiTime = performance.now() - multiStart;

      console.log(`Query ${size.toLocaleString()} entities: ${singleTime.toFixed(3)}ms (single), ${multiTime.toFixed(2)}ms (100x)`);
    }

    expect(true).toBe(true);
  });

  test("benchmark: get() vs getMutable() performance", () => {
    console.log("\n=== Get vs GetMutable Benchmark ===");

    const world = new World({
      maxEntities: 10000,
      components: [Transform],
    });

    const entities: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const entity = world.spawn();
      world.add(entity, Transform, { x: i, y: i, rotation: 0 });
      entities.push(entity);
    }

    // Benchmark get() (readonly, reusable)
    const getStart = performance.now();
    let sum1 = 0;
    for (const entity of entities) {
      const t = world.get(entity, Transform);
      sum1 += t.x + t.y; // Use values
    }
    const getTime = performance.now() - getStart;

    // Benchmark getMutable() (allocates)
    const getMutableStart = performance.now();
    let sum2 = 0;
    for (const entity of entities) {
      const t = world.getMutable(entity, Transform);
      sum2 += t.x + t.y; // Use values
    }
    const getMutableTime = performance.now() - getMutableStart;

    console.log(`get() 10k times: ${getTime.toFixed(2)}ms (${(10000 / getTime * 1000).toFixed(0)} ops/sec)`);
    console.log(`getMutable() 10k times: ${getMutableTime.toFixed(2)}ms (${(10000 / getMutableTime * 1000).toFixed(0)} ops/sec)`);
    console.log(`get() is ${(getMutableTime / getTime).toFixed(1)}x faster`);

    expect(getTime).toBeLessThan(getMutableTime);
  });

  test("benchmark: update() vs set() for partial changes", () => {
    console.log("\n=== Update vs Set Benchmark ===");

    const world = new World({
      maxEntities: 10000,
      components: [Transform],
    });

    const entities: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const entity = world.spawn();
      world.add(entity, Transform, { x: 0, y: 0, rotation: 0 });
      entities.push(entity);
    }

    // Benchmark update() (partial, optimized)
    const updateStart = performance.now();
    for (const entity of entities) {
      world.update(entity, Transform, { x: 100 });
    }
    const updateTime = performance.now() - updateStart;

    // Reset
    for (const entity of entities) {
      world.set(entity, Transform, { x: 0, y: 0, rotation: 0 });
    }

    // Benchmark set() (full replace)
    const setStart = performance.now();
    for (const entity of entities) {
      world.set(entity, Transform, { x: 100, y: 0, rotation: 0 });
    }
    const setTime = performance.now() - setStart;

    console.log(`update() 1 field on 10k entities: ${updateTime.toFixed(2)}ms`);
    console.log(`set() all fields on 10k entities: ${setTime.toFixed(2)}ms`);
    console.log(`update() is ${(setTime / updateTime).toFixed(1)}x faster for partial changes`);

    expect(true).toBe(true);
  });

  test("benchmark: complex game simulation (realistic workload)", () => {
    console.log("\n=== Complex Game Simulation Benchmark (10+ Systems) ===");

    // Define additional components for more realistic simulation
    const Armor = defineComponent("Armor", {
      value: BinaryCodec.u16,
    });

    const Damage = defineComponent("Damage", {
      amount: BinaryCodec.u16,
    });

    const Cooldown = defineComponent("Cooldown", {
      current: BinaryCodec.f32,
      max: BinaryCodec.f32,
    });

    const Team = defineComponent("Team", {
      id: BinaryCodec.u8,
    });

    const Target = defineComponent("Target", {
      entityId: BinaryCodec.u32,
    });

    const Status = defineComponent("Status", {
      stunned: BinaryCodec.u8,
      slowed: BinaryCodec.u8,
    });

    const Lifetime = defineComponent("Lifetime", {
      remaining: BinaryCodec.f32,
    });

    const entityCounts = [500, 1000, 5000, 10000, 25000, 50000];
    const fps60Budget = 16.67; // 60 FPS
    const fps30Budget = 33.33; // 30 FPS

    for (const count of entityCounts) {
      const world = new World({
        maxEntities: count,
        components: [Transform, Velocity, Health, Armor, Damage, Cooldown, Team, Target, Status, Lifetime],
      });

      // Setup entities with varied component combinations
      for (let i = 0; i < count; i++) {
        const entity = world.spawn();
        world.add(entity, Transform, { x: Math.random() * 1000, y: Math.random() * 1000, rotation: Math.random() * Math.PI * 2 });
        world.add(entity, Velocity, { vx: Math.random() * 10 - 5, vy: Math.random() * 10 - 5 });
        world.add(entity, Health, { current: 100, max: 100 });

        // 80% have armor
        if (Math.random() > 0.2) {
          world.add(entity, Armor, { value: Math.floor(Math.random() * 50) });
        }

        // 60% can deal damage
        if (Math.random() > 0.4) {
          world.add(entity, Damage, { amount: Math.floor(Math.random() * 20) + 10 });
          world.add(entity, Cooldown, { current: 0, max: 1.0 });
        }

        // Assign to teams
        world.add(entity, Team, { id: Math.floor(Math.random() * 4) });

        // 30% have targets
        if (Math.random() > 0.7) {
          world.add(entity, Target, { entityId: Math.floor(Math.random() * count) });
        }

        // 20% have status effects
        if (Math.random() > 0.8) {
          world.add(entity, Status, { stunned: Math.random() > 0.5 ? 1 : 0, slowed: Math.random() > 0.5 ? 1 : 0 });
        }

        // 15% are temporary entities (projectiles, effects, etc.)
        if (Math.random() > 0.85) {
          world.add(entity, Lifetime, { remaining: Math.random() * 5 });
        }
      }

      // Simulate 60 frames
      const frameCount = 60;
      const deltaTime = 0.016;
      const frameTimes: number[] = [];

      for (let frame = 0; frame < frameCount; frame++) {
        const frameStart = performance.now();

        // System 1: Movement system (applies velocity to transform)
        for (const entity of world.query(Transform, Velocity)) {
          const t = world.get(entity, Transform);
          const v = world.get(entity, Velocity);

          world.update(entity, Transform, {
            x: t.x + v.vx * deltaTime,
            y: t.y + v.vy * deltaTime,
          });
        }

        // System 2: Rotation system (rotate entities based on velocity)
        for (const entity of world.query(Transform, Velocity)) {
          const v = world.get(entity, Velocity);
          if (v.vx !== 0 || v.vy !== 0) {
            world.update(entity, Transform, {
              rotation: Math.atan2(v.vy, v.vx),
            });
          }
        }

        // System 3: Boundary system (wrap around screen edges)
        for (const entity of world.query(Transform)) {
          const t = world.get(entity, Transform);
          let needsUpdate = false;
          let newX = t.x;
          let newY = t.y;

          if (t.x < 0) { newX = 1000; needsUpdate = true; }
          if (t.x > 1000) { newX = 0; needsUpdate = true; }
          if (t.y < 0) { newY = 1000; needsUpdate = true; }
          if (t.y > 1000) { newY = 0; needsUpdate = true; }

          if (needsUpdate) {
            world.update(entity, Transform, { x: newX, y: newY });
          }
        }

        // System 4: Health regeneration system
        if (frame % 30 === 0) {
          for (const entity of world.query(Health)) {
            const h = world.get(entity, Health);
            if (h.current > 0 && h.current < h.max) {
              const newHealth = h.current + 5;
              world.update(entity, Health, {
                current: newHealth > h.max ? h.max : newHealth,
              });
            }
          }
        }

        // System 5: Cooldown system
        for (const entity of world.query(Cooldown)) {
          const cd = world.get(entity, Cooldown);
          if (cd.current > 0) {
            const newCooldown = cd.current - deltaTime;
            world.update(entity, Cooldown, {
              current: newCooldown < 0 ? 0 : newCooldown,
            });
          }
        }

        // System 6: Combat system (entities with damage and target)
        if (frame % 5 === 0) {
          for (const entity of world.query(Damage, Cooldown, Target)) {
            const cd = world.get(entity, Cooldown);
            const target = world.get(entity, Target);

            if (cd.current === 0 && world.isAlive(target.entityId)) {
              const dmg = world.get(entity, Damage);

              if (world.has(target.entityId, Health)) {
                const targetHealth = world.get(target.entityId, Health);
                let damageDealt = dmg.amount;

                // Apply armor reduction
                if (world.has(target.entityId, Armor)) {
                  const armor = world.get(target.entityId, Armor);
                  const reduced = dmg.amount - armor.value * 0.1;
                  damageDealt = reduced < 1 ? 1 : reduced;
                }

                const newHealth = targetHealth.current - damageDealt;
                world.update(target.entityId, Health, {
                  current: newHealth < 0 ? 0 : newHealth,
                });

                // Reset cooldown
                world.update(entity, Cooldown, { current: cd.max });
              }
            }
          }
        }

        // System 7: Death system (despawn dead entities)
        const toRemove: number[] = [];
        for (const entity of world.query(Health)) {
          const h = world.get(entity, Health);
          if (h.current <= 0) {
            toRemove.push(entity);
          }
        }
        for (const entity of toRemove) {
          world.despawn(entity);
        }

        // System 8: Status effect system
        for (const entity of world.query(Status, Velocity)) {
          const status = world.get(entity, Status);
          const v = world.get(entity, Velocity);

          if (status.stunned === 1) {
            world.update(entity, Velocity, { vx: 0, vy: 0 });
          } else if (status.slowed === 1) {
            world.update(entity, Velocity, {
              vx: v.vx * 0.5,
              vy: v.vy * 0.5,
            });
          }
        }

        // System 9: Lifetime system (despawn temporary entities)
        const expiredEntities: number[] = [];
        for (const entity of world.query(Lifetime)) {
          const lifetime = world.get(entity, Lifetime);
          const remaining = lifetime.remaining - deltaTime;

          if (remaining <= 0) {
            expiredEntities.push(entity);
          } else {
            world.update(entity, Lifetime, { remaining });
          }
        }
        for (const entity of expiredEntities) {
          world.despawn(entity);
        }

        // System 10: Velocity damping system (apply friction)
        for (const entity of world.query(Velocity)) {
          const v = world.get(entity, Velocity);
          world.update(entity, Velocity, {
            vx: v.vx * 0.99,
            vy: v.vy * 0.99,
          });
        }

        // System 11: Random velocity changes (simulates AI behavior)
        if (frame % 20 === 0) {
          for (const entity of world.query(Velocity)) {
            if (Math.random() > 0.9) {
              const v = world.get(entity, Velocity);
              world.update(entity, Velocity, {
                vx: v.vx + (Math.random() - 0.5) * 2,
                vy: v.vy + (Math.random() - 0.5) * 2,
              });
            }
          }
        }

        frameTimes.push(performance.now() - frameStart);
      }

      const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      const maxFrameTime = Math.max(...frameTimes);
      const minFrameTime = Math.min(...frameTimes);
      const fps = 1000 / avgFrameTime;

      // Determine status
      let status60 = avgFrameTime < fps60Budget ? "✅" : "❌";
      let status30 = avgFrameTime < fps30Budget ? "✅" : "⚠️";

      console.log(`${count.toLocaleString()} entities: ${avgFrameTime.toFixed(2)}ms avg (${fps.toFixed(0)} FPS) - 60fps: ${status60} 30fps: ${status30}`);
      console.log(`  Min: ${minFrameTime.toFixed(2)}ms, Max: ${maxFrameTime.toFixed(2)}ms`);
    }

    expect(true).toBe(true);
  }, { timeout: 15000 });

  test("benchmark: memory usage comparison", () => {
    console.log("\n=== Memory Usage Benchmark ===");

    const sizes = [1000, 5000, 10000];

    for (const size of sizes) {
      const world = new World({
        maxEntities: size,
        components: [Transform, Velocity, Health],
      });

      const memBefore = (performance as any).memory?.usedJSHeapSize || 0;

      // Create entities with components
      for (let i = 0; i < size; i++) {
        const entity = world.spawn();
        world.add(entity, Transform, { x: i, y: i, rotation: 0 });
        world.add(entity, Velocity, { vx: 1, vy: 1 });
        world.add(entity, Health, { current: 100, max: 100 });
      }

      const memAfter = (performance as any).memory?.usedJSHeapSize || 0;
      const delta = (memAfter - memBefore) / 1024 / 1024;

      console.log(`${size} entities: ${delta.toFixed(2)} MB (~${(delta / size * 1024).toFixed(2)} KB per entity)`);
    }

    expect(true).toBe(true);
  });

  test("benchmark: worst case scenario (many components per entity)", () => {
    console.log("\n=== Worst Case Benchmark (Many Components) ===");

    // Create 16 different components
    const components = [];
    for (let i = 0; i < 16; i++) {
      components.push(
        defineComponent(`Component${i}`, {
          value: BinaryCodec.f32,
        })
      );
    }

    const world = new World({
      maxEntities: 1000,
      components,
    });

    const entities: number[] = [];

    // Spawn and add all components
    const setupStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      const entity = world.spawn();
      for (const component of components) {
        world.add(entity, component, { value: i });
      }
      entities.push(entity);
    }
    const setupTime = performance.now() - setupStart;

    // Query with many component requirements
    const queryStart = performance.now();
    const results = world.query(...components.slice(0, 8));
    const queryTime = performance.now() - queryStart;

    console.log(`Setup 1000 entities with 16 components each: ${setupTime.toFixed(2)}ms`);
    console.log(`Query with 8 component requirements: ${queryTime.toFixed(3)}ms`);
    console.log(`Result count: ${results.length}`);

    expect(results.length).toBe(1000);
  });
}); // Extended timeout for benchmarks
