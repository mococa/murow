import { defineComponent } from "../../../src/ecs/component";
import { BinaryCodec } from "../../../src/core/binary-codec";
import { World } from "../../../src/ecs/world";

// Define components matching Bevy's benchmark
const Transform2D = defineComponent("Transform2D", {
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

// Simple random number generator for deterministic benchmarking
class SimpleRng {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  nextF32(): number {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    return (((this.seed / 65536) >>> 0) % 32768) / 32768.0;
  }

  nextU16(): number {
    return Math.floor(this.nextF32() * 65535);
  }

  nextU8(): number {
    return Math.floor(this.nextF32() * 255);
  }
}

function runBenchmark(entityCount: number): { avg: number; min: number; max: number } {
  const world = new World({
    maxEntities: entityCount,
    components: [
      Transform2D,
      Velocity,
      Health,
      Armor,
      Damage,
      Cooldown,
      Team,
      Target,
      Status,
      Lifetime,
    ],
  });

  // Cache arrays once for cross-entity reads
  const healthCurrent = world.getFieldArray(Health, 'current');
  const armorValue = world.getFieldArray(Armor, 'value');

  // Register systems using HYBRID API: system builder + direct array access
  // These run automatically with world.runSystems()
  // Note: We use entity.field_array[entity.eid] for RAW SPEED!
  world
    .addSystem()
    .query(Transform2D, Velocity)
    .fields([
      { transform: ['x', 'y'] },
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, deltaTime) => {
      entity.transform_x_array[entity.eid]! += entity.velocity_vx_array[entity.eid]! * deltaTime;
      entity.transform_y_array[entity.eid]! += entity.velocity_vy_array[entity.eid]! * deltaTime;
    });

  world
    .addSystem()
    .query(Transform2D, Velocity)
    .fields([
      { transform: ['rotation'] },
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, _deltaTime) => {
      entity.transform_rotation_array[entity.eid]! += Math.atan2(
        entity.velocity_vy_array[entity.eid]!,
        entity.velocity_vx_array[entity.eid]!
      ) * 0.01;

      if (entity.transform_rotation_array[entity.eid]! > Math.PI) {
        entity.transform_rotation_array[entity.eid]! -= Math.PI * 2;
      }
    });

  world
    .addSystem()
    .query(Transform2D)
    .fields([
      { transform: ['x', 'y'] }
    ])
    .run((entity, _deltaTime) => {
      // oscillate between 0 and 1000

      entity.transform_x_array[entity.eid] = (entity.transform_x_array[entity.eid]! + 1000) % 1000;
      entity.transform_y_array[entity.eid] = (entity.transform_y_array[entity.eid]! + 1000) % 1000;
    });

  world
    .addSystem()
    .query(Cooldown)
    .fields([
      { cooldown: ['current'] }
    ])
    .run((entity, deltaTime) => {
      const current = entity.cooldown_current_array[entity.eid]!;
      if (current <= 0) return;

      const newCooldown = current - deltaTime;
      entity.cooldown_current_array[entity.eid]! = newCooldown < 0 ? 0 : newCooldown;
    });

  world
    .addSystem()
    .query(Status, Velocity)
    .fields([
      { status: ['stunned', 'slowed'] },
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, _deltaTime) => {
      const stunned = entity.status_stunned_array[entity.eid]!;
      const slowed = entity.status_slowed_array[entity.eid]!;
      const vx = entity.velocity_vx_array;;
      const vy = entity.velocity_vy_array;
      if (stunned === 1) {
        vx[entity.eid] = 0;
        vy[entity.eid] = 0;
      } else if (slowed === 1) {
        vx[entity.eid]! *= 0.5;
        vy[entity.eid]! *= 0.5;
      }
    });

  world
    .addSystem()
    .query(Velocity)
    .fields([
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, _deltaTime) => {
      entity.velocity_vx_array[entity.eid]! *= 0.99;
      entity.velocity_vy_array[entity.eid]! *= 0.99;
    });

  // Create manual systems for conditional execution
  const healthRegenSystem = world
    .addSystem()
    .query(Health)
    .fields([
      { health: ['current', 'max'] }
    ])
    .run((entity, _deltaTime) => {
      const current = entity.health_current_array[entity.eid]!;
      const maxVal = entity.health_max_array[entity.eid]!;
      if (current > 0 && current < maxVal) {
        const newHealth = current + 5;
        entity.health_current_array[entity.eid]! = newHealth > maxVal ? maxVal : newHealth;
      }
    });

  const deathSystem = world
    .addSystem()
    .query(Health)
    .fields([
      { health: ['current'] }
    ])
    .run((entity, _deltaTime, world) => {
      const current = entity.health_current_array[entity.eid]!;
      if (current > 0) return;

      world.despawn(entity.eid);
    });

  const lifetimeSystem = world
    .addSystem()
    .query(Lifetime)
    .fields([
      { lifetime: ['remaining'] }
    ])
    .run((entity, deltaTime, world) => {
      const remaining = entity.lifetime_remaining_array[entity.eid]! - deltaTime;
      if (remaining <= 0) {
        world.despawn(entity.eid);
        return;
      }

      entity.lifetime_remaining_array[entity.eid]! = remaining;
    });

  const aiSystem = world
    .addSystem()
    .query(Velocity)
    .fields([
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, _deltaTime) => {
      entity.velocity_vx_array[entity.eid]! += (Math.random() - 0.5) * 2;
      entity.velocity_vy_array[entity.eid]! += (Math.random() - 0.5) * 2;
    });

  // Combat system - uses hybrid API + closure over cached arrays for cross-entity reads
  const combatSystem = world
    .addSystem()
    .query(Cooldown, Damage, Target)
    .fields([
      { cooldown: ['current', 'max'] },
      { damage: ['amount'] },
      { target: ['entityId'] }
    ])
    .run((entity, _deltaTime, world) => {
      if (entity.cooldown_current_array[entity.eid] === 0) {
        const targetId = entity.target_entityId_array[entity.eid]!;
        if (!world.isAlive(targetId) || !world.has(targetId, Health)) return;

        const targetHealth = healthCurrent[targetId]!;
        let damageDealt = entity.damage_amount_array[entity.eid]!;
        // Apply armor reduction
        if (world.has(targetId, Armor)) {
          const armor = armorValue[targetId]!;
          const reduced = damageDealt - armor * 0.1;
          damageDealt = reduced < 1 ? 1 : Math.floor(reduced);
        }

        const newHealth = targetHealth > damageDealt ? targetHealth - damageDealt : 0;
        healthCurrent[targetId] = newHealth;

        // Reset cooldown
        entity.cooldown_current_array[entity.eid]! = entity.cooldown_max_array[entity.eid]!;
      }
    });

  // Setup entities
  const rng = new SimpleRng(12345);

  for (let i = 0; i < entityCount; i++) {
    const entity = world
      .entity(world.spawn())
      .add(Transform2D, {
        x: rng.nextF32() * 1000,
        y: rng.nextF32() * 1000,
        rotation: rng.nextF32() * Math.PI * 2,
      })
      .add(Velocity, {
        vx: rng.nextF32() * 10 - 5,
        vy: rng.nextF32() * 10 - 5,
      })
      .add(Health, {
        current: 100,
        max: 100,
      });

    // 80% have armor
    if (rng.nextF32() > 0.2) {
      entity.add(Armor, {
        value: Math.floor(rng.nextF32() * 50),
      });
    }

    // 60% can deal damage
    if (rng.nextF32() > 0.4) {
      const targetEntity = Math.floor(rng.nextF32() * entityCount);
      entity
        .add(Damage, {
          amount: Math.floor(rng.nextF32() * 20) + 10,
        })
        .add(Cooldown, {
          current: 0,
          max: 1.0,
        })
        .add(Target, { entityId: targetEntity });
    }

    // Assign to teams
    entity.add(Team, { id: Math.floor(rng.nextF32() * 4) });

    // 20% have status effects
    if (rng.nextF32() > 0.8) {
      entity.add(Status, {
        stunned: rng.nextF32() > 0.5 ? 1 : 0,
        slowed: rng.nextF32() > 0.5 ? 1 : 0,
      });
    }

    // 15% are temporary entities
    if (rng.nextF32() > 0.85) {
      entity.add(Lifetime, {
        remaining: rng.nextF32() * 5,
      });
    }
  }

  // Run simulation for 60 frames
  const frameCount = 60;
  const deltaTime = 0.016;
  const frameTimes: number[] = [];

  for (let frame = 0; frame < frameCount; frame++) {
    const frameStart = performance.now();

    // Run all auto-registered systems
    world.runSystems(deltaTime);

    // Health regen every 30 frames
    if (frame % 30 === 0) {
      healthRegenSystem.execute(deltaTime);
    }

    // Combat system every 5 frames
    if (frame % 5 === 0) {
      combatSystem.execute(deltaTime);
    }

    // Death system - despawn dead entities
    deathSystem.execute(deltaTime);

    // Lifetime system - despawn expired entities
    lifetimeSystem.execute(deltaTime);

    // AI behavior system every 20 frames
    if (frame % 20 === 0) {
      const rng = new SimpleRng(frame);
      const originalRandom = Math.random;
      Math.random = () => rng.nextF32();
      aiSystem.execute(deltaTime);
      Math.random = originalRandom;
    }

    const frameTime = performance.now() - frameStart;
    frameTimes.push(frameTime);
  }

  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const min = Math.min(...frameTimes);
  const max = Math.max(...frameTimes);

  return { avg, min, max };
}

function main() {
  console.log("Murow HYBRID API Benchmark - Complex Game Simulation (11 Systems)\n");
  console.log("Using direct array access (entity.field_array[entity.eid]) for maximum performance\n");
  console.log("Running 5 iterations per entity count for averaging...\n");

  const entityCounts = [500, 1_000, 5_000, 10_000, 15_000, 25_000, 50_000, 100_000];

  console.log("| Entity Count | Avg Time | FPS | Min | Max |");
  console.log("|--------------|----------|-----|-----|-----|");

  for (const count of entityCounts) {
    // Run 5 times and average
    const allAvgs: number[] = [];
    const allMins: number[] = [];
    const allMaxs: number[] = [];

    for (let run = 0; run < 5; run++) {
      console.error(`  Run ${run + 1}/5 for ${count} entities...`);
      const { avg, min, max } = runBenchmark(count);
      allAvgs.push(avg);
      allMins.push(min);
      allMaxs.push(max);
    }

    const finalAvg = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
    const finalMin = Math.min(...allMins);
    const finalMax = Math.max(...allMaxs);
    const fps = Math.floor(1000 / finalAvg);

    console.log(
      `| ${count.toString().padStart(12)} | ${finalAvg.toFixed(2)}ms | ${fps.toString().padStart(3)} | ${finalMin.toFixed(2)}ms | ${finalMax.toFixed(2)}ms |`
    );
  }
}

main();
