import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { wsService, type ConnectionStatus } from '../services/ws';
import { getUsername } from '../utils/jwtDecoder';

export interface GlobalNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  metadata?: any;
}

interface WebSocketContextType {
  connectionStatus: ConnectionStatus;
  notifications: GlobalNotification[];
  unreadCount: number;
  subscribe: (destination: string, callback: (payload: any) => void) => (() => void) | undefined;
  send: (destination: string, body: any) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [notifications, setNotifications] = useState<GlobalNotification[]>([]);

  // Use a ref to track processed message IDs for deduplication
  const processedMessageIds = useRef(new Set<string>());

  // ─── 1. Connect once on mount using the shared singleton ──────────────────
  // wsService is a module-level singleton so remounts don't create a new instance.
  useEffect(() => {
    const token = localStorage.getItem('token');
    const user = getUsername();

    if (!token || token === 'undefined' || !user) return;

    // onMessage is NOT passed here — messages are handled only inside subscribe()
    // to avoid the double-handling bug.
    wsService.connect(token, setConnectionStatus, () => {});

    return () => {
      wsService.disconnect();
      processedMessageIds.current.clear();
    };
  }, []); // runs once on mount

  // ─── 2. Subscribe when connected, re-subscribe after reconnects ───────────
  // Watching connectionStatus means this re-runs every time we reconnect,
  // which re-establishes the subscription automatically after a drop.
  useEffect(() => {
    if (connectionStatus !== 'connected') return;

    const user = getUsername();
    if (!user) return;

    console.log('🔌 Subscribing to notifications for:', user);

    const unsub = wsService.subscribe(`/topic/match-pop/${user}`, (payload) => {
      console.log('📬 Received:', payload.notificationType);
      handleWebSocketMessage(payload);
    });

    // Cleanup unsubscribes when status changes away from 'connected'
    return () => unsub?.();
  }, [connectionStatus]);

  // ─── 3. Message handler (stable, no deps) ────────────────────────────────
  const handleWebSocketMessage = (message: any) => {
    // Use server-provided ID if available, else build a unique key
    const messageId: string =
      message.id ??
      `${message.notificationType}-${message.matchId ?? ''}-${message.senderUsername ?? ''}-${Date.now()}`;

    if (processedMessageIds.current.has(messageId)) {
      console.log('🚫 Skipping duplicate:', messageId);
      return;
    }

    processedMessageIds.current.add(messageId);

    // Keep the dedup set from growing forever
    if (processedMessageIds.current.size > 100) {
      const entries = Array.from(processedMessageIds.current);
      entries.slice(0, 50).forEach(id => processedMessageIds.current.delete(id));
    }

    const notification = mapWebSocketMessageToNotification(message);
    if (!notification) return;

    setNotifications(prev => {
      // Secondary guard: skip if identical notification arrived within 2 s
      const isDuplicate = prev.some(
        n =>
          n.title === notification.title &&
          n.message === notification.message &&
          Date.now() - n.timestamp.getTime() < 2000
      );

      if (isDuplicate) {
        console.log('🚫 Duplicate in state, skipping');
        return prev;
      }

      console.log('✅ Adding notification:', notification.title);
      return [notification, ...prev].slice(0, 50);
    });
  };

  // ─── 4. Expose subscribe / send through context ───────────────────────────
  // Components that need their own topic can call these directly.
  const subscribe = useCallback(
    (destination: string, callback: (payload: any) => void) =>
      wsService.subscribe(destination, callback),
    []
  );

  const send = useCallback((destination: string, body: any) => {
    wsService.send(destination, body);
  }, []);

  // ─── 5. Notification management ───────────────────────────────────────────
  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <WebSocketContext.Provider
      value={{
        connectionStatus,
        notifications,
        unreadCount,
        subscribe,
        send,
        markAsRead,
        markAllAsRead,
        removeNotification,
        clearAll,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) throw new Error('useWebSocket must be used within WebSocketProvider');
  return context;
};

// ─── Message → Notification mapper ────────────────────────────────────────────
function mapWebSocketMessageToNotification(message: any): GlobalNotification | null {
  const base: Omit<GlobalNotification, 'type' | 'title' | 'message'> = {
    id: `${Date.now()}-${Math.random()}`,
    timestamp: new Date(),
    read: false,
    metadata: message,
  };

  switch (message.notificationType) {
    case 'MATCH_STARTED':
      return { ...base, type: 'success', title: 'Match started!', message: 'Your match has begun. Good luck!' };

    case 'MATCH_COMPLETED':
      return { ...base, type: 'info', title: 'Match completed', message: 'The match has ended. Check your results!' };

    case 'USER_RESIGNED':
      return { ...base, type: 'success', title: 'Opponent resigned', message: `${message.senderUsername} has resigned from the match.` };

    case 'SUBMISSION_RECEIVED':
      return { ...base, type: 'info', title: 'Code submitted', message: `${message.senderUsername} submitted a solution` };

    case 'SUBMISSION_RESULT': {
      const accepted = message.submissionStatus === 'ACCEPTED';
      return {
        ...base,
        type: accepted ? 'success' : 'error',
        title: accepted ? 'Solution accepted' : 'Submission failed',
        message: `${message.senderUsername} ${accepted ? 'passed' : 'failed'} ${message.passedCases}/${message.totalCases} test cases`,
      };
    }

    case 'FRIEND_REQUEST_RECEIVED':
      return { ...base, type: 'info', title: 'New friend request', message: `${message.senderUsername} sent you a friend request` };

    case 'FRIEND_REQUEST_ACCEPTED':
      return { ...base, type: 'success', title: 'Friend request accepted', message: `${message.accepterUsername} accepted your friend request` };

    default:
      return { ...base, type: 'info', title: message.title ?? 'Notification', message: message.message ?? 'You have a new notification' };
  }
}