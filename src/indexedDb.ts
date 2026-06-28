import { Message } from "./types";

const DB_NAME = "ChatAppOfflineDB";
const DB_VERSION = 2;

export function getConversationKey(userId1: string, userId2: string): string {
  if (userId1 && userId1.startsWith("group_")) return userId1;
  if (userId2 && userId2.startsWith("group_")) return userId2;
  return [userId1, userId2].sort().join(":");
}

export function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("IndexedDB open error:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;

      // Store cached messages
      if (!db.objectStoreNames.contains("messages")) {
        const messageStore = db.createObjectStore("messages", { keyPath: "id" });
        messageStore.createIndex("by_conversationKey", "conversationKey", { unique: false });
      } else {
        // Upgrade existing store if needed
        const tx = (event.target as IDBOpenDBRequest).transaction;
        const messageStore = tx?.objectStore("messages");
        if (messageStore && !messageStore.indexNames.contains("by_conversationKey")) {
          messageStore.createIndex("by_conversationKey", "conversationKey", { unique: false });
        }
      }

      // Store drafting inputs per conversation
      if (!db.objectStoreNames.contains("drafts")) {
        db.createObjectStore("drafts", { keyPath: "conversationKey" });
      }
    };
  });
}

// Save messages to IndexedDB
export async function saveMessages(messages: Message[]): Promise<void> {
  if (messages.length === 0) return;
  
  try {
    const db = await initDB();
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");

    for (const msg of messages) {
      let conversationKey = "";
      if (msg.senderId === "system") {
        conversationKey = msg.receiverId; // stored as conversation key on the backend
      } else {
        conversationKey = getConversationKey(msg.senderId, msg.receiverId);
      }

      const rawMsg = {
        ...msg,
        conversationKey,
      };
      store.put(rawMsg);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to save messages to IndexedDB:", err);
  }
}

// Fetch messages from IndexedDB for a conversation pair
export async function getCachedMessages(userId1: string, userId2: string): Promise<Message[]> {
  try {
    const db = await initDB();
    const tx = db.transaction("messages", "readonly");
    const store = tx.objectStore("messages");
    const index = store.index("by_conversationKey");
    
    const key = getConversationKey(userId1, userId2);
    const request = index.getAll(IDBKeyRange.only(key));

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const results = request.result as Message[];
        // Sort by timestamp to ensure correct chronological sequence
        results.sort((a, b) => a.timestamp - b.timestamp);
        
        // Filter out expired disappearing messages
        const now = Date.now();
        const validResults = results.filter((m) => !m.expiresAt || m.expiresAt > now);
        
        resolve(validResults);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to get messages from IndexedDB:", err);
    return [];
  }
}

// Store draft message for a conversation pair
export async function saveDraft(userId1: string, userId2: string, text: string): Promise<void> {
  const key = getConversationKey(userId1, userId2);
  try {
    const db = await initDB();
    const tx = db.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");

    if (text.trim() === "") {
      store.delete(key);
    } else {
      store.put({
        conversationKey: key,
        text,
        updatedAt: Date.now(),
      });
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to save draft to IndexedDB:", err);
  }
}

// Retrieve draft message for a conversation pair
export async function getDraft(userId1: string, userId2: string): Promise<string> {
  const key = getConversationKey(userId1, userId2);
  try {
    const db = await initDB();
    const tx = db.transaction("drafts", "readonly");
    const store = tx.objectStore("drafts");
    const request = store.get(key);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.text : "");
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to fetch draft from IndexedDB:", err);
    return "";
  }
}

// Retrieve all locally queued/pending offline messages
export async function getPendingMessages(): Promise<Message[]> {
  try {
    const db = await initDB();
    const tx = db.transaction("messages", "readonly");
    const store = tx.objectStore("messages");
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const results = request.result as Message[];
        const pending = results.filter((m) => m.isPending === true);
        resolve(pending);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to get pending messages:", err);
    return [];
  }
}

// Delete message by id from IndexedDB
export async function deleteMessage(id: string): Promise<void> {
  try {
    const db = await initDB();
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    store.delete(id);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to delete message from IndexedDB:", err);
  }
}

// Delete draft message for a conversation pair
export async function deleteDraft(userId1: string, userId2: string): Promise<void> {
  const key = getConversationKey(userId1, userId2);
  try {
    const db = await initDB();
    const tx = db.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");
    store.delete(key);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to delete draft from IndexedDB:", err);
  }
}
