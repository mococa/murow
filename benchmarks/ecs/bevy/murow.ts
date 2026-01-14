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

// System implementations matching Bevy's benchmark
function movementSystem(world: World, deltaTime: number): void {
  for (const entity of world.query(Transform2D, Velocity)) {
    const t = world.get(entity, Transform2D);
    const v = world.get(entity, Velocity);

    world.update(entity, Transform2D, {
      x: t.x + v.vx * deltaTime,
      y: t.y + v.vy * deltaTime,
    });
  }
}

function rotationSystem(world: World): void {
  for (const entity of world.query(Transform2D, Velocity)) {
    const t = world.get(entity, Transform2D);
    const v = world.get(entity, Velocity);

    if (v.vx !== 0 || v.vy !== 0) {
      world.update(entity, Transform2D, {
        rotation: Math.atan2(v.vy, v.vx),
      });
    }
  }
}

function boundarySystem(world: World): void {
  for (const entity of world.query(Transform2D)) {
    const t = world.get(entity, Transform2D);
    let needsUpdate = false;
    let newX = t.x;
    let newY = t.y;

    if (t.x < 0) {
      newX = 1000;
      needsUpdate = true;
    }
    if (t.x > 1000) {
      newX = 0;
      needsUpdate = true;
    }
    if (t.y < 0) {
      newY = 1000;
      needsUpdate = true;
    }
    if (t.y > 1000) {
      newY = 0;
      needsUpdate = true;
    }

    if (needsUpdate) {
      world.update(entity, Transform2D, { x: newX, y: newY });
    }
  }
}

function healthRegenSystem(world: World, frame: number): void {
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
}

function cooldownSystem(world: World, deltaTime: number): void {
  for (const entity of world.query(Cooldown)) {
    const cd = world.get(entity, Cooldown);
    if (cd.current > 0) {
      const newCooldown = cd.current - deltaTime;
      world.update(entity, Cooldown, {
        current: newCooldown < 0 ? 0 : newCooldown,
      });
    }
  }
}

function combatSystem(world: World, frame: number): void {
  if (frame % 5 === 0) {
    // Collect all updates first to avoid issues with queries during iteration
    const updates: Array<{ targetId: number; newHealth: number; attackerId: number }> = [];

    for (const entity of world.query(Cooldown, Damage, Target)) {
      const cd = world.get(entity, Cooldown);
      const dmg = world.get(entity, Damage);
      const target = world.get(entity, Target);

      if (cd.current === 0 && world.isAlive(target.entityId) && world.has(target.entityId, Health)) {
        const targetHealth = world.get(target.entityId, Health);
        let damageDealt = dmg.amount;

        // Apply armor reduction
        if (world.has(target.entityId, Armor)) {
          const armor = world.get(target.entityId, Armor);
          const reduced = dmg.amount - armor.value * 0.1;
          damageDealt = reduced < 1 ? 1 : Math.floor(reduced);
        }

        const newHealth = targetHealth.current > damageDealt
          ? targetHealth.current - damageDealt
          : 0;

        updates.push({ targetId: target.entityId, newHealth, attackerId: entity });
      }
    }

    // Apply all updates
    for (const { targetId, newHealth, attackerId } of updates) {
      if (world.isAlive(targetId)) {
        world.update(targetId, Health, { current: newHealth });
      }
      // Reset cooldown
      const cd = world.get(attackerId, Cooldown);
      world.update(attackerId, Cooldown, { current: cd.max });
    }
  }
}

function deathSystem(world: World): void {
  const toRemove: number[] = [];

  for (const entity of world.query(Health)) {
    const h = world.get(entity, Health);
    if (h.current === 0) {
      toRemove.push(entity);
    }
  }

  for (const entity of toRemove) {
    world.despawn(entity);
  }
}

function statusEffectSystem(world: World): void {
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
}

function lifetimeSystem(world: World, deltaTime: number): void {
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
}

function velocityDampingSystem(world: World): void {
  for (const entity of world.query(Velocity)) {
    const v = world.get(entity, Velocity);
    world.update(entity, Velocity, {
      vx: v.vx * 0.99,
      vy: v.vy * 0.99,
    });
  }
}

function aiBehaviorSystem(world: World, frame: number): void {
  if (frame % 20 === 0) {
    const rng = new SimpleRng(frame);

    for (const entity of world.query(Velocity)) {
      if (rng.nextF32() > 0.9) {
        const v = world.get(entity, Velocity);
        world.update(entity, Velocity, {
          vx: v.vx + (rng.nextF32() - 0.5) * 2,
          vy: v.vy + (rng.nextF32() - 0.5) * 2,
        });
      }
    }
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

  // Setup entities
  const rng = new SimpleRng(12345);

  for (let i = 0; i < entityCount; i++) {
    const entity = world.spawn();

    world.add(entity, Transform2D, {
      x: rng.nextF32() * 1000,
      y: rng.nextF32() * 1000,
      rotation: rng.nextF32() * Math.PI * 2,
    });

    world.add(entity, Velocity, {
      vx: rng.nextF32() * 10 - 5,
      vy: rng.nextF32() * 10 - 5,
    });

    world.add(entity, Health, {
      current: 100,
      max: 100,
    });

    // 80% have armor
    if (rng.nextF32() > 0.2) {
      world.add(entity, Armor, {
        value: Math.floor(rng.nextF32() * 50),
      });
    }

    // 60% can deal damage
    if (rng.nextF32() > 0.4) {
      const targetEntity = Math.floor(rng.nextF32() * entityCount);
      world.add(entity, Damage, {
        amount: Math.floor(rng.nextF32() * 20) + 10,
      });
      world.add(entity, Cooldown, {
        current: 0,
        max: 1.0,
      });
      world.add(entity, Target, {
        entityId: targetEntity,
      });
    }

    // Assign to teams
    world.add(entity, Team, {
      id: Math.floor(rng.nextF32() * 4),
    });

    // 20% have status effects
    if (rng.nextF32() > 0.8) {
      world.add(entity, Status, {
        stunned: rng.nextF32() > 0.5 ? 1 : 0,
        slowed: rng.nextF32() > 0.5 ? 1 : 0,
      });
    }

    // 15% are temporary entities
    if (rng.nextF32() > 0.85) {
      world.add(entity, Lifetime, {
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

    // Run all systems in order
    movementSystem(world, deltaTime);
    rotationSystem(world);
    boundarySystem(world);
    healthRegenSystem(world, frame);
    cooldownSystem(world, deltaTime);
    combatSystem(world, frame);
    deathSystem(world);
    statusEffectSystem(world);
    lifetimeSystem(world, deltaTime);
    velocityDampingSystem(world);
    aiBehaviorSystem(world, frame);

    const frameTime = performance.now() - frameStart;
    frameTimes.push(frameTime);
  }

  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const min = Math.min(...frameTimes);
  const max = Math.max(...frameTimes);

  return { avg, min, max };
}

function main() {
  console.log("Murow ECS Benchmark - Complex Game Simulation (11 Systems)\n");
  console.log("Running 5 iterations per entity count for averaging...\n");

  const entityCounts = [500, 1000, 5000, 10000, 25000, 50000];

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
