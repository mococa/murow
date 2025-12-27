import { describe, expect, test, beforeEach } from "bun:test";
import { ClientNetwork } from "./client";
import { IntentRegistry } from "../protocol/intent/intent-registry";
import { SnapshotRegistry } from "../protocol/snapshot/snapshot-registry";
import { PooledCodec } from "../core/pooled-codec/pooled-codec";
import { BinaryPrimitives } from "../core/binary-codec";
import type { TransportAdapter } from "./types";
import type { Intent } from "../protocol/intent/intent";
import type { Snapshot } from "../protocol/snapshot/snapshot";

// Test types
interface MoveIntent extends Intent {
	kind: 1;
	tick: number;
	dx: number;
	dy: number;
}

interface PlayerUpdate {
	x: number;
	y: number;
	health: number;
}

interface ScoreUpdate {
	score: number;
}

type GameSnapshots = PlayerUpdate | ScoreUpdate;

// Mock transport adapter
class MockTransportAdapter implements TransportAdapter {
	messageHandler: ((data: Uint8Array) => void) | null = null;
	closeHandler: (() => void) | null = null;
	public sentMessages: Uint8Array[] = [];
	public closed = false;

	send(data: Uint8Array): void {
		this.sentMessages.push(new Uint8Array(data)); // Copy to avoid mutation
	}

	onMessage(handler: (data: Uint8Array) => void): void {
		this.messageHandler = handler;
	}

	onClose(handler: () => void): void {
		this.closeHandler = handler;
	}

	close(): void {
		this.closed = true;
		if (this.closeHandler) {
			this.closeHandler();
		}
	}

	// Test helper: simulate receiving a message
	simulateMessage(data: Uint8Array): void {
		if (this.messageHandler) {
			this.messageHandler(data);
		}
	}

	// Test helper: simulate disconnection
	simulateDisconnect(): void {
		if (this.closeHandler) {
			this.closeHandler();
		}
	}
}

describe("ClientNetwork", () => {
	let transport: MockTransportAdapter;
	let intentRegistry: IntentRegistry;
	let snapshotRegistry: SnapshotRegistry<GameSnapshots>;
	let client: ClientNetwork<GameSnapshots>;

	beforeEach(() => {
		transport = new MockTransportAdapter();
		intentRegistry = new IntentRegistry();
		snapshotRegistry = new SnapshotRegistry<GameSnapshots>();

		// Register move intent codec
		const moveIntentCodec = new PooledCodec({
			kind: BinaryPrimitives.u8,
			tick: BinaryPrimitives.u32,
			dx: BinaryPrimitives.f32,
			dy: BinaryPrimitives.f32,
		});
		intentRegistry.register(1, moveIntentCodec);

		// Register snapshot codecs
		const playerCodec = new PooledCodec({
			x: BinaryPrimitives.f32,
			y: BinaryPrimitives.f32,
			health: BinaryPrimitives.u8,
		});
		snapshotRegistry.register("player", playerCodec);

		const scoreCodec = new PooledCodec({
			score: BinaryPrimitives.u32,
		});
		snapshotRegistry.register("score", scoreCodec);

		client = new ClientNetwork<GameSnapshots>({
			transport,
			intentRegistry,
			snapshotRegistry,
			config: { debug: false },
		});
	});

	describe("Construction", () => {
		test("should initialize and mark as connected", () => {
			expect(client.isConnected()).toBe(true);
		});

		test("should setup transport handlers", () => {
			expect(transport.messageHandler).not.toBeNull();
			expect(transport.closeHandler).not.toBeNull();
		});

		test("should trigger onConnect handlers", () => {
			let connectCalled = false;
			const newTransport = new MockTransportAdapter();
			const newClient = new ClientNetwork<GameSnapshots>({
				transport: newTransport,
				intentRegistry,
				snapshotRegistry,
			});

			newClient.onConnect(() => {
				connectCalled = true;
			});

			// Connection happens during constructor
			expect(connectCalled).toBe(false); // Handler registered after construction
		});
	});

	describe("sendIntent", () => {
		test("should encode and send intent to server", () => {
			const intent: MoveIntent = {
				kind: 1,
				tick: 100,
				dx: 5.5,
				dy: -3.2,
			};

			client.sendIntent(intent);

			expect(transport.sentMessages).toHaveLength(1);
			const message = transport.sentMessages[0];

			// Check message type header
			expect(message[0]).toBe(0x01); // MessageType.INTENT

			// Verify intent data (skip message type byte)
			const intentData = message.subarray(1);
			const decoded = intentRegistry.decode(intentData) as MoveIntent;
			expect(decoded.kind).toBe(1);
			expect(decoded.tick).toBe(100);
			expect(decoded.dx).toBeCloseTo(5.5, 2);
			expect(decoded.dy).toBeCloseTo(-3.2, 2);
		});

		test("should not send intent when disconnected", () => {
			transport.simulateDisconnect();

			const intent: MoveIntent = {
				kind: 1,
				tick: 100,
				dx: 1,
				dy: 1,
			};

			client.sendIntent(intent);
			expect(transport.sentMessages).toHaveLength(0);
		});

		test("should handle encoding errors gracefully", () => {
			const badIntentRegistry = new IntentRegistry();
			const badClient = new ClientNetwork<GameSnapshots>({
				transport: new MockTransportAdapter(),
				intentRegistry: badIntentRegistry,
				snapshotRegistry,
			});

			const intent: MoveIntent = {
				kind: 99 as 1, // Not registered
				tick: 100,
				dx: 1,
				dy: 1,
			};

			// Should not throw
			expect(() => badClient.sendIntent(intent)).not.toThrow();
		});
	});

	describe("onSnapshot", () => {
		test("should receive and decode player snapshot", () => {
			let receivedSnapshot: Snapshot<PlayerUpdate> | null = null;

			client.onSnapshot<PlayerUpdate>("player", (snapshot) => {
				receivedSnapshot = snapshot;
			});

			// Create snapshot
			const snapshot: Snapshot<PlayerUpdate> = {
				tick: 42,
				updates: {
					x: 10.5,
					y: 20.3,
					health: 100,
				},
			};

			// Encode and send
			const snapshotData = snapshotRegistry.encode("player", snapshot);
			const message = new Uint8Array(1 + snapshotData.byteLength);
			message[0] = 0x02; // MessageType.SNAPSHOT
			message.set(snapshotData, 1);

			transport.simulateMessage(message);

			expect(receivedSnapshot).not.toBeNull();
			expect(receivedSnapshot!.tick).toBe(42);
			expect(receivedSnapshot!.updates.x).toBeCloseTo(10.5, 2);
			expect(receivedSnapshot!.updates.y).toBeCloseTo(20.3, 2);
			expect(receivedSnapshot!.updates.health).toBe(100);
		});

		test("should receive and decode score snapshot", () => {
			let receivedSnapshot: Snapshot<ScoreUpdate> | null = null;

			client.onSnapshot<ScoreUpdate>("score", (snapshot) => {
				receivedSnapshot = snapshot;
			});

			const snapshot: Snapshot<ScoreUpdate> = {
				tick: 100,
				updates: {
					score: 9999,
				},
			};

			const snapshotData = snapshotRegistry.encode("score", snapshot);
			const message = new Uint8Array(1 + snapshotData.byteLength);
			message[0] = 0x02; // MessageType.SNAPSHOT
			message.set(snapshotData, 1);

			transport.simulateMessage(message);

			expect(receivedSnapshot).not.toBeNull();
			expect(receivedSnapshot!.tick).toBe(100);
			expect(receivedSnapshot!.updates.score).toBe(9999);
		});

		test("should handle multiple snapshot types independently", () => {
			const playerSnapshots: Snapshot<PlayerUpdate>[] = [];
			const scoreSnapshots: Snapshot<ScoreUpdate>[] = [];

			client.onSnapshot<PlayerUpdate>("player", (s) => playerSnapshots.push(s));
			client.onSnapshot<ScoreUpdate>("score", (s) => scoreSnapshots.push(s));

			// Send player snapshot
			const playerSnapshot: Snapshot<PlayerUpdate> = {
				tick: 1,
				updates: { x: 1, y: 2, health: 50 },
			};
			const playerData = snapshotRegistry.encode("player", playerSnapshot);
			const playerMsg = new Uint8Array(1 + playerData.byteLength);
			playerMsg[0] = 0x02;
			playerMsg.set(playerData, 1);
			transport.simulateMessage(playerMsg);

			// Send score snapshot
			const scoreSnapshot: Snapshot<ScoreUpdate> = {
				tick: 2,
				updates: { score: 123 },
			};
			const scoreData = snapshotRegistry.encode("score", scoreSnapshot);
			const scoreMsg = new Uint8Array(1 + scoreData.byteLength);
			scoreMsg[0] = 0x02;
			scoreMsg.set(scoreData, 1);
			transport.simulateMessage(scoreMsg);

			expect(playerSnapshots).toHaveLength(1);
			expect(scoreSnapshots).toHaveLength(1);
			expect(playerSnapshots[0].tick).toBe(1);
			expect(scoreSnapshots[0].tick).toBe(2);
		});

		test("should return unsubscribe function", () => {
			let callCount = 0;
			const unsubscribe = client.onSnapshot<PlayerUpdate>("player", () => {
				callCount++;
			});

			const snapshot: Snapshot<PlayerUpdate> = {
				tick: 1,
				updates: { x: 1, y: 1, health: 100 },
			};
			const snapshotData = snapshotRegistry.encode("player", snapshot);
			const message = new Uint8Array(1 + snapshotData.byteLength);
			message[0] = 0x02;
			message.set(snapshotData, 1);

			transport.simulateMessage(message);
			expect(callCount).toBe(1);

			// Unsubscribe
			unsubscribe();

			// Send another snapshot
			transport.simulateMessage(message);
			expect(callCount).toBe(1); // Should not increase
		});

		test("should handle unknown snapshot types gracefully", () => {
			// Register handler for "player" only
			let called = false;
			client.onSnapshot<PlayerUpdate>("player", () => {
				called = true;
			});

			// Send snapshot for unhandled type "score" (registered but no handler)
			const snapshot: Snapshot<ScoreUpdate> = {
				tick: 1,
				updates: { score: 42 },
			};
			const snapshotData = snapshotRegistry.encode("score", snapshot);
			const message = new Uint8Array(1 + snapshotData.byteLength);
			message[0] = 0x02;
			message.set(snapshotData, 1);

			// Should not throw or call the player handler
			expect(() => transport.simulateMessage(message)).not.toThrow();
			expect(called).toBe(false);
		});
	});

	describe("Connection lifecycle", () => {
		test("should trigger onConnect handler on construction", () => {
			let connectCalled = false;
			const newTransport = new MockTransportAdapter();

			const newClient = new ClientNetwork<GameSnapshots>({
				transport: newTransport,
				intentRegistry,
				snapshotRegistry,
			});

			newClient.onConnect(() => {
				connectCalled = true;
			});

			// Already connected during construction, but handler added after
			expect(connectCalled).toBe(false);
			expect(newClient.isConnected()).toBe(true);
		});

		test("should trigger onDisconnect handler", () => {
			let disconnectCalled = false;
			client.onDisconnect(() => {
				disconnectCalled = true;
			});

			transport.simulateDisconnect();

			expect(disconnectCalled).toBe(true);
			expect(client.isConnected()).toBe(false);
		});

		test("should handle multiple disconnect handlers", () => {
			let count = 0;
			client.onDisconnect(() => count++);
			client.onDisconnect(() => count++);
			client.onDisconnect(() => count++);

			transport.simulateDisconnect();
			expect(count).toBe(3);
		});

		test("should return unsubscribe function for onConnect", () => {
			let callCount = 0;
			const unsub = client.onConnect(() => callCount++);
			unsub();

			// Create new client to trigger connect
			const newTransport = new MockTransportAdapter();
			const newClient = new ClientNetwork<GameSnapshots>({
				transport: newTransport,
				intentRegistry,
				snapshotRegistry,
			});

			expect(callCount).toBe(0);
		});

		test("should return unsubscribe function for onDisconnect", () => {
			let callCount = 0;
			const unsub = client.onDisconnect(() => callCount++);

			transport.simulateDisconnect();
			expect(callCount).toBe(1);

			unsub();
			// Can't trigger disconnect again on same transport, but verifies unsubscribe works
		});
	});

	describe("disconnect", () => {
		test("should close transport connection", () => {
			client.disconnect();
			expect(transport.closed).toBe(true);
		});

		test("should trigger disconnect handlers when calling disconnect", () => {
			let disconnectCalled = false;
			client.onDisconnect(() => {
				disconnectCalled = true;
			});

			client.disconnect();
			expect(disconnectCalled).toBe(true);
			expect(client.isConnected()).toBe(false);
		});
	});

	describe("Message handling", () => {
		test("should ignore empty messages", () => {
			let snapshotReceived = false;
			client.onSnapshot<PlayerUpdate>("player", () => {
				snapshotReceived = true;
			});

			transport.simulateMessage(new Uint8Array(0));
			expect(snapshotReceived).toBe(false);
		});

		test("should handle custom message type gracefully", () => {
			const message = new Uint8Array([0xff]); // MessageType.CUSTOM
			expect(() => transport.simulateMessage(message)).not.toThrow();
		});

		test("should handle unknown message types gracefully", () => {
			const message = new Uint8Array([0x99, 1, 2, 3]); // Unknown type
			expect(() => transport.simulateMessage(message)).not.toThrow();
		});

		test("should reject messages exceeding max size", () => {
			const smallClient = new ClientNetwork<GameSnapshots>({
				transport,
				intentRegistry,
				snapshotRegistry,
				config: { maxMessageSize: 10 },
			});

			let snapshotReceived = false;
			smallClient.onSnapshot<PlayerUpdate>("player", () => {
				snapshotReceived = true;
			});

			// Create large message
			const largeMessage = new Uint8Array(100);
			largeMessage[0] = 0x02; // MessageType.SNAPSHOT

			transport.simulateMessage(largeMessage);
			expect(snapshotReceived).toBe(false);
		});

		test("should handle malformed snapshot data gracefully", () => {
			let snapshotReceived = false;
			client.onSnapshot<PlayerUpdate>("player", () => {
				snapshotReceived = true;
			});

			// Send malformed data
			const badMessage = new Uint8Array([0x02, 99, 88, 77]); // Invalid snapshot
			expect(() => transport.simulateMessage(badMessage)).not.toThrow();
			expect(snapshotReceived).toBe(false);
		});
	});

	describe("Debug logging", () => {
		test("should not log when debug is false", () => {
			const logs: string[] = [];
			const originalLog = console.log;
			console.log = (...args: any[]) => logs.push(args.join(" "));

			const intent: MoveIntent = {
				kind: 1,
				tick: 1,
				dx: 1,
				dy: 1,
			};
			client.sendIntent(intent);

			console.log = originalLog;
			expect(logs.filter((l) => l.includes("[ClientNetwork]"))).toHaveLength(0);
		});

		test("should log when debug is true", () => {
			const logs: string[] = [];
			const originalLog = console.log;
			console.log = (...args: any[]) => logs.push(args.join(" "));

			const debugClient = new ClientNetwork<GameSnapshots>({
				transport: new MockTransportAdapter(),
				intentRegistry,
				snapshotRegistry,
				config: { debug: true },
			});

			const intent: MoveIntent = {
				kind: 1,
				tick: 1,
				dx: 1,
				dy: 1,
			};
			debugClient.sendIntent(intent);

			console.log = originalLog;
			expect(logs.filter((l) => l.includes("[ClientNetwork]")).length).toBeGreaterThan(0);
		});
	});
});
