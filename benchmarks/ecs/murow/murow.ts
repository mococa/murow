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

  // Get direct array access (bitECS-style)
  const transformX = world.getFieldArray(Transform2D, 'x');
  const transformY = world.getFieldArray(Transform2D, 'y');
  const transformRot = world.getFieldArray(Transform2D, 'rotation');
  const velocityVx = world.getFieldArray(Velocity, 'vx');
  const velocityVy = world.getFieldArray(Velocity, 'vy');
  const healthCurrent = world.getFieldArray(Health, 'current');
  const healthMax = world.getFieldArray(Health, 'max');
  const armorValue = world.getFieldArray(Armor, 'value');
  const damageAmount = world.getFieldArray(Damage, 'amount');
  const cooldownCurrent = world.getFieldArray(Cooldown, 'current');
  const cooldownMax = world.getFieldArray(Cooldown, 'max');
  const targetEntityId = world.getFieldArray(Target, 'entityId');
  const statusStunned = world.getFieldArray(Status, 'stunned');
  const statusSlowed = world.getFieldArray(Status, 'slowed');
  const lifetimeRemaining = world.getFieldArray(Lifetime, 'remaining');

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

    // Movement system (raw array access)
    const movementEntities = world.query(Transform2D, Velocity);
    for (let i = 0; i < movementEntities.length; i++) {
      const eid = movementEntities[i]!;
      transformX[eid]! += velocityVx[eid]! * deltaTime;
      transformY[eid]! += velocityVy[eid]! * deltaTime;
    }

    // Rotation system
    for (let i = 0; i < movementEntities.length; i++) {
      const eid = movementEntities[i]!;
      const vx = velocityVx[eid]!;
      const vy = velocityVy[eid]!;

      if (vx !== 0 || vy !== 0) {
        transformRot[eid] = Math.atan2(vy, vx);
      }
    }

    // Boundary system
    const boundaryEntities = world.query(Transform2D);
    for (let i = 0; i < boundaryEntities.length; i++) {
      const eid = boundaryEntities[i]!;
      if (transformX[eid]! < 0) transformX[eid]! = 1000;
      if (transformX[eid]! > 1000) transformX[eid]! = 0;
      if (transformY[eid]! < 0) transformY[eid]! = 1000;
      if (transformY[eid]! > 1000) transformY[eid]! = 0;
    }

    // Health regen system
    if (frame % 30 === 0) {
      const healthEntities = world.query(Health);

      for (let i = 0; i < healthEntities.length; i++) {
        const eid = healthEntities[i]!;
        const current = healthCurrent[eid]!;
        const max = healthMax[eid]!;

        if (current > 0 && current < max) {
          const newHealth = current + 5;
          healthCurrent[eid] = newHealth > max ? max : newHealth;
        }
      }
    }

    // Cooldown system
    const cooldownEntities = world.query(Cooldown);
    for (let i = 0; i < cooldownEntities.length; i++) {
      const eid = cooldownEntities[i]!;

      if (cooldownCurrent[eid]! > 0) {
        const newCooldown = cooldownCurrent[eid]! - deltaTime;
        cooldownCurrent[eid] = newCooldown < 0 ? 0 : newCooldown;
      }
    }

    // Combat system
    if (frame % 5 === 0) {
      const combatEntities = world.query(Cooldown, Damage, Target);
      const updates: Array<{ targetId: number; newHealth: number; attackerId: number }> = [];

      for (let i = 0; i < combatEntities.length; i++) {
        const eid = combatEntities[i]!;
        const cooldown = cooldownCurrent[eid]!;
        const damage = damageAmount[eid]!;
        const targetId = targetEntityId[eid]!;

        if (cooldown === 0 && world.isAlive(targetId) && world.has(targetId, Health)) {
          const targetHealth = healthCurrent[targetId]!;
          let damageDealt = damage;

          // Apply armor reduction
          if (world.has(targetId, Armor)) {
            const armor = armorValue[targetId]!;
            const reduced = damage - armor * 0.1;
            damageDealt = reduced < 1 ? 1 : Math.floor(reduced);
          }

          const newHealth = targetHealth > damageDealt ? targetHealth - damageDealt : 0;
          updates.push({ targetId, newHealth, attackerId: eid });
        }
      }

      // Apply all updates
      for (const { targetId, newHealth, attackerId } of updates) {
        if (world.isAlive(targetId)) {
          healthCurrent[targetId] = newHealth;
        }

        // Reset cooldown
        cooldownCurrent[attackerId] = cooldownMax[attackerId]!;
      }
    }

    // Death system
    const deathEntities = world.query(Health);
    const toRemove: number[] = [];
    for (let i = 0; i < deathEntities.length; i++) {
      const eid = deathEntities[i]!;

      if (healthCurrent[eid] === 0) {
        toRemove.push(eid);
      }
    }
    for (const eid of toRemove) {
      world.despawn(eid);
    }

    // Status effect system
    const statusEntities = world.query(Status, Velocity);
    for (let i = 0; i < statusEntities.length; i++) {
      const eid = statusEntities[i]!;
      const stunned = statusStunned[eid];
      const slowed = statusSlowed[eid];

      if (stunned === 1) {
        velocityVx[eid] = 0;
        velocityVy[eid] = 0;
      } else if (slowed === 1) {
        velocityVx[eid]! *= 0.5;
        velocityVy[eid]! *= 0.5;
      }
    }

    // Lifetime system
    const lifetimeEntities = world.query(Lifetime);
    const expiredEntities: number[] = [];
    for (let i = 0; i < lifetimeEntities.length; i++) {
      const eid = lifetimeEntities[i]!;
      const remaining = lifetimeRemaining[eid]! - deltaTime;

      if (remaining <= 0) {
        expiredEntities.push(eid);
      } else {
        lifetimeRemaining[eid] = remaining;
      }
    }

    for (const eid of expiredEntities) {
      world.despawn(eid);
    }

    // Velocity damping system
    const velocityEntities = world.query(Velocity);
    for (let i = 0; i < velocityEntities.length; i++) {
      const eid = velocityEntities[i]!;

      velocityVx[eid]! *= 0.99;
      velocityVy[eid]! *= 0.99;
    }

    // AI behavior system
    if (frame % 20 === 0) {
      const rng = new SimpleRng(frame);
      for (let i = 0; i < velocityEntities.length; i++) {
        const eid = velocityEntities[i]!;

        if (rng.nextF32() > 0.9) {
          velocityVx[eid]! += (rng.nextF32() - 0.5) * 2;
          velocityVy[eid]! += (rng.nextF32() - 0.5) * 2;
        }
      }
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
  console.log("Murow RAW API Benchmark - Complex Game Simulation (11 Systems)\n");
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
