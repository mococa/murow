# NavMesh / Pathfinding Utility

A lightweight navigation system for grid-based and hybrid games.

Supports:

* **Grid A*** pathfinding
* **Line-of-sight graph navigation**
* **Dynamic obstacles**
* **Spatial hashing for fast queries**
* **Circle / Rect / Polygon obstacles**
* **Zero rebuilds unless data changes**

Designed for **games**, not CAD-grade geometry.

---

## Features

* ⚡ **Fast obstacle queries** via spatial hash
* 🧠 **Smart rebuilds** (version-based, no unnecessary work)
* 🧩 **Multiple obstacle types**
* 🧭 **A*** with binary heap
* 🧱 **Grid or graph navigation**
* 🔁 Dynamic obstacle add / move / remove
* 🧪 Deterministic & allocation-safe

---

## Usage

### Create navmesh

```ts
const nav = new NavMesh('grid'); // or 'graph'
```

### Add obstacles

```ts
nav.addObstacle({
  type: 'circle',
  pos: { x: 5, y: 5 },
  radius: 2
});
```

```ts
nav.addObstacle({
  type: 'rect',
  pos: { x: 2, y: 3 },
  size: { x: 4, y: 2 },
});
```

```ts
nav.addObstacle({
  type: 'polygon',
  pos: { x: 10, y: 5 },
  points: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 2 },
  ],
});
```

### Move / remove

```ts
nav.moveObstacle(id, { x: 8, y: 4 });
nav.removeObstacle(id);
```

### Find path

```ts
const path = nav.findPath({
  from: { x: 1, y: 1 },
  to: { x: 10, y: 8 }
});
```

---

## Navigation Modes

### `grid`

* A* over grid cells
* Accurate
* Best for RTS / tactics / tile games

### `graph`

* Line-of-sight check
* Falls back to grid if blocked
* Faster for open maps

---

## Performance

| Feature        | Cost                              |
| -------------- | --------------------------------- |
| Obstacle query | **O(1)** avg                      |
| Grid rebuild   | O(n × area)                       |
| Pathfinding    | O(bᵈ log n)                       |
| Memory         | Minimal, no allocations per frame |

Handles:

* 1k+ obstacles
* 10k+ A* nodes
* Real-time updates

---

## Notes

* Polygon points **must be local (0,0-based)**
* Rotation is supported for rects & polygons
* All math is deterministic
* No dependencies
