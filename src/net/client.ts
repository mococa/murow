import type { IntentRegistry } from "../protocol/intent/intent-registry";
import type { SnapshotRegistry } from "../protocol/snapshot/snapshot-registry";
import type { Snapshot } from "../protocol/snapshot/snapshot";
import type { Intent } from "../protocol/intent/intent";
import { MessageType, type TransportAdapter, type NetworkConfig } from "./types";

/**
 * Configuration for ClientNetwork
 */
export interface ClientNetworkConfig<TSnapshots> {
	/** Transport adapter for server connection */
	transport: TransportAdapter;

	/** Intent registry for encoding client intents */
	intentRegistry: IntentRegistry;

	/** Snapshot registry for decoding server snapshots */
	snapshotRegistry: SnapshotRegistry<TSnapshots>;

	/** Network configuration */
	config?: NetworkConfig;
}

/**
 * Generic game client for multiplayer networking
 * Handles intent sending and snapshot receiving with full type safety
 *
 * @template TSnapshots Union type of all possible snapshot update types
 *
 * @example
 * ```ts
 * type GameSnapshots = PlayerUpdate | ScoreUpdate | ProjectileUpdate;
 *
 * const client = new ClientNetwork<GameSnapshots>({
 *   transport: wsTransport,
 *   intentRegistry,
 *   snapshotRegistry,
 * });
 *
 * // Type-safe snapshot handlers
 * client.onSnapshot<PlayerUpdate>('players', (snapshot) => {
 *   snapshot.updates.players // ✅ Correctly typed
 * });
 * ```
 */
export class ClientNetwork<TSnapshots = unknown> {
	private transport: TransportAdapter;
	private intentRegistry: IntentRegistry;
	private snapshotRegistry: SnapshotRegistry<TSnapshots>;
	private config: Required<NetworkConfig>;

	/** Snapshot type handlers: type -> handler[] (supports multiple handlers) */
	private snapshotHandlers = new Map<string, Array<(snapshot: Snapshot<any>) => void>>();

	/** Connection lifecycle handlers */
	private connectHandlers: Array<() => void> = [];
	private disconnectHandlers: Array<() => void> = [];
	private errorHandlers: Array<(error: Error) => void> = [];

	/** Connection state */
	private connected = false;

	/** Rate limiting state */
	private messageCount = 0;
	private messageCountWindow = Date.now();

	/** Heartbeat timer */
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	/** Last time we received a message from server */
	private lastMessageReceivedAt = Date.now();

	constructor(config: ClientNetworkConfig<TSnapshots>) {
		this.transport = config.transport;
		this.intentRegistry = config.intentRegistry;
		this.snapshotRegistry = config.snapshotRegistry;
		this.config = {
			maxMessageSize: config.config?.maxMessageSize ?? 65536,
			debug: config.config?.debug ?? false,
			enableBufferPooling: config.config?.enableBufferPooling ?? true,
			maxMessagesPerSecond: config.config?.maxMessagesPerSecond ?? 60,
			maxSendQueueSize: config.config?.maxSendQueueSize ?? 100,
			heartbeatInterval: config.config?.heartbeatInterval ?? 30000,
			heartbeatTimeout: config.config?.heartbeatTimeout ?? 60000,
		};

		this.setupTransportHandlers();
		this.setupHeartbeat();
	}

	/**
	 * Send an intent to the server (type-safe)
	 */
	sendIntent<T extends Intent>(intent: T): void {
		if (!this.connected) {
			this.log("Cannot send intent: not connected");
			return;
		}

		// Client-side rate limiting
		if (!this.checkRateLimit()) {
			this.log("Rate limit exceeded, dropping intent");
			return;
		}

		try {
			// Encode intent
			const intentData = this.intentRegistry.encode(intent);

			// Wrap with message type header
			const message = new Uint8Array(1 + intentData.byteLength);
			message[0] = MessageType.INTENT;
			message.set(intentData, 1);

			// Send to server
			this.transport.send(message);

			this.log(`Sent intent (kind: ${intent.kind}, tick: ${intent.tick})`);
		} catch (error) {
			this.log(`Failed to send intent: ${error}`);
		}
	}

	/**
	 * Register a handler for a specific snapshot type (type-safe)
	 * Supports multiple handlers per snapshot type
	 * @template T The specific snapshot update type for this handler
	 * @returns Unsubscribe function to remove this handler
	 */
	onSnapshot<T extends Partial<TSnapshots>>(
		type: string,
		handler: (snapshot: Snapshot<T>) => void
	): () => void {
		let handlers = this.snapshotHandlers.get(type);
		if (!handlers) {
			handlers = [];
			this.snapshotHandlers.set(type, handlers);
		}
		handlers.push(handler as (snapshot: Snapshot<any>) => void);

		// Return unsubscribe function
		return () => {
			const handlers = this.snapshotHandlers.get(type);
			if (handlers) {
				const index = handlers.indexOf(handler as (snapshot: Snapshot<any>) => void);
				if (index > -1) {
					handlers.splice(index, 1);
				}
			}
		};
	}

	/**
	 * Register a handler for connection events
	 */
	onConnect(handler: () => void): () => void {
		this.connectHandlers.push(handler);
		return () => {
			const index = this.connectHandlers.indexOf(handler);
			if (index > -1) this.connectHandlers.splice(index, 1);
		};
	}

	/**
	 * Register a handler for disconnection events
	 */
	onDisconnect(handler: () => void): () => void {
		this.disconnectHandlers.push(handler);
		return () => {
			const index = this.disconnectHandlers.indexOf(handler);
			if (index > -1) this.disconnectHandlers.splice(index, 1);
		};
	}

	/**
	 * Register a handler for transport errors
	 */
	onError(handler: (error: Error) => void): () => void {
		this.errorHandlers.push(handler);
		return () => {
			const index = this.errorHandlers.indexOf(handler);
			if (index > -1) this.errorHandlers.splice(index, 1);
		};
	}

	/**
	 * Check if connected to server
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Disconnect from server
	 */
	disconnect(): void | Promise<void> {
		this.log("Disconnecting...");

		// Stop heartbeat timer
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}

		return this.transport.close();
	}

	/**
	 * Setup transport event handlers
	 */
	private setupTransportHandlers(): void {
		this.transport.onMessage((data) => {
			this.handleMessage(data);
		});

		this.transport.onClose(() => {
			this.handleDisconnection();
		});

		// Setup error handler if transport supports it
		if (this.transport.onError) {
			this.transport.onError((error) => {
				this.handleError(error);
			});
		}

		// Mark as connected immediately (some transports may not have explicit connect events)
		this.connected = true;
		this.lastMessageReceivedAt = Date.now();
		this.notifyConnectHandlers();
	}

	/**
	 * Setup heartbeat mechanism
	 */
	private setupHeartbeat(): void {
		if (this.config.heartbeatInterval === 0) {
			return; // Heartbeats disabled
		}

		this.heartbeatTimer = setInterval(() => {
			this.checkHeartbeat();
		}, this.config.heartbeatInterval);
	}

	/**
	 * Check server heartbeat timeout and send heartbeat
	 */
	private checkHeartbeat(): void {
		const now = Date.now();
		const timeSinceLastMessage = now - this.lastMessageReceivedAt;

		// Check if server has timed out
		if (timeSinceLastMessage > this.config.heartbeatTimeout) {
			this.log(`Server timed out (no message for ${timeSinceLastMessage}ms)`);
			this.disconnect();
			return;
		}

		// Send heartbeat to server
		try {
			const heartbeatMessage = new Uint8Array([MessageType.HEARTBEAT]);
			this.transport.send(heartbeatMessage);
		} catch (error) {
			this.log(`Failed to send heartbeat: ${error}`);
		}
	}

	/**
	 * Handle incoming message from server
	 */
	private handleMessage(data: Uint8Array): void {
		// Update last message received timestamp
		this.lastMessageReceivedAt = Date.now();

		if (data.byteLength === 0) {
			this.log("Received empty message from server");
			return;
		}

		if (data.byteLength > this.config.maxMessageSize) {
			this.log(`Message exceeds max size: ${data.byteLength} > ${this.config.maxMessageSize}`);
			return;
		}

		const messageType = data[0];
		const payload = data.subarray(1);

		switch (messageType) {
			case MessageType.SNAPSHOT:
				this.handleSnapshot(payload);
				break;
			case MessageType.HEARTBEAT:
				// Heartbeat received - already updated lastMessageReceivedAt above
				this.log("Received heartbeat from server");
				break;
			case MessageType.CUSTOM:
				// Could add custom message handlers here
				this.log("Received custom message from server");
				break;
			default:
				this.log(`Unknown message type: ${messageType}`);
		}
	}

	/**
	 * Decode and handle a snapshot from server
	 */
	private handleSnapshot(data: Uint8Array): void {
		try {
			// Decode using snapshot registry (returns { type, snapshot })
			const decoded = this.snapshotRegistry.decode<Partial<TSnapshots>>(data);

			this.log(`Received snapshot (type: ${decoded.type}, tick: ${decoded.snapshot.tick})`);

			// Call all type-specific handlers if registered
			const handlers = this.snapshotHandlers.get(decoded.type);
			if (handlers && handlers.length > 0) {
				for (const handler of handlers) {
					try {
						handler(decoded.snapshot);
					} catch (error) {
						this.log(`Error in snapshot handler: ${error}`);
					}
				}
			} else {
				this.log(`No handler registered for snapshot type: ${decoded.type}`);
			}
		} catch (error) {
			this.log(`Failed to decode snapshot: ${error}`);
		}
	}

	/**
	 * Handle disconnection from server
	 */
	private handleDisconnection(): void {
		this.log("Disconnected from server");
		this.connected = false;

		// Stop heartbeat timer
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}

		this.notifyDisconnectHandlers();
	}

	/**
	 * Notify connect handlers
	 */
	private notifyConnectHandlers(): void {
		for (const handler of this.connectHandlers) {
			try {
				handler();
			} catch (error) {
				// Don't call log here as it might throw, use console.error directly
				if (this.config.debug) {
					console.error(`[ClientNetwork] Error in connect handler: ${error}`);
				}
			}
		}
	}

	/**
	 * Notify disconnect handlers
	 */
	private notifyDisconnectHandlers(): void {
		for (const handler of this.disconnectHandlers) {
			try {
				handler();
			} catch (error) {
				// Don't call log here as it might throw, use console.error directly
				if (this.config.debug) {
					console.error(`[ClientNetwork] Error in disconnect handler: ${error}`);
				}
			}
		}
	}

	/**
	 * Handle transport errors
	 */
	private handleError(error: Error): void {
		this.log(`Transport error: ${error.message}`);
		this.notifyErrorHandlers(error);
	}

	/**
	 * Notify error handlers
	 */
	private notifyErrorHandlers(error: Error): void {
		for (const handler of this.errorHandlers) {
			try {
				handler(error);
			} catch (err) {
				this.log(`Error in error handler: ${err}`);
			}
		}
	}

	/**
	 * Check client-side rate limit
	 * Returns true if message should be sent, false if rate limit exceeded
	 */
	private checkRateLimit(): boolean {
		if (this.config.maxMessagesPerSecond === 0) {
			return true; // Rate limiting disabled
		}

		const now = Date.now();
		const windowStart = Math.floor(now / 1000) * 1000; // Start of current second

		// Reset counter if we're in a new time window
		if (this.messageCountWindow !== windowStart) {
			this.messageCountWindow = windowStart;
			this.messageCount = 0;
		}

		// Check if limit would be exceeded BEFORE incrementing
		if (this.messageCount >= this.config.maxMessagesPerSecond) {
			return false;
		}

		// Only increment if we're allowing this message
		this.messageCount++;
		return true;
	}

	/**
	 * Debug logging
	 */
	private log(message: string): void {
		if (this.config.debug) {
			console.log(`[ClientNetwork] ${message}`);
		}
	}
}
