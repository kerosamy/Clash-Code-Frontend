import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export class EnhancedWebSocketService {
  private client: Client | null = null;
  private subscriptions: Map<string, StompSubscription> = new Map();
  private statusCallback?: (status: ConnectionStatus) => void;
  private messageCallback?: (message: any) => void;
  private persistentReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isManuallyStopped = false;
  private token: string = '';

  private readonly WS_URL = 'wss://fugally-nonrepatriable-belle.ngrok-free.dev/ws';
  private readonly RECONNECT_DELAY = 5000;

  connect(
    token: string,
    onStatusChange: (status: ConnectionStatus) => void,
    onMessage: (msg: any) => void
  ) {
    this.token = token;
    this.statusCallback = onStatusChange;
    this.messageCallback = onMessage;
    this.isManuallyStopped = false;
    this._createAndActivate();
  }

  private _createAndActivate() {
    if (this.isManuallyStopped) return;

    if (this.client) {
      this.client.deactivate();
      this.client = null;
    }

    this.statusCallback?.('connecting');

    this.client = new Client({
      brokerURL: this.WS_URL,
      reconnectDelay: this.RECONNECT_DELAY,
      heartbeatIncoming: 20000,
      heartbeatOutgoing: 20000,
      connectHeaders: this.token ? { Authorization: `Bearer ${this.token}` } : {},

      debug: (str) => {
        if (str.includes('ERROR')) console.error('STOMP:', str);
      },

      onConnect: () => {
        console.log('✅ WebSocket connected');
        this._clearPersistentTimer();
        this.statusCallback?.('connected');
      },

      onDisconnect: () => {
        console.log('❌ WebSocket disconnected');
        this.subscriptions.clear();
        this.statusCallback?.('disconnected');
      },

      onStompError: (frame) => {
        console.error('❌ STOMP error:', frame.headers['message']);
        this.statusCallback?.('error');
        this._schedulePersistentReconnect();
      },

      onWebSocketError: () => {
        console.error('❌ WebSocket error — will retry');
        this.statusCallback?.('reconnecting');
        this._schedulePersistentReconnect();
      },
    });

    this.client.activate();
  }

  private _schedulePersistentReconnect() {
    if (this.isManuallyStopped || this.persistentReconnectTimer) return;

    console.log(`🔄 Reconnecting in ${this.RECONNECT_DELAY / 1000}s...`);
    this.statusCallback?.('reconnecting');

    this.persistentReconnectTimer = setTimeout(() => {
      this.persistentReconnectTimer = null;
      this._createAndActivate();
    }, this.RECONNECT_DELAY);
  }

  private _clearPersistentTimer() {
    if (this.persistentReconnectTimer) {
      clearTimeout(this.persistentReconnectTimer);
      this.persistentReconnectTimer = null;
    }
  }

  subscribe(destination: string, callback: (payload: any) => void): (() => void) | undefined {
    if (!this.client?.connected) {
      console.warn('⚠️ Cannot subscribe: not connected');
      return undefined;
    }

    const subscription = this.client.subscribe(destination, (message: IMessage) => {
      try {
        const payload = JSON.parse(message.body);
        this.messageCallback?.(payload);
        callback(payload);
      } catch (e) {
        console.error('❌ Failed to parse message:', e);
      }
    });

    this.subscriptions.set(destination, subscription);

    return () => {
      subscription.unsubscribe();
      this.subscriptions.delete(destination);
    };
  }

  send(destination: string, body: any) {
    if (!this.client?.connected) {
      console.warn('⚠️ Cannot send: not connected');
      return;
    }
    this.client.publish({ destination, body: JSON.stringify(body) });
  }

  disconnect() {
    console.log('Disconnecting WebSocket...');
    this.isManuallyStopped = true;
    this._clearPersistentTimer();
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions.clear();
    this.client?.deactivate();
    this.client = null;
    this.statusCallback?.('disconnected');
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }
}

// Module-level singleton — shared across the entire app.
// This prevents a new instance being created on every Provider remount.
export const wsService = new EnhancedWebSocketService();