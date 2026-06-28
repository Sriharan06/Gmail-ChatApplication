export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  lastSeen: number; // Unix timestamp
  isOnline: boolean;
  isGroup?: boolean;
  members?: string[];
  createdBy?: string;
}

export type MessageType = "text" | "image" | "file" | "system";
export type MessageStatus = "sent" | "delivered" | "read";

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string; // Message content or file base64 data
  type: MessageType;
  status: MessageStatus;
  timestamp: number;
  fileName?: string;
  fileSize?: string;
  reactions?: Record<string, string[]>; // emoji symbol -> array of user IDs who reacted
  expiresAt?: number; // timestamp in ms when the message should be pruned
  isPending?: boolean; // locally queued message while offline
}

export type CallType = "voice" | "video";
export type CallStatus = "ringing" | "connected" | "rejected" | "missed" | "disconnected" | "no-answer";

export interface CallLog {
  id: string;
  callerId: string;
  receiverId: string;
  type: CallType;
  status: CallStatus;
  timestamp: number;
  duration?: number; // in seconds
}

export interface Conversation {
  user: User;
  lastMessage?: Message;
  unreadCount: number;
}
