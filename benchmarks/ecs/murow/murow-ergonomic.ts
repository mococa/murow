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

  // Register systems using ergonomic addSystem API with flattened property syntax
  // These run automatically with world.runSystems()
  // Note: We use flattened syntax (entity.transform_x) for best performance
  world
    .addSystem()
    .query(Transform2D, Velocity)
    .fields([
      { transform: ['x', 'y'] },
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, deltaTime) => {
      entity.transform_x += entity.velocity_vx * deltaTime;
      entity.transform_y += entity.velocity_vy * deltaTime;
    });

  world
    .addSystem()
    .query(Transform2D, Velocity)
    .fields([
      { transform: ['rotation'] },
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, _deltaTime) => {
      const vx = entity.velocity_vx;
      const vy = entity.velocity_vy;
      if (vx !== 0 || vy !== 0) {
        entity.transform_rotation = Math.atan2(vy, vx);
      }
    });

  world
    .addSystem()
    .query(Transform2D)
    .fields([
      { transform: ['x', 'y'] }
    ])
    .run((entity, _deltaTime) => {
      if (entity.transform_x < 0) entity.transform_x = 1000;
      if (entity.transform_x > 1000) entity.transform_x = 0;
      if (entity.transform_y < 0) entity.transform_y = 1000;
      if (entity.transform_y > 1000) entity.transform_y = 0;
    });

  world
    .addSystem()
    .query(Cooldown)
    .fields([
      { cooldown: ['current'] }
    ])
    .run((entity, deltaTime) => {
      if (entity.cooldown_current > 0) {
        const newCooldown = entity.cooldown_current - deltaTime;
        entity.cooldown_current = newCooldown < 0 ? 0 : newCooldown;
      }
    });

  world
    .addSystem()
    .query(Status, Velocity)
    .fields([
      { status: ['stunned', 'slowed'] },
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, _deltaTime) => {
      const stunned = entity.status_stunned;
      const slowed = entity.status_slowed;

      if (stunned === 1) {
        entity.velocity_vx = 0;
        entity.velocity_vy = 0;
      } else if (slowed === 1) {
        entity.velocity_vx *= 0.5;
        entity.velocity_vy *= 0.5;
      }
    });

  world
    .addSystem()
    .query(Velocity)
    .fields([
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, _deltaTime) => {
      entity.velocity_vx *= 0.99;
      entity.velocity_vy *= 0.99;
    });

  // Create manual systems for conditional execution
  const healthRegenSystem = world
    .addSystem()
    .query(Health)
    .fields([
      { health: ['current', 'max'] }
    ])
    .run((entity, _deltaTime) => {
      const current = entity.health_current;
      const max = entity.health_max;
      if (current > 0 && current < max) {
        const newHealth = current + 5;
        entity.health_current = newHealth > max ? max : newHealth;
      }
    });

  const deathSystem = world
    .addSystem()
    .query(Health)
    .fields([
      { health: ['current'] }
    ])
    .run((entity, _deltaTime, world) => {
      if (entity.health_current === 0) {
        world.despawn(entity.eid);
      }
    });

  const lifetimeSystem = world
    .addSystem()
    .query(Lifetime)
    .fields([
      { lifetime: ['remaining'] }
    ])
    .run((entity, deltaTime, world) => {
      const remaining = entity.lifetime_remaining - deltaTime;
      if (remaining <= 0) {
        world.despawn(entity.eid);
      } else {
        entity.lifetime_remaining = remaining;
      }
    });

  const aiSystem = world
    .addSystem()
    .query(Velocity)
    .fields([
      { velocity: ['vx', 'vy'] }
    ])
    .run((entity, _deltaTime) => {
      entity.velocity_vx += (Math.random() - 0.5) * 2;
      entity.velocity_vy += (Math.random() - 0.5) * 2;
    });

  // Combat system - uses ergonomic API + closure over cached arrays for cross-entity reads
  const combatSystem = world
    .addSystem()
    .query(Cooldown, Damage, Target)
    .fields([
      { cooldown: ['current', 'max'] },
      { damage: ['amount'] },
      { target: ['entityId'] }
    ])
    .run((entity, _deltaTime, world) => {
      if (entity.cooldown_current === 0 && world.isAlive(entity.target_entityId) && world.has(entity.target_entityId, Health)) {
        const targetId = entity.target_entityId;
        const targetHealth = healthCurrent[targetId]!;
        let damageDealt = entity.damage_amount;

        // Apply armor reduction
        if (world.has(targetId, Armor)) {
          const armor = armorValue[targetId]!;
          const reduced = entity.damage_amount - armor * 0.1;
          damageDealt = reduced < 1 ? 1 : Math.floor(reduced);
        }

        const newHealth = targetHealth > damageDealt ? targetHealth - damageDealt : 0;
        healthCurrent[targetId] = newHealth;

        // Reset cooldown
        entity.cooldown_current = entity.cooldown_max;
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
  console.log("Murow Ergonomic API Benchmark - Complex Game Simulation (11 Systems)\n");
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
