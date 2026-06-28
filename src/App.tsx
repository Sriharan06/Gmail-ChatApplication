import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import {
  Search,
  Plus,
  Send,
  Image,
  Paperclip,
  Smile,
  LogOut,
  Moon,
  Sun,
  Video,
  Phone,
  MessageSquare,
  History,
  Check,
  CheckCheck,
  FileText,
  User as UserIcon,
  Users,
  X,
  PlusCircle,
  Menu,
  ChevronLeft,
  Mail,
  Timer,
  Forward,
  Download,
  CheckCircle,
  Server,
  Key,
  AlertTriangle,
  Edit2,
  AlertCircle
} from "lucide-react";

import { User, Message, CallLog, Conversation, MessageType } from "./types";
import { motion, AnimatePresence } from "motion/react";
import {
  saveMessages,
  getCachedMessages,
  saveDraft,
  getDraft,
  deleteDraft,
  getPendingMessages,
  deleteMessage,
  getConversationKey
} from "./indexedDb";
import GoogleSignIn from "./components/GoogleSignIn";
import EmojiPicker from "./components/EmojiPicker";
import CallOverlay from "./components/CallOverlay";

export default function App() {
  // Authentication & Mode states
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("gmail_chat_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem("gmail_chat_dark_mode") === "true";
  });

  // Deep link reply draft state
  const [pendingLinkReply, setPendingLinkReply] = useState<{ replyTo: string; draft: string } | null>(null);

  // UI state variables
  const [activeContact, setActiveContact] = useState<User | null>(null);
  const [contacts, setContacts] = useState<Record<string, User>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [searchContactEmail, setSearchContactEmail] = useState("");
  const [searchSidebarQuery, setSearchSidebarQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [activeMessageMenuId, setActiveMessageMenuId] = useState<string | null>(null);

  // Local message keyword search states
  const [showLocalSearch, setShowLocalSearch] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [localSearchMode, setLocalSearchMode] = useState<"filter" | "highlight">("highlight");

  // Disappearing messages states
  const [activeDisappearingDuration, setActiveDisappearingDuration] = useState<number>(0);
  const [showDisappearingMenu, setShowDisappearingMenu] = useState(false);

  // Network connection / offline support state
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Control toggles
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  const [showCallHistoryPane, setShowCallHistoryPane] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(true);

  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);

  // Forward message states
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [forwardSearchQuery, setForwardSearchQuery] = useState("");
  const [forwardStatusAlert, setForwardStatusAlert] = useState<{
    profile: User;
  } | null>(null);

  // Companion app states
  const [appDownloaded, setAppDownloaded] = useState<boolean>(() => {
    return localStorage.getItem("app_downloaded") === "true";
  });
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const handleDownloadApp = () => {
    setIsDownloading(true);
    setTimeout(() => {
      setIsDownloading(false);
      setAppDownloaded(true);
      localStorage.setItem("app_downloaded", "true");
    }, 2000);
  };

  // Email Server Configuration States
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [nicknames, setNicknames] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("contact_nicknames");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [editingNickname, setEditingNickname] = useState("");
  const [isEditingNicknameField, setIsEditingNicknameField] = useState(false);
  const [reportText, setReportText] = useState("");
  const [reportSuccessMsg, setReportSuccessMsg] = useState("");
  const [isReporting, setIsReporting] = useState(false);

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailConfigInput, setEmailConfigInput] = useState({
    resendApiKey: "",
    smtpHost: "",
    smtpPort: "587",
    smtpUser: "",
    smtpPass: "",
    smtpFrom: ""
  });
  const [testEmailRecipient, setTestEmailRecipient] = useState("");
  const [emailStatus, setEmailStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [socketErrorAlert, setSocketErrorAlert] = useState<string | null>(null);

  const fetchEmailConfig = async () => {
    try {
      const res = await fetch("/api/email-config");
      const data = await res.json();
      setEmailConfigInput({
        resendApiKey: data.resendApiKey || "",
        smtpHost: data.smtpHost || "",
        smtpPort: data.smtpPort || "587",
        smtpUser: data.smtpUser || "",
        smtpPass: data.smtpPass || "",
        smtpFrom: data.smtpFrom || ""
      });
      if (currentUser && !testEmailRecipient) {
        setTestEmailRecipient(currentUser.email);
      }
    } catch (err) {
      console.error("Failed to load email config", err);
    }
  };

  const handleOpenEmailConfigModal = () => {
    fetchEmailConfig();
    setEmailStatus(null);
    setShowEmailModal(true);
  };

  const handleSaveEmailConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingEmail(true);
    setEmailStatus(null);
    try {
      const res = await fetch("/api/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailConfigInput)
      });
      const data = await res.json();
      if (data.success) {
        setEmailStatus({ success: true, message: "Configuration saved successfully!" });
      } else {
        setEmailStatus({ success: false, message: data.error || "Failed to save configuration." });
      }
    } catch (err: any) {
      setEmailStatus({ success: false, message: err.message || "An error occurred." });
    } finally {
      setIsSavingEmail(false);
    }
  };

  const handleTestEmailConfig = async () => {
    const recipient = testEmailRecipient || currentUser?.email;
    if (!recipient || !recipient.includes("@")) {
      setEmailStatus({ success: false, message: "Please enter a valid recipient email address." });
      return;
    }
    setIsTestingEmail(true);
    setEmailStatus(null);
    try {
      const res = await fetch("/api/email-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...emailConfigInput,
          testEmail: recipient
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setEmailStatus({ success: true, message: data.message || "Test email dispatched successfully! Verify your inbox." });
      } else {
        setEmailStatus({ success: false, message: data.error || "Failed to deliver test email." });
      }
    } catch (err: any) {
      setEmailStatus({ success: false, message: err.message || "Connection timed out or failed." });
    } finally {
      setIsTestingEmail(false);
    }
  };

  const fetchBlockedUsers = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/blocks/${currentUser.id}`);
      const data = await res.json();
      if (data.blockedIds) {
        setBlockedUserIds(data.blockedIds);
      }
    } catch (err) {
      console.error("Failed to fetch blocked list", err);
    }
  };

  const handleToggleBlockContact = async (targetId: string) => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/blocks/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser.id,
          targetId
        })
      });
      const data = await res.json();
      if (data.success) {
        setBlockedUserIds(data.blockedIds || []);
        setReportSuccessMsg(data.isBlocked ? "Contact blocked successfully!" : "Contact unblocked successfully!");
        setTimeout(() => setReportSuccessMsg(""), 3000);
      }
    } catch (err) {
      console.error("Failed to toggle block status", err);
    }
  };

  const handleSaveNickname = (targetId: string, newNickname: string) => {
    const trimmed = newNickname.trim();
    const updated = { ...nicknames, [targetId]: trimmed };
    setNicknames(updated);
    localStorage.setItem("contact_nicknames", JSON.stringify(updated));
    setIsEditingNicknameField(false);
  };

  const handleReportContact = async (targetId: string) => {
    if (!currentUser || !reportText.trim()) return;
    setIsReporting(true);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reporterId: currentUser.id,
          targetId,
          reason: reportText
        })
      });
      const data = await res.json();
      if (data.success) {
        setReportSuccessMsg("Report submitted successfully.");
        setReportText("");
        setTimeout(() => setReportSuccessMsg(""), 4000);
      }
    } catch (err) {
      console.error("Error reporting contact", err);
    } finally {
      setIsReporting(false);
    }
  };

  // Ref mapping for message long-press detection
  const longPressTimeoutRef = useRef<Record<string, any>>({});

  // WebRTC Caller/Receiver Alert State
  const [callState, setCallState] = useState<{
    targetUser: User;
    type: "voice" | "video";
    role: "caller" | "receiver";
    status: "ringing" | "dialing" | "connected";
    incomingSignal?: any;
  } | null>(null);

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<any>(null);
  const isCurrentlyTypingRef = useRef<boolean>(false);

  // Keep references to activeContact and contacts for live WS closure stability
  const activeContactRef = useRef<User | null>(null);
  const contactsRef = useRef<Record<string, User>>({});

  useEffect(() => {
    activeContactRef.current = activeContact;
  }, [activeContact]);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  // Deep-link validation and auto-authenticating link processing on mount
  useEffect(() => {
    const checkDeepLink = async () => {
      const params = new URLSearchParams(window.location.search);
      const emailParam = params.get("email");
      const replyToParam = params.get("replyTo");
      const draftParam = params.get("draft");
      const sigParam = params.get("sig");

      if (emailParam && replyToParam && draftParam && sigParam) {
        try {
          console.log("[DeepLink] Pre-authenticating secure reply link parameters...");
          const res = await fetch("/api/auth/verify-secure-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: emailParam,
              replyTo: replyToParam,
              draft: draftParam,
              sig: sigParam,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.user) {
              console.log("[DeepLink] Pre-auth validated successfully!", data.user.email);
              handleLoginSuccess(data.user);
              setPendingLinkReply({
                replyTo: replyToParam,
                draft: draftParam,
              });

              // Clean up query parameters from browser URL bar
              const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
              window.history.replaceState({ path: newUrl }, "", newUrl);
            } else {
              console.warn("[DeepLink] Verification returned failed response:", data.error);
            }
          } else {
            console.warn("[DeepLink] Failed to communicate verification with server");
          }
        } catch (err) {
          console.error("[DeepLink] Unexpected exception verifying deep link", err);
        }
      }
    };

    checkDeepLink();
  }, []);

  // Handle auto-selected chat and pre-filled draft once contacts are loaded
  useEffect(() => {
    if (pendingLinkReply && Object.keys(contacts).length > 0) {
      const targetUser = contacts[pendingLinkReply.replyTo];
      if (targetUser) {
        console.log("[DeepLink] Target user located in contacts list. Direct selection:", targetUser.name);
        setActiveContact(targetUser);
        
        saveDraft(currentUser!.id, targetUser.id, pendingLinkReply.draft).then(() => {
          setMessageInput(pendingLinkReply.draft);
          setPendingLinkReply(null);
        });
      } else {
        // Fallback search directly in all users in database
        const lookupAndRegisterLinkUser = async () => {
          try {
            const res = await fetch("/api/users");
            if (res.ok) {
              const users: User[] = await res.json();
              const found = users.find((u) => u.id === pendingLinkReply.replyTo);
              if (found) {
                console.log("[DeepLink] Target user located from direct lookup. Selecting:", found.name);
                setActiveContact(found);
                
                // Add to contacts list local state
                setContacts((prev) => ({
                  ...prev,
                  [found.id]: found,
                }));
                
                await saveDraft(currentUser!.id, found.id, pendingLinkReply.draft);
                setMessageInput(pendingLinkReply.draft);
                setPendingLinkReply(null);
              }
            }
          } catch (e) {
            console.error("[DeepLink] Fallback database lookup error", e);
          }
        };
        lookupAndRegisterLinkUser();
      }
    }
  }, [pendingLinkReply, contacts, currentUser]);

  // Sync Dark Mode state to document root
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("gmail_chat_dark_mode", String(isDarkMode));
  }, [isDarkMode]);

  // Synchronize unread badge to document.title and canvas favicon badge
  useEffect(() => {
    const totalUnread = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    const originalTitle = "Gmail Chat";
    
    // Update Browser Tab Title
    if (totalUnread > 0) {
      document.title = `(${totalUnread}) ${originalTitle}`;
    } else {
      document.title = originalTitle;
    }

    // Dynamic Canvas Favicon Badge Updates
    const updateFaviconBadge = (count: number) => {
      try {
        let favicon = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
        if (!favicon) {
          favicon = document.createElement("link");
          favicon.rel = "icon";
          favicon.type = "image/png";
          document.head.appendChild(favicon);
        }

        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Base background shape
        ctx.fillStyle = "#1E1E24";
        ctx.beginPath();
        ctx.arc(16, 16, 14, 0, Math.PI * 2);
        ctx.fill();

        // Inner communication bubble
        ctx.fillStyle = "#3B82F6"; // High contrast notification accent blue
        ctx.beginPath();
        ctx.arc(14, 14, 9, 0, Math.PI * 2);
        ctx.fill();

        // Speech bubble tip
        ctx.fillStyle = "#3B82F6";
        ctx.beginPath();
        ctx.moveTo(8, 20);
        ctx.lineTo(14, 18);
        ctx.lineTo(12, 23);
        ctx.closePath();
        ctx.fill();

        // Letter decorate
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 9px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("M", 14, 14);

        if (count > 0) {
          // Alert Red Notification circle ring
          ctx.strokeStyle = "#1E1E24";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(24, 8, 7.5, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = "#EF4444";
          ctx.beginPath();
          ctx.arc(24, 8, 7.5, 0, Math.PI * 2);
          ctx.fill();

          // Text representation with font
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 9px sans-serif";
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          const textValue = count > 9 ? "9+" : String(count);
          ctx.fillText(textValue, 24, 8.5);
        }

        favicon.href = canvas.toDataURL("image/png");
      } catch (err) {
        console.warn("Could not render dynamic canvas favicon badge in standard sandboxed environment:", err);
      }
    };

    updateFaviconBadge(totalUnread);
  }, [conversations]);

  // Sync session store
  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem("gmail_chat_user", JSON.stringify(user));
  };

  const handleLogout = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setCurrentUser(null);
    setActiveContact(null);
    setMessages([]);
    setTypingUsers({});
    localStorage.removeItem("gmail_chat_user");
  };

  // Fetch initial profile list from DB on logged-in success
  useEffect(() => {
    if (!currentUser) return;

    const fetchInitialData = async () => {
      try {
        const usersRes = await fetch("/api/users");
        if (usersRes.ok) {
          const userList: User[] = await usersRes.json();
          const mapped: Record<string, User> = {};
          userList.forEach((u) => {
            if (u.id !== currentUser.id) {
              mapped[u.id] = u;
            }
          });
          setContacts(mapped);
        }

        const callsRes = await fetch(`/api/calls/${currentUser.id}`);
        if (callsRes.ok) {
          const fetchedCalls = await callsRes.json();
          setCallLogs(fetchedCalls);
        }
      } catch (err) {
        console.error("Failed to load initial data", err);
      }
    };

    fetchInitialData();
    fetchBlockedUsers();
  }, [currentUser]);

  // Synchronize any offline pending drafts/messages once connection is restored
  const syncOfflineMessages = async () => {
    if (!currentUser || !socketRef.current || !socketRef.current.connected) return;
    try {
      const pending = await getPendingMessages();
      if (pending.length === 0) return;

      console.log(`[Offline Sync] Restoring connection, syncing ${pending.length} pending message(s)...`);
      for (const msg of pending) {
        socketRef.current.emit("message:send", {
          id: msg.id,
          receiverId: msg.receiverId,
          content: msg.content,
          type: msg.type,
          fileName: msg.fileName,
          fileSize: msg.fileSize,
        });

        // Erase pending version from IndexedDB
        await deleteMessage(msg.id);

        // Instantly remove pending version from UI state (server will rebroadcast the authorized version)
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      }

      triggerConversationsRefresh();
    } catch (err) {
      console.error("Failed to sync offline messages:", err);
    }
  };

  // Browser level network states and synchronization triggers
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      syncOfflineMessages();
    };
    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check and synchronization in case we started offline then reconnected
    if (navigator.onLine) {
      syncOfflineMessages();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [currentUser]);

  // Establish WebSockets listeners & sync
  useEffect(() => {
    if (!currentUser) return;

    // Connect to same hosting port and origin
    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"]
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsOffline(false);
      syncOfflineMessages();
    });

    socket.on("disconnect", () => {
      if (!navigator.onLine) {
        setIsOffline(true);
      }
    });

    // Direct authenticating
    socket.emit("auth:init", { userId: currentUser.id });

    // 1. Presence / Online alerts
    socket.on("presence:update", ({ userId, isOnline, lastSeen }) => {
      if (userId === currentUser.id) return;

      setContacts((prev) => {
        const copy = { ...prev };
        if (copy[userId]) {
          copy[userId] = { ...copy[userId], isOnline, lastSeen };
        }
        return copy;
      });

      const curContact = activeContactRef.current;
      if (curContact && curContact.id === userId) {
        setActiveContact((prev) => prev ? { ...prev, isOnline, lastSeen } : null);
      }
    });

    // 2. Incoming messages sync
    socket.on("message:receive", (message: Message) => {
      const curContact = activeContactRef.current;
      // If message is in active chat container
      const isCurrentConversation =
        (curContact?.isGroup && message.receiverId === curContact.id) ||
        (message.senderId === currentUser.id && message.receiverId === curContact?.id) ||
        (message.senderId === curContact?.id && message.receiverId === currentUser.id) ||
        (message.senderId === "system" && message.receiverId === getConversationKey(currentUser.id, curContact?.id || ""));

      // Unconditionally cache the newly received message in IndexedDB!
      saveMessages([message]);

      if (isCurrentConversation) {
        setMessages((prev) => {
          // Replace local pending message overlay if present with authorized version
          if (prev.some((m) => m.id === message.id)) {
            return prev.map((m) => m.id === message.id ? message : m);
          }
          return [...prev, message];
        });

        // Trigger read confirmation if active chat has loaded and received massage is from sender
        if (message.senderId === curContact?.id) {
          socket.emit("message:read_all", { senderId: curContact.id });
        }
      }

      // Re-trigger derivation of relative conversations list
      triggerConversationsRefresh();
    });

    // 3. Message Status Receipts changes (sent -> delivered -> read)
    socket.on("message:status_changed", ({ messageId, status }) => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, status } : msg))
      );
      triggerConversationsRefresh();
    });

    // 4. WebRTC Voice/Video calling incoming alert
    socket.on(
      "call:incoming",
      (payload: {
        callId: string;
        callerId: string;
        callerName: string;
        callerPicture: string;
        type: "voice" | "video";
        offerSignal: any;
      }) => {
        // Construct mock participant
        const callerContact: User = contactsRef.current[payload.callerId] || {
          id: payload.callerId,
          email: `${payload.callerId}@gmail.com`,
          name: payload.callerName,
          picture: payload.callerPicture,
          isOnline: true,
          lastSeen: Date.now(),
        };

        setCallState({
          targetUser: callerContact,
          type: payload.type,
          role: "receiver",
          status: "ringing",
          incomingSignal: payload.offerSignal,
        });

        // Play subtle HTML ring tone sound simulation or notification
        triggerBrowserNotification(`Incoming ${payload.type} call from ${payload.callerName}`);
      }
    );

    // 5. Peer disconnected or declined call
    socket.on("call:hangup", () => {
      setCallState(null);
    });

    socket.on("call:response", (payload: { receiverId: string; status: string; answerSignal?: any }) => {
      if (payload.status === "rejected" || payload.status === "no-answer") {
        setCallState(null);
      }
    });

    // 6. Real-time typing indicators
    socket.on("chat:typing", ({ senderId, isTyping }: { senderId: string; isTyping: boolean }) => {
      setTypingUsers((prev) => ({
        ...prev,
        [senderId]: isTyping,
      }));
    });

    // 7. Message reactions updates
    socket.on("message:reaction_updated", ({ messageId, reactions }: { messageId: string; reactions: Record<string, string[]> }) => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, reactions } : msg))
      );
    });

    // 8. Disappearing messages: socket updates
    socket.on("disappearing:update", ({ userId1, userId2, durationMs }: { userId1: string; userId2: string; durationMs: number }) => {
      const curContact = activeContactRef.current;
      const isMatch =
        (userId1 === currentUser?.id && userId2 === curContact?.id) ||
        (userId2 === currentUser?.id && userId1 === curContact?.id);
      if (isMatch) {
        setActiveDisappearingDuration(durationMs);
      }
    });

    socket.on("message:error", ({ message }: { message: string }) => {
      setSocketErrorAlert(message);
      setTimeout(() => {
        setSocketErrorAlert(null);
      }, 5000);
    });

    socket.on("messages:deleted", ({ ids }: { ids: string[] }) => {
      setMessages((prev) => prev.filter((msg) => !ids.includes(msg.id)));
      triggerConversationsRefresh();
    });

    return () => {
      socket.disconnect();
    };
  }, [currentUser]);

  // Load chat messages when active conversation shifts
  useEffect(() => {
    if (!currentUser || !activeContact) return;

    // Reset local message search state on contact shifts
    setShowLocalSearch(false);
    setLocalSearchQuery("");

    const fetchChatMessages = async () => {
      try {
        // 1. Immediately display cached history from IndexedDB for zero-latency load
        const cached = await getCachedMessages(currentUser.id, activeContact.id);
        if (cached && cached.length > 0) {
          setMessages(cached);
        } else {
          setMessages([]);
        }

        // 2. Fetch draft if any exists and update input field
        const savedDraft = await getDraft(currentUser.id, activeContact.id);
        setMessageInput(savedDraft);

        const res = await fetch(`/api/messages/${currentUser.id}/${activeContact.id}`);
        if (res.ok) {
          const list = await res.json();
          setMessages(list);
          saveMessages(list); // save to IndexedDB cache

          // Mark messages as read on server
          if (socketRef.current) {
            socketRef.current.emit("message:read_all", { senderId: activeContact.id });
          }
        }

        // Fetch disappearing messages settings
        const settingRes = await fetch(`/api/disappearing-settings/${currentUser.id}/${activeContact.id}`);
        if (settingRes.ok) {
          const s = await settingRes.json();
          setActiveDisappearingDuration(s.durationMs || 0);
        } else {
          setActiveDisappearingDuration(0);
        }
      } catch (err) {
        console.error("Failed to load message log", err);
      }
    };

    fetchChatMessages();
  }, [currentUser, activeContact]);

  // Derive conversation histories list
  const triggerConversationsRefresh = async () => {
    if (!currentUser) return;
    try {
      const usersRes = await fetch("/api/users");
      if (!usersRes.ok) return;
      const allUsers: User[] = await usersRes.json();
      
      const convList: Conversation[] = [];

      for (const u of allUsers) {
        if (u.id === currentUser.id) continue;

        // If it's a group chat, only show if current user is part of the group members list
        if (u.isGroup && u.members && !u.members.includes(currentUser.id)) {
          continue;
        }

        // Fetch messages log
        const msgRes = await fetch(`/api/messages/${currentUser.id}/${u.id}`);
        if (msgRes.ok) {
          const hist: Message[] = await msgRes.json();
          const lastMessage = hist[hist.length - 1];
          
          let unreadCount = 0;
          if (u.isGroup) {
            unreadCount = hist.filter(
              (m) => m.senderId !== currentUser.id && m.status !== "read"
            ).length;
          } else {
            unreadCount = hist.filter(
              (m) => m.senderId === u.id && m.receiverId === currentUser.id && m.status !== "read"
            ).length;
          }

          if (lastMessage || u.id in contacts || (u.isGroup && u.members?.includes(currentUser.id))) {
            convList.push({
              user: u,
              lastMessage,
              unreadCount,
            });
          }
        }
      }

      // Sort by last message timestamp
      convList.sort((a, b) => {
        const timeA = a.lastMessage?.timestamp || 0;
        const timeB = b.lastMessage?.timestamp || 0;
        return timeB - timeA;
      });

      setConversations(convList);
    } catch (err) {
      console.warn("Failed to derive conversations helper", err);
    }
  };

  // Keep derived conversations sync'd
  useEffect(() => {
    if (currentUser) {
      triggerConversationsRefresh();
    }
  }, [currentUser, contacts, messages]);

  // Scroll to bottom of chat feed
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Real-time typing events emission logic
  useEffect(() => {
    if (!currentUser || !activeContact || !socketRef.current) return;

    // If messageInput is empty, we must be done typing (either sent the message or deleted text)
    if (!messageInput.trim()) {
      if (isCurrentlyTypingRef.current) {
        socketRef.current.emit("chat:typing", {
          receiverId: activeContact.id,
          isTyping: false,
        });
        isCurrentlyTypingRef.current = false;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      return;
    }

    // If we were not currently typing, emit typing start
    if (!isCurrentlyTypingRef.current) {
      socketRef.current.emit("chat:typing", {
        receiverId: activeContact.id,
        isTyping: true,
      });
      isCurrentlyTypingRef.current = true;
    }

    // Refresh the timeout to stop typing after inactivity
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      if (socketRef.current && isCurrentlyTypingRef.current) {
        socketRef.current.emit("chat:typing", {
          receiverId: activeContact.id,
          isTyping: false,
        });
        isCurrentlyTypingRef.current = false;
      }
    }, 2000); // 2 seconds of inactivity

    // Cleanup on unmount or activeContact shift
    return () => {
      if (socketRef.current && isCurrentlyTypingRef.current) {
        // Stop typing indicator on old contact
        socketRef.current.emit("chat:typing", {
          receiverId: activeContact.id,
          isTyping: false,
        });
        isCurrentlyTypingRef.current = false;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [messageInput, activeContact, currentUser]);

  // Send textual messages
  const handleSendMessage = async () => {
    if (!currentUser || !activeContact || !messageInput.trim()) return;

    const contentText = messageInput.trim();
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const isCurrentlyOffline = isOffline || !socketRef.current || !socketRef.current.connected;

    if (isCurrentlyOffline) {
      // Create a local queued pending Message
      const pendingMessage: Message = {
        id: msgId,
        senderId: currentUser.id,
        receiverId: activeContact.id,
        content: contentText,
        type: "text",
        status: "sent",
        timestamp: Date.now(),
        isPending: true,
      };

      // Add to state immediately
      setMessages((prev) => [...prev, pendingMessage]);

      // Cache directly into IndexedDB as pending
      await saveMessages([pendingMessage]);
      
      console.log("[Offline Cache] Message queued locally in IndexedDB:", pendingMessage);
    } else {
      // Create a local immediate Message for instant view/render
      const instantMessage: Message = {
        id: msgId,
        senderId: currentUser.id,
        receiverId: activeContact.id,
        content: contentText,
        type: "text",
        status: "sent",
        timestamp: Date.now(),
      };

      // Add to state immediately
      setMessages((prev) => [...prev, instantMessage]);

      // Cache directly into IndexedDB
      await saveMessages([instantMessage]);

      if (socketRef.current) {
        socketRef.current.emit("message:send", {
          id: msgId,
          receiverId: activeContact.id,
          content: contentText,
          type: "text",
        });
      }
    }

    setMessageInput("");
    setShowEmojiPicker(false);
    await deleteDraft(currentUser.id, activeContact.id);
  };

  // Forward message to a destination contact
  const handleForwardMessage = async (targetContact: User) => {
    if (!currentUser || !forwardingMessage) return;

    const msgId = `msg_${Date.now()}_forward_${Math.random().toString(36).substr(2, 5)}`;
    const isCurrentlyOffline = isOffline || !socketRef.current || !socketRef.current.connected;

    const clonedMessage: Message = {
      id: msgId,
      senderId: currentUser.id,
      receiverId: targetContact.id,
      content: forwardingMessage.content,
      type: forwardingMessage.type,
      status: "sent",
      timestamp: Date.now(),
    };

    if (forwardingMessage.fileName) clonedMessage.fileName = forwardingMessage.fileName;
    if (forwardingMessage.fileSize) clonedMessage.fileSize = forwardingMessage.fileSize;

    if (isCurrentlyOffline) {
      clonedMessage.isPending = true;

      // Save to IndexedDB so it gets synced when reconnected
      await saveMessages([clonedMessage]);

      // If currently chatting with this contact, append to current messages feed state
      if (activeContact?.id === targetContact.id) {
        setMessages((prev) => [...prev, clonedMessage]);
      }
      console.log("[Offline Forward Queue] Forwarded message stored locally:", clonedMessage);
    } else {
      // Standard live socket dispatch
      if (socketRef.current) {
        socketRef.current.emit("message:send", {
          id: msgId,
          receiverId: targetContact.id,
          content: clonedMessage.content,
          type: clonedMessage.type,
          fileName: clonedMessage.fileName,
          fileSize: clonedMessage.fileSize,
        });
      }

      // Save standard cached message locally in IndexedDB as well
      await saveMessages([clonedMessage]);

      // Update active contact's scroll list if they match
      if (activeContact?.id === targetContact.id) {
        setMessages((prev) => [...prev, clonedMessage]);
      }
    }

    // Refresh conversation listing sidebar to reflect the new lastMessage
    triggerConversationsRefresh();

    // Close the forward selection modal
    setForwardingMessage(null);
    setForwardSearchQuery("");

    // Open the success notification toast alert
    setForwardStatusAlert({ profile: targetContact });

    // Auto-dismiss the toast after 5 seconds
    setTimeout(() => {
      setForwardStatusAlert((curr) => (curr?.profile.id === targetContact.id ? null : curr));
    }, 5000);
  };

  // Toggle message reactions
  const handleToggleReaction = (messageId: string, emoji: string) => {
    if (!currentUser || !socketRef.current) return;
    
    // Optimistic UI update for immediate feedback
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId) return msg;

        const reactions = { ...(msg.reactions || {}) };
        if (!reactions[emoji]) {
          reactions[emoji] = [];
        }

        const index = reactions[emoji].indexOf(currentUser.id);
        if (index > -1) {
          reactions[emoji] = reactions[emoji].filter((uid) => uid !== currentUser.id);
          if (reactions[emoji].length === 0) {
            delete reactions[emoji];
          }
        } else {
          reactions[emoji] = [...reactions[emoji], currentUser.id];
        }

        return { ...msg, reactions };
      })
    );

    // Emit reaction toggle to the backend
    socketRef.current.emit("message:react", { messageId, emoji });
  };

  // Helper to escape regular expression characters
  const escapeRegExp = (text: string) => {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  // Helper to render high-contrast highlights on matched keywords
  const highlightText = (text: string, search: string) => {
    if (!text) return "";
    if (!search || !search.trim()) return <span>{text}</span>;
    
    try {
      const escapedSearch = escapeRegExp(search.trim());
      const regex = new RegExp(`(${escapedSearch})`, "gi");
      const parts = text.split(regex);
      return (
        <span>
          {parts.map((part, i) =>
            regex.test(part) ? (
              <mark key={i} className="bg-yellow-550/40 text-yellow-100 font-extrabold px-1 py-0.5 rounded border border-yellow-500/50">
                {part}
              </mark>
            ) : (
              part
            )
          )}
        </span>
      );
    } catch (e) {
      return <span>{text}</span>;
    }
  };

  // Derived filtered message list based on current local search settings
  const filteredMessages = messages.filter((m) => {
    if (!showLocalSearch || !localSearchQuery.trim() || localSearchMode === "highlight") return true;

    const query = localSearchQuery.toLowerCase().trim();
    
    // Check message content
    if (m.content && m.content.toLowerCase().includes(query)) return true;
    
    // Check attachment metadata
    if (m.fileName && m.fileName.toLowerCase().includes(query)) return true;
    
    return false;
  });

  // Derived match counts for the search bar HUD display
  const actualMatchCount = messages.filter((m) => {
    if (!showLocalSearch || !localSearchQuery.trim()) return false;
    const query = localSearchQuery.toLowerCase().trim();
    if (m.content && m.content.toLowerCase().includes(query)) return true;
    if (m.fileName && m.fileName.toLowerCase().includes(query)) return true;
    return false;
  }).length;

  // Send Rich Attachment files (images or documents packaged into Base64)
  const processAndUploadFile = (file: File) => {
    if (!currentUser || !activeContact) return;

    const maxSize = 8 * 1024 * 1024; // 8MB lock
    if (file.size > maxSize) {
      alert("Maximum file uploads size is capped at 8MB. Please choose a smaller file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const isPicture = file.type.startsWith("image/");
      const payloadFile = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        receiverId: activeContact.id,
        content: reader.result as string, // Base64 packed
        type: isPicture ? "image" : "file",
        fileName: file.name,
        fileSize: formatBytes(file.size),
      };

      const isCurrentlyOffline = isOffline || !socketRef.current || !socketRef.current.connected;

      if (isCurrentlyOffline) {
        const pendingFileMessage: Message = {
          id: payloadFile.id,
          senderId: currentUser.id,
          receiverId: payloadFile.receiverId,
          content: payloadFile.content,
          type: payloadFile.type as MessageType,
          status: "sent",
          timestamp: Date.now(),
          fileName: payloadFile.fileName,
          fileSize: payloadFile.fileSize,
          isPending: true,
        };

        setMessages((prev) => [...prev, pendingFileMessage]);
        saveMessages([pendingFileMessage]);
        console.log("[Offline Cache] Queued offline pending attachment:", pendingFileMessage);
      } else {
        const instantFileMessage: Message = {
          id: payloadFile.id,
          senderId: currentUser.id,
          receiverId: payloadFile.receiverId,
          content: payloadFile.content,
          type: payloadFile.type as MessageType,
          status: "sent",
          timestamp: Date.now(),
          fileName: payloadFile.fileName,
          fileSize: payloadFile.fileSize,
        };

        setMessages((prev) => [...prev, instantFileMessage]);
        saveMessages([instantFileMessage]);

        if (socketRef.current) {
          socketRef.current.emit("message:send", payloadFile);
        }
      }
    };

    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processAndUploadFile(file);
    }
  };

  // Drag-and-drop Listeners on chat body
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processAndUploadFile(file);
    }
  };

  // Group chat creation and member toggle helpers
  const [groupMemberSearchQuery, setGroupMemberSearchQuery] = useState("");

  const toggleGroupMemberSelection = (memberId: string) => {
    setSelectedGroupMembers((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const handleCreateGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!groupNameInput.trim()) return;
    if (selectedGroupMembers.length === 0) {
      alert("Please select at least one contact to join your group chat.");
      return;
    }

    // Include the current logged-in user automatically as a group member
    const members = Array.from(new Set([...selectedGroupMembers, currentUser.id]));

    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupNameInput.trim(),
          members,
          createdBy: currentUser.id,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Dynamic addition of new group chat object to contacts cache list
        setContacts((prev) => ({ ...prev, [data.group.id]: data.group }));
        setActiveContact(data.group);
        setShowCreateGroupModal(false);
        setGroupNameInput("");
        setSelectedGroupMembers([]);
        setGroupMemberSearchQuery("");
        triggerConversationsRefresh();
      } else {
        const data = await res.json();
        alert(data.error || "Could not register new group chat.");
      }
    } catch (err) {
      console.error("Failed to execute request to server:", err);
    }
  };

  // Initiate Voice or Video Calls
  const handleInitiateCall = (callType: "voice" | "video") => {
    if (!currentUser || !activeContact) return;

    setCallState({
      targetUser: activeContact,
      type: callType,
      role: "caller",
      status: "dialing",
    });
  };

  // Accept WebRTC call invitation
  const handleAcceptCaller = (answerSignal?: any) => {
    if (socketRef.current && callState) {
      socketRef.current.emit("call:response", {
        callId: callState.incomingSignal ? `call_${Date.now()}` : "direct",
        callerId: callState.targetUser.id,
        status: "connected",
        answerSignal,
      });
    }
  };

  // Decline WebRTC call invitation
  const handleRejectCaller = () => {
    if (socketRef.current && callState) {
      socketRef.current.emit("call:response", {
        callId: `call_${Date.now()}`,
        callerId: callState.targetUser.id,
        status: "rejected",
      });
    }
    setCallState(null);
  };

  // End active connection
  const handleHangupCall = (duration: number) => {
    if (socketRef.current && callState) {
      socketRef.current.emit("call:hangup", {
        targetId: callState.targetUser.id,
        duration,
      });
    }

    // Refresh history call lists from backend
    setTimeout(async () => {
      if (currentUser) {
        const callsRes = await fetch(`/api/calls/${currentUser.id}`);
        if (callsRes.ok) {
          const list = await callsRes.json();
          setCallLogs(list);
        }
      }
    }, 800);

    setCallState(null);
  };

  // Add Contact dynamically using their real Gmail ID
  const handleAddContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchContactEmail || !searchContactEmail.includes("@")) {
      alert("Please provide a valid Gmail ID.");
      return;
    }

    try {
      const res = await fetch("/api/contacts/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: searchContactEmail.toLowerCase().trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        const newUser: User = data.user;
        
        // Add to sidebar contacts map
        setContacts((prev) => ({
          ...prev,
          [newUser.id]: newUser,
        }));

        setActiveContact(newUser);
        setSearchContactEmail("");
        setShowAddContactModal(false);
        setSidebarMobileOpen(false); // Switch viewing layer on mobile
      } else {
        alert("Unable to fetch directory entry for that Gmail address.");
      }
    } catch (err) {
      console.error("Directory lookup failed", err);
    }
  };

  // Helper formatting numbers
  function formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  const formatLastSeen = (timestamp: number, isOnline: boolean) => {
    if (isOnline) return "Online";
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "Last seen just now";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `Last seen ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Last seen ${hours}h ago`;
    return `Last seen on ${new Date(timestamp).toLocaleDateString()}`;
  };

  function triggerBrowserNotification(text: string) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Gmail Chat Alert", { body: text });
    }
  }

  // Request browser message notification permissions early
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Filter conversations list based on query filter
  const filteredConversations = conversations.filter((c) =>
    c.user.email.toLowerCase().includes(searchSidebarQuery.toLowerCase()) ||
    c.user.name.toLowerCase().includes(searchSidebarQuery.toLowerCase())
  );

  // Unauthenticated routing view
  if (!currentUser) {
    return <GoogleSignIn onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0A0A0A] text-slate-200 font-sans">
      
      {/* APP WRAPPER LAYOUT */}
      <div className="flex flex-1 w-full relative">
        
        {/* ========= SIDEBAR MAIN RAIL ========= */}
        <div
          className={`absolute md:relative z-40 inset-y-0 left-0 w-full md:w-96 bg-[#161616] border-r border-white/5 flex flex-col transition-all duration-300 transform ${
            sidebarMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          }`}
        >
          {/* Sidebar Top Profile Section */}
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-[#1C1C1C]">
            <div className="flex items-center gap-3">
              <img
                src={currentUser.picture}
                alt={currentUser.name}
                className="w-10 h-10 rounded-full object-cover border-2 border-white/5 hover:rotate-6 transition-transform"
                referrerPolicy="no-referrer"
              />
              <div className="overflow-hidden">
                <h4 className="font-extrabold text-sm truncate max-w-[150px] leading-tight text-white animate-in fade-in">
                  {currentUser.name}
                </h4>
                <p className="text-[11px] text-slate-450 font-mono truncate max-w-[150px]">
                  {currentUser.email}
                </p>
              </div>
            </div>

            {/* Icons controls */}
            <div className="flex items-center gap-1.5">
              <button
                id="toggle-dark-mode"
                type="button"
                className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
                title="Toggle Dark Mode"
                onClick={() => setIsDarkMode(!isDarkMode)}
              >
                {isDarkMode ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
              </button>

              <button
                id="toggle-call-logs"
                type="button"
                className={`p-2 rounded-xl transition-colors cursor-pointer ${
                  showCallHistoryPane
                    ? "bg-blue-600/10 text-blue-400"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
                title="Call History Logs"
                onClick={() => setShowCallHistoryPane(!showCallHistoryPane)}
              >
                <History className="w-4.5 h-4.5" />
              </button>

              <button
                id="show-add-contact-btn"
                type="button"
                onClick={() => setShowAddContactModal(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
                title="Add New Contact"
              >
                <Plus className="w-4.5 h-4.5" />
              </button>

              <button
                id="show-create-group-btn"
                type="button"
                onClick={() => setShowCreateGroupModal(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
                title="Create Group Chat"
              >
                <Users className="w-4.5 h-4.5" />
              </button>

              <button
                id="show-email-config-btn"
                type="button"
                onClick={handleOpenEmailConfigModal}
                className="p-2 text-blue-400 hover:text-blue-200 hover:bg-blue-500/10 rounded-xl transition-colors cursor-pointer relative"
                title="Configure Real-Time Email Delivery Gateway"
              >
                <Mail className="w-4.5 h-4.5" />
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping"></span>
              </button>

              <button
                id="logout-btn"
                type="button"
                onClick={handleLogout}
                className="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition-colors cursor-pointer"
                title="Logout"
              >
                <LogOut className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {/* Call Records view modal */}
          {showCallHistoryPane ? (
            <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="p-3 border-b border-white/5 flex justify-between items-center bg-blue-600/5">
                <span className="text-xs font-black uppercase tracking-wide text-blue-400">
                  VoIP Call History Logs
                </span>
                <button
                  id="close-calls-pane"
                  type="button"
                  onClick={() => setShowCallHistoryPane(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 rounded p-1"
                >
                  Back to Chats
                </button>
              </div>

              {/* Call logs feed */}
              <div className="flex-1 overflow-y-auto divide-y divide-white/5 bg-[#161616]">
                {callLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    No voice or video call events found in your logs.
                  </div>
                ) : (
                  callLogs.map((log) => {
                    const partyId = log.callerId === currentUser.id ? log.receiverId : log.callerId;
                    const contactInfo = contacts[partyId] || { name: partyId, email: "" };
                    const isOutgoing = log.callerId === currentUser.id;

                    return (
                      <div key={log.id} className="p-3.5 flex items-center justify-between text-xs hover:bg-white/5 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-xl ${isOutgoing ? "bg-blue-500/15 text-blue-400" : "bg-emerald-500/15 text-emerald-450"}`}>
                            {log.type === "video" ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                          </div>
                          <div>
                            <p className="font-bold text-slate-200">{contactInfo.name}</p>
                            <p className="text-[10px] text-slate-500">
                              {isOutgoing ? "Outgoing Call" : "Incoming Call"} • {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full font-mono text-[9px] uppercase font-bold shrink-0 ${
                          log.status === "connected" ? "bg-emerald-950/20 text-emerald-400" : "bg-red-500/10 text-red-400"
                        }`}>
                          {log.status === "connected" ? "Answered" : log.status}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Sidebar Search Bar */}
              <div className="p-3 bg-[#111111]">
                <div className="relative">
                  <input
                    id="search-contacts-query"
                    type="text"
                    value={searchSidebarQuery}
                    onChange={(e) => setSearchSidebarQuery(e.target.value)}
                    placeholder="Search chat or enter email..."
                    className="w-full h-10 px-4 pl-10 rounded-xl bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-semibold placeholder-slate-500 border-none transition-all"
                  />
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                </div>
              </div>

              {/* Chat conversations lists */}
              <div className="flex-1 overflow-y-auto divide-y divide-white/5 p-1 bg-[#161616]">
                {filteredConversations.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center gap-3">
                    <MessageSquare className="w-8 h-8 opacity-40 text-slate-500" />
                    <span>No active chats found.</span>
                    <button
                      id="search-add-inline"
                      onClick={() => setShowAddContactModal(true)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer shadow-lg shadow-blue-500/10 hover:bg-blue-700 transition-all"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Start New Conversation</span>
                    </button>
                  </div>
                ) : (
                  filteredConversations.map((c) => {
                    const isSelected = activeContact?.id === c.user.id;
                    const truncatedMsg = c.lastMessage
                      ? c.lastMessage.type === "text"
                        ? c.lastMessage.content
                        : `Attachment [${c.lastMessage.type}]`
                      : "Gmail contact linked";

                    return (
                      <div
                        id={`chat-convo-${c.user.id}`}
                        key={c.user.id}
                        onClick={() => {
                          setActiveContact(c.user);
                          setSidebarMobileOpen(false); // Close sidebar on mobile
                        }}
                        className={`p-3 rounded-xl flex items-center gap-3 cursor-pointer border border-transparent transition-all ${
                          isSelected
                            ? "bg-white/5 border-white/5 text-blue-400 font-medium"
                            : "hover:bg-white/5 text-slate-300"
                        }`}
                      >
                        {/* Avatar */}
                        <div className="relative">
                          <img
                            src={c.user.picture}
                            alt={c.user.name}
                            className="w-11 h-11 rounded-full object-cover border border-white/5"
                            referrerPolicy="no-referrer"
                          />
                          {/* Active presence bubble */}
                          <div className={`absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full border-2 border-[#161616] ${
                            c.user.isOnline ? "bg-emerald-500" : "bg-slate-600"
                          }`} />
                        </div>

                        {/* Middle Text Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline mb-0.5">
                            <h4 className="font-bold text-xs truncate text-white leading-tight">
                              {nicknames[c.user.id] || c.user.name}
                            </h4>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {c.lastMessage
                                ? new Date(c.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : ""}
                            </span>
                          </div>
                          
                          <p className={`text-[11px] truncate ${c.unreadCount > 0 ? "font-bold text-blue-300" : "text-slate-400"}`}>
                            {truncatedMsg}
                          </p>
                        </div>

                        {/* Unreads Count Badge */}
                        {c.unreadCount > 0 && (
                          <span className="h-5 min-w-5 px-1.5 rounded-full bg-blue-600 text-white font-extrabold text-[10px] flex items-center justify-center shrink-0">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* ========= DETAIL VIEWPORT CONTAINER ========= */}
        <div
          className={`flex-1 flex flex-col bg-[#0A0A0A] h-full overflow-hidden ${
            sidebarMobileOpen ? "hidden md:flex" : "flex"
          }`}
        >
          {activeContact ? (
            /* Active Contact Chat Feed */
            <div
              className={`flex-1 flex flex-col h-full relative ${
                isDragging ? "ring-2 ring-blue-500 ring-inset" : ""
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {/* Chat Area Header bar */}
              <div className="h-16 flex items-center justify-between px-6 border-b border-white/5 bg-[#111111] z-10">
                <div id="contact-header-info" className="flex items-center gap-3">
                  {/* Collapsible back for Mobile view */}
                  <button
                    id="mobile-back-sidebar"
                    type="button"
                    onClick={() => setSidebarMobileOpen(true)}
                    className="p-1.5 -ml-1 text-slate-400 hover:bg-[#242424] rounded-lg md:hidden cursor-pointer"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <div 
                    onClick={() => {
                      setEditingNickname(nicknames[activeContact.id] || activeContact.name);
                      setReportSuccessMsg("");
                      setReportText("");
                      setShowProfileModal(true);
                    }}
                    className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                    title="Click to view WhatsApp Info, customize name, block or report contact"
                  >
                    <img
                      src={activeContact.picture}
                      alt={activeContact.name}
                      className="w-10 h-10 rounded-full border border-white/10"
                      referrerPolicy="no-referrer"
                    />
                    <div>
                      <h4 className="font-extrabold text-sm text-white leading-tight flex items-center gap-1.5">
                        {nicknames[activeContact.id] || activeContact.name}
                        {nicknames[activeContact.id] && (
                          <span className="text-[9.5px] font-normal text-slate-450 normal-case">({activeContact.name})</span>
                        )}
                      </h4>
                    {typingUsers[activeContact.id] ? (
                      <span className="text-[10px] text-blue-400 font-mono font-bold animate-pulse block mt-0.5 flex items-center gap-1.5">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                        </span>
                        <span>typing...</span>
                      </span>
                    ) : (
                      <div className="flex items-center gap-2 mt-0.5 whitespace-nowrap">
                        {activeContact.isGroup ? (
                          <span className="text-[10px] font-medium text-blue-400 block">
                            Group • {activeContact.members ? `${activeContact.members.length} members` : "Multi-user"}
                          </span>
                        ) : (
                          <span className={`text-[10px] font-medium block ${
                            activeContact.isOnline ? "text-emerald-400" : "text-slate-500"
                          }`}>
                            {formatLastSeen(activeContact.lastSeen, activeContact.isOnline)}
                          </span>
                        )}
                        {!activeContact.isGroup && !activeContact.isOnline && activeContact.id !== "gemini_ai_gmail_com" && (
                          <span className="inline-flex items-center gap-1 text-[9px] text-blue-400 font-extrabold bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/15 animate-pulse" title="Since this user is offline, any message you send will be delivered instantly to their actual email inbox so they can reply or download the app!">
                            <span>📧 Email Sync Active</span>
                          </span>
                        )}
                        {activeDisappearingDuration > 0 && (
                          <span className="inline-flex items-center gap-1 text-[9px] text-amber-400 font-extrabold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/15 animate-pulse" title="Disappearing messages enabled">
                            <Timer className="w-2.5 h-2.5" />
                            <span>
                              {activeDisappearingDuration === 10000 
                                ? "10s" 
                                : activeDisappearingDuration === 60000 
                                  ? "1m" 
                                  : activeDisappearingDuration === 3600000 
                                    ? "1h" 
                                    : activeDisappearingDuration === 86400000 
                                      ? "24h" 
                                      : "7d"}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

                {/* Video / Voice dialing triggers */}
                <div className="flex items-center gap-1.5">
                  {!activeContact?.isGroup && (
                    <>
                      <button
                        id="dial-voice-btn"
                        type="button"
                        onClick={() => handleInitiateCall("voice")}
                        className="p-2.5 text-slate-400 hover:text-blue-400 hover:bg-[#242424] rounded-xl transition-all cursor-pointer"
                        title="Audio Voice Call"
                      >
                        <Phone className="w-4.5 h-4.5" />
                      </button>

                      <button
                        id="dial-video-btn"
                        type="button"
                        onClick={() => handleInitiateCall("video")}
                        className="p-2.5 text-slate-400 hover:text-blue-400 hover:bg-[#242424] rounded-xl transition-all cursor-pointer"
                        title="HD Video Call"
                      >
                        <Video className="w-4.5 h-4.5" />
                      </button>
                    </>
                  )}

                  <button
                    id="toggle-message-search-btn"
                    type="button"
                    onClick={() => {
                      setShowLocalSearch(!showLocalSearch);
                      if (showLocalSearch) {
                        setLocalSearchQuery("");
                      }
                    }}
                    className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                      showLocalSearch 
                        ? "bg-blue-600/20 text-blue-400 border border-blue-500/30" 
                        : "text-slate-400 hover:text-blue-400 hover:bg-[#242424]"
                    }`}
                    title="Search Conversation Messages"
                  >
                    <Search className="w-4.5 h-4.5" />
                  </button>

                  {/* Disappearing messages toggle button with customizable dropdown */}
                  <div className="relative">
                    <button
                      id="toggle-disappearing-btn"
                      type="button"
                      onClick={() => setShowDisappearingMenu(!showDisappearingMenu)}
                      className={`p-2.5 rounded-xl transition-all cursor-pointer relative ${
                        activeDisappearingDuration > 0
                          ? "bg-[#EAB308]/20 text-[#EAB308] border border-[#EAB308]/30 shadow-[0_0_15px_rgba(234,179,8,0.15)]"
                          : "text-slate-400 hover:text-[#EAB308] hover:bg-[#242424]"
                      }`}
                      title="Disappearing Messages Timer"
                    >
                      <Timer className="w-4.5 h-4.5" />
                      {activeDisappearingDuration > 0 && (
                        <span className="absolute top-1 right-1 w-2 h-2 bg-[#EAB308] rounded-full animate-pulse" />
                      )}
                    </button>

                    {showDisappearingMenu && (
                      <div className="absolute right-0 mt-2 w-52 bg-[#1A1A1D]/95 backdrop-blur border border-white/10 rounded-2xl p-2 shadow-2xl z-50 animate-in fade-in duration-100">
                        <div className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 border-b border-white/5 mb-1 flex items-center justify-between">
                          <span>Disappearing Timer</span>
                          <Timer className="w-3.5 h-3.5 text-[#EAB308] animate-pulse" />
                        </div>
                        <ul className="space-y-0.5">
                          {[
                            { label: "Off", value: 0 },
                            { label: "10 Seconds (Demo)", value: 10000 },
                            { label: "1 Minute", value: 60000 },
                            { label: "1 Hour", value: 3600000 },
                            { label: "24 Hours", value: 86400000 },
                            { label: "7 Days", value: 604800000 },
                          ].map((opt) => {
                            const isSelected = activeDisappearingDuration === opt.value;
                            return (
                              <li key={opt.value}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (currentUser && activeContact && socketRef.current) {
                                      socketRef.current.emit("disappearing:change", {
                                        userId1: currentUser.id,
                                        userId2: activeContact.id,
                                        durationMs: opt.value,
                                      });
                                    }
                                    setShowDisappearingMenu(false);
                                  }}
                                  className={`w-full text-left px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all flex items-center justify-between cursor-pointer ${
                                    isSelected
                                      ? "bg-[#EAB308]/20 text-[#EAB308] border border-[#EAB308]/20 animate-in zoom-in-95 duration-100"
                                      : "text-slate-355 hover:bg-white/5 hover:text-white"
                                  }`}
                                >
                                  <span>{opt.label}</span>
                                  {isSelected && <Check className="w-3.5 h-3.5 text-[#EAB308]" />}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Collapsible Local Message Keyword Search Panel */}
              {showLocalSearch && (
                <div className="bg-[#141416]/95 border-b border-white/5 p-3 px-6 flex flex-col md:flex-row md:items-center justify-between gap-3 animate-in slide-in-from-top-1 duration-150 z-20">
                  <div className="flex-1 flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 max-w-md">
                      <input
                        id="local-message-search-input"
                        type="text"
                        value={localSearchQuery}
                        onChange={(e) => setLocalSearchQuery(e.target.value)}
                        placeholder="Type keywords to find in this chat..."
                        className="w-full h-9 px-3.5 pl-9 pr-8 rounded-xl bg-[#202022] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-semibold placeholder-slate-500 border-none transition-all"
                        autoFocus
                      />
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                      {localSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setLocalSearchQuery("")}
                          className="absolute right-2.5 top-2.5 text-slate-500 hover:text-white cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {localSearchQuery.trim() !== "" && (
                      <span className="text-[11px] text-blue-400 font-mono bg-blue-500/10 px-2.5 py-1 rounded-lg border border-blue-500/10">
                        {actualMatchCount} {actualMatchCount === 1 ? "match" : "matches"} found
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 text-xs">
                    <span className="text-slate-500 text-[11px] font-mono">Search Mode:</span>
                    <button
                      type="button"
                      onClick={() => setLocalSearchMode("highlight")}
                      className={`px-3 py-1.5 rounded-lg font-bold transition-all text-[11px] cursor-pointer ${
                        localSearchMode === "highlight"
                          ? "bg-blue-600 text-white shadow shadow-blue-600/30"
                          : "bg-[#202022] text-slate-400 hover:text-white"
                      }`}
                      title="Keep all messages but highlight any matches"
                    >
                      Highlight Matches
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocalSearchMode("filter")}
                      className={`px-3 py-1.5 rounded-lg font-bold transition-all text-[11px] cursor-pointer ${
                        localSearchMode === "filter"
                          ? "bg-blue-600 text-white shadow shadow-blue-600/30"
                          : "bg-[#202022] text-slate-400 hover:text-white"
                      }`}
                      title="Only display messages matching the keyword"
                    >
                      Filter List
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowLocalSearch(false);
                        setLocalSearchQuery("");
                      }}
                      className="p-1.5 text-slate-400 hover:text-white bg-[#202022] hover:bg-[#303032] rounded-lg transition-colors cursor-pointer"
                      title="Close search"
                    >
                      <X className="w-4.5 h-4.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Chat Drag & Drop Overlay Visual Feedback */}
              {isDragging && (
                <div className="absolute inset-0 z-30 bg-blue-500/10 backdrop-blur-sm border-2 border-dashed border-blue-500 m-4 rounded-3xl flex flex-col items-center justify-center text-blue-400 p-6 pointer-events-none animate-pulse">
                  <Paperclip className="w-16 h-16 mb-4 animate-bounce" />
                  <h3 className="text-xl font-extrabold">Drop attachment files anywhere!</h3>
                  <p className="text-xs text-blue-300 mt-2">Maximum file allocation limit is 8MB.</p>
                </div>
              )}
              
              {/* Offline mode warning banner */}
              {isOffline && (
                <div className="bg-rose-500/10 border-b border-rose-500/15 px-6 py-2 flex items-center justify-between text-rose-300 text-[11px] font-bold animate-in slide-in-from-top duration-300 select-none z-10 shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
                    <span>Viewing offline cached history. Your draft messages will be sent automatically when reconnected!</span>
                  </div>
                  <span className="text-[9px] uppercase tracking-wider font-extrabold bg-rose-500/20 px-2.5 py-0.5 rounded border border-rose-500/15 shrink-0 select-none">Offline Queue</span>
                </div>
              )}

              {/* Messages scroll feed container */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-gradient-to-b from-[#111111] to-[#0A0A0A]">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500 text-xs">
                    <MessageSquare className="w-10 h-10 mb-3 opacity-30 text-blue-500" />
                    <p className="font-bold">Encryption Secure Connection</p>
                    <p className="max-w-[200px] mt-1 leading-normal text-slate-550">
                      Messages are securely synced. Start typing or drop attachments.
                    </p>
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 text-xs py-16 animate-in fade-in duration-200">
                    <Search className="w-12 h-12 mb-3 text-[#EAB308]/60 animate-pulse" />
                    <p className="font-extrabold text-white text-sm">No Keyword Matches Found</p>
                    <p className="max-w-xs mt-1.5 leading-normal text-slate-400">
                      We couldn't locate any messages containing <span className="font-mono text-blue-400 font-extrabold bg-[#202022] px-1.5 py-0.5 rounded border border-white/10">"{localSearchQuery}"</span> in the current conversation.
                    </p>
                    <button
                      type="button"
                      onClick={() => setLocalSearchQuery("")}
                      className="mt-4 px-3.5 py-1.5 bg-[#202022] hover:bg-[#2C2C2F] rounded-xl text-blue-400 hover:text-blue-300 font-bold transition-all text-[11px] cursor-pointer"
                    >
                      Clear Search Query
                    </button>
                  </div>
                ) : (
                  filteredMessages.map((m) => {
                    const isSelf = m.senderId === currentUser?.id;
                    const isSearchMatch = showLocalSearch && localSearchQuery.trim() !== "" && (
                      (m.content && m.content.toLowerCase().includes(localSearchQuery.toLowerCase().trim())) ||
                      (m.fileName && m.fileName.toLowerCase().includes(localSearchQuery.toLowerCase().trim()))
                    );

                    if (m.type === "system") {
                      return (
                        <div key={m.id} className="flex justify-center my-3 animate-in fade-in duration-300">
                          <div className="bg-[#18181B] text-slate-400 text-[10px] font-bold px-4 py-1.5 rounded-full border border-white/5 flex items-center gap-1.5 shadow-md shadow-black/40">
                            <Timer className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                            <span>{m.content}</span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        id={`msg-bubble-${m.id}`}
                        key={m.id}
                        onMouseLeave={() => setActiveMessageMenuId(null)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setActiveMessageMenuId(activeMessageMenuId === m.id ? null : m.id);
                        }}
                        onTouchStart={() => {
                          if (longPressTimeoutRef.current[m.id]) {
                            clearTimeout(longPressTimeoutRef.current[m.id]);
                          }
                          longPressTimeoutRef.current[m.id] = setTimeout(() => {
                            setActiveMessageMenuId(m.id);
                            if (navigator.vibrate) {
                              navigator.vibrate(40);
                            }
                          }, 500);
                        }}
                        onTouchEnd={() => {
                          if (longPressTimeoutRef.current[m.id]) {
                            clearTimeout(longPressTimeoutRef.current[m.id]);
                            delete longPressTimeoutRef.current[m.id];
                          }
                        }}
                        onTouchMove={() => {
                          if (longPressTimeoutRef.current[m.id]) {
                            clearTimeout(longPressTimeoutRef.current[m.id]);
                            delete longPressTimeoutRef.current[m.id];
                          }
                        }}
                        className={`group relative flex ${isSelf ? "justify-end" : "justify-start"} items-center gap-2 px-1 py-1 animate-in fade-in slide-in-from-bottom-2 duration-150`}
                      >
                        {/* Interactive floating reaction panel with Emojis and Forward option */}
                        <div
                          className={`absolute z-20 bottom-full mb-1 transition-all duration-205 ${
                            activeMessageMenuId === m.id
                              ? "opacity-100 scale-100 flex"
                              : "opacity-0 scale-90 hidden group-hover:flex pointer-events-none group-hover:pointer-events-auto"
                          } ${isSelf ? "right-2" : "left-2"} items-center gap-1 bg-[#1A1A1D]/95 backdrop-blur border border-white/10 p-1.5 rounded-full shadow-2xl z-40`}
                        >
                          {["👍", "❤️", "😂", "😮", "😢", "🔥"].map((emoji) => {
                            const isSelected = m.reactions?.[emoji]?.includes(currentUser?.id || "") || false;
                            return (
                              <button
                                key={emoji}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleReaction(m.id, emoji);
                                  setActiveMessageMenuId(null);
                                }}
                                className={`w-8 h-8 flex items-center justify-center text-base rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer ${
                                  isSelected ? "bg-blue-500/30 text-blue-400 font-bold border border-blue-500/40" : ""
                                }`}
                              >
                                {emoji}
                              </button>
                            );
                          })}

                          {/* Clean visual separator and Forward trigger button */}
                          <div className="w-[1px] h-5 bg-white/10 mx-1 self-center" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setForwardingMessage(m);
                              setActiveMessageMenuId(null);
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-full text-blue-400 hover:text-blue-350 hover:bg-white/10 active:scale-95 transition-all cursor-pointer shrink-0"
                            title="Forward Message"
                          >
                            <Forward className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Reaction Smiley Trigger button on the left of self bubble */}
                        {isSelf && (
                          <button
                            type="button"
                            onClick={() => setActiveMessageMenuId(activeMessageMenuId === m.id ? null : m.id)}
                            className="p-1.5 text-slate-500 hover:text-slate-300 bg-transparent hover:bg-[#202020] rounded-full transition-all cursor-pointer h-8 w-8 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 max-sm:opacity-40"
                            title="Add Reaction"
                          >
                            <Smile className="w-4 h-4" />
                          </button>
                        )}

                        {/* Column containing the bubble and the reactions beneath it */}
                        <div className={`flex flex-col max-w-[75%] ${isSelf ? "items-end" : "items-start"}`}>
                          {!isSelf && activeContact?.isGroup && (
                            <span className="text-[10px] font-bold text-blue-450 mb-1 ml-1 select-none">
                              {contacts[m.senderId]?.name || m.senderId.split("_")[0]}
                            </span>
                          )}
                          {/* Message Bubble itself */}
                          <div
                            className={`rounded-2xl p-3 px-4 shadow-sm border-none transition-all duration-300 ${
                              isSelf
                                ? isSearchMatch
                                  ? "bg-blue-600 text-white rounded-tr-none shadow-lg ring-4 ring-[#EAB308]/60 shadow-[0_0_25px_rgba(234,179,8,0.35)] scale-[1.01]"
                                  : "bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-900/15"
                                : isSearchMatch
                                  ? "bg-[#252525] text-white rounded-tl-none ring-4 ring-[#EAB308]/60 shadow-[0_0_25px_rgba(234,179,8,0.35)] scale-[1.01]"
                                  : "bg-[#202020] text-slate-200 rounded-tl-none shadow-sm"
                            }`}
                          >
                            {/* 1. Image render */}
                            {m.type === "image" && (
                              <div className="mb-2 rounded-lg overflow-hidden border border-white/5 bg-[#161616] max-w-sm">
                                <img
                                  src={m.content}
                                  alt={m.fileName || "photo"}
                                  className="max-h-72 object-contain w-full cursor-pointer hover:opacity-95"
                                  referrerPolicy="no-referrer"
                                  onClick={() => {
                                    const win = window.open();
                                    win?.document.write(`<img src="${m.content}" style="max-width:100%; height:auto;" />`);
                                  }}
                                />
                                {m.fileName && (
                                  <div className="p-2 border-t border-white/5 bg-black/40 text-[11px] font-medium text-slate-300 truncate">
                                    {highlightText(m.fileName, localSearchQuery)}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 2. File attachment render */}
                            {m.type === "file" && (
                              <a
                                href={m.content}
                                download={m.fileName || "attachment"}
                                className={`flex items-center gap-3 p-2.5 rounded-xl border-none mb-2 select-all transition-colors ${
                                  isSelf
                                    ? "bg-blue-700 text-white hover:bg-blue-800"
                                    : "bg-[#161616] text-[#A0A0A0] hover:bg-white/5"
                                }`}
                              >
                                <FileText className="w-5 h-5 shrink-0" />
                                <div className="overflow-hidden text-left">
                                  <p className="text-xs font-bold truncate max-w-[150px]">
                                    {highlightText(m.fileName || "File", localSearchQuery)}
                                  </p>
                                  <p className="text-[9px] opacity-75 font-mono">
                                    {m.fileSize || "1.2 MB"}
                                  </p>
                                </div>
                              </a>
                            )}

                            {/* 3. Text content (only show text if type wasn't payloaded as complex files!) */}
                            {m.type === "text" && (
                              <p className="text-xs leading-relaxed whitespace-pre-wrap font-medium break-words">
                                {highlightText(m.content, localSearchQuery)}
                              </p>
                            )}

                            {/* Receipt & Timestamp info */}
                            <div className={`flex items-center justify-end gap-1.5 mt-1 text-[9px] ${
                              isSelf ? "text-blue-100/70 font-mono" : "text-slate-500 font-mono"
                            }`}>
                              <span>
                                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              
                              {/* Double Receipt checks for sent message */}
                              {m.isPending ? (
                                <span className="inline-flex items-center gap-1 text-[9px] text-[#EAB308] font-bold bg-[#EAB308]/10 px-1.5 py-0.5 rounded border border-[#EAB308]/20 animate-pulse select-none" title="Message is in offline queue">
                                  <Timer className="w-3.5 h-3.5 text-[#EAB308]" />
                                  <span>Pending</span>
                                </span>
                              ) : (
                                <MessageStatusIcon status={m.status} isSelf={isSelf} />
                              )}

                              {/* Dynamic disappearing countdown timer display if message is set to expire */}
                              {m.expiresAt && <MessageTimer expiresAt={m.expiresAt} />}
                            </div>
                          </div>

                          {/* Reactions row beneath the bubble */}
                          {m.reactions && Object.keys(m.reactions).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5 z-10">
                              {Object.entries(m.reactions).map(([emoji, userIds]: [string, any]) => {
                                if (userIds.length === 0) return null;
                                const hasMyReaction = userIds.includes(currentUser?.id || "");
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleReaction(m.id, emoji);
                                    }}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold transition-all cursor-pointer border ${
                                      hasMyReaction
                                        ? "bg-blue-500/20 text-blue-300 border-blue-500/40 shadow-sm"
                                        : "bg-[#1C1C1E] text-slate-400 border-white/5 hover:border-slate-500/25 hover:bg-[#2C2C2E]"
                                    }`}
                                    title={`${userIds.length} reaction(s)`}
                                  >
                                    <span>{emoji}</span>
                                    <span className="opacity-90">{userIds.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Reaction Smiley Trigger button on the right of other bubble */}
                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => setActiveMessageMenuId(activeMessageMenuId === m.id ? null : m.id)}
                            className="p-1.5 text-slate-500 hover:text-slate-300 bg-transparent hover:bg-[#202020] rounded-full transition-all cursor-pointer h-8 w-8 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 max-sm:opacity-40"
                            title="Add Reaction"
                          >
                            <Smile className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={messageEndRef} />
              </div>

              {/* Chat input panel */}
              <div className="p-4 bg-[#111111] border-t border-white/5 flex flex-col gap-2 relative">
                
                {/* Real-time Toast/Notification of Delivery Error (e.g. Block status or server error) */}
                {socketErrorAlert && (
                  <div className="bg-rose-500/10 border border-rose-500/25 p-2 px-3 rounded-lg flex items-center gap-2 text-rose-400 text-[11px] font-black animate-pulse shadow-lg self-center select-none z-10">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{socketErrorAlert}</span>
                  </div>
                )}

                {blockedUserIds.includes(activeContact.id) ? (
                  <div className="flex flex-1 items-center justify-center p-3.5 bg-rose-950/20 border border-rose-500/15 rounded-xl text-center">
                    <p className="text-xs text-rose-400 font-bold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                      <span>This profile is blocked.</span>
                      <button
                        type="button"
                        onClick={() => handleToggleBlockContact(activeContact.id)}
                        className="underline text-blue-400 hover:text-blue-300 font-extrabold cursor-pointer ml-1 text-xs"
                      >
                        Unblock
                      </button>
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 w-full">
                    
                    {/* Custom Emoji Picker Box overlay */}
                    {showEmojiPicker && (
                      <EmojiPicker
                        onSelect={(emoji) => {
                          setMessageInput((prev) => {
                            const next = prev + emoji;
                            if (currentUser && activeContact) {
                              saveDraft(currentUser.id, activeContact.id, next);
                            }
                            return next;
                          });
                        }}
                        onClose={() => setShowEmojiPicker(false)}
                      />
                    )}

                    {/* Inner input frame container */}
                    <div className="flex flex-1 items-center gap-2 px-4 bg-[#1C1C1C] rounded-2xl border border-white/5 shadow-inner">
                      {/* Left Drawer actions */}
                      <div className="flex items-center">
                        <button
                          id="toggle-emoji-picker"
                          type="button"
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className="p-2 text-slate-400 hover:text-blue-400 rounded-xl hover:bg-[#242424] transition-all cursor-pointer"
                          title="Emoji picker grid"
                        >
                          <Smile className="w-5 h-5" />
                        </button>

                        <button
                          id="trigger-attachment-btn"
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2 text-slate-400 hover:text-blue-400 rounded-xl hover:bg-[#242424] transition-all cursor-pointer"
                          title="Send file or photo attachment"
                        >
                          <Paperclip className="w-5 h-5" />
                        </button>
                        <input
                          id="manual-file-input"
                          type="file"
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          className="hidden"
                          accept="image/*,application/*,text/*"
                        />
                      </div>

                      {/* Primary typed input field */}
                      <input
                        id="chat-text-input"
                        type="text"
                        value={messageInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMessageInput(val);
                          if (currentUser && activeContact) {
                            saveDraft(currentUser.id, activeContact.id, val);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSendMessage();
                        }}
                        placeholder={isOffline ? "Type a draft message..." : "Type a message..."}
                        className="flex-1 bg-transparent border-none py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-0"
                      />
                    </div>

                    {/* Send dispatch */}
                    <button
                      id="send-message-btn"
                      type="button"
                      disabled={!messageInput.trim()}
                      onClick={handleSendMessage}
                      className="w-11 h-11 bg-blue-600 hover:bg-blue-700 disabled:bg-white/5 disabled:text-slate-600 text-white rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all cursor-pointer shadow-lg shadow-blue-600/20 shrink-0"
                    >
                      <Send className="w-4.5 h-4.5" />
                    </button>
                  </div>
                )}
              </div>

            </div>
          ) : (
            /* Blank Landing page viewport */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#090909]">
              <div className="w-20 h-20 bg-blue-600/10 rounded-3xl text-blue-500 flex items-center justify-center mb-6 animate-pulse">
                <Mail className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-black text-white">
                Gmail Chat & WebRTC calling
              </h3>
              <p className="text-slate-500 text-xs mt-2 max-w-sm leading-normal">
                Select a conversation from the left layout sidebar, or trigger a search directory to register friends by their Gmail address.
              </p>

              {/* Download App Promo - as requested */}
              {!appDownloaded ? (
                <div className="mt-8 p-6 rounded-2xl bg-gradient-to-br from-blue-700/15 to-purple-600/5 border border-blue-500/15 max-w-sm text-left animate-in fade-in duration-300">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-450 flex items-center justify-center shrink-0">
                      <Download className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black tracking-wide text-slate-100 flex items-center gap-1.5 uppercase">
                        <span>Install Mobile/Desktop App</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                        To reply to messages instantly and enable continuous offline-to-online WhatsApp-style routing sync via email, please download our official workspace companion app.
                      </p>
                      <button
                        onClick={handleDownloadApp}
                        disabled={isDownloading}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 active:scale-95 text-white font-bold text-[11px] rounded-xl shadow-lg shadow-blue-500/10 transition-all cursor-pointer"
                      >
                        {isDownloading ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            <span>Downloading client...</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            <span>Download Official Installer</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-8 p-4 flex items-center gap-3 text-xs text-emerald-400 font-bold bg-emerald-500/5 px-5 py-3 border border-emerald-500/15 rounded-2xl animate-in zoom-in-95 max-w-sm text-left">
                  <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-extrabold text-xs uppercase tracking-wide">Workspace client active</p>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">Real email backup synchronization is fully active on your account.</p>
                  </div>
                </div>
              )}

              <button
                id="landing-search-add"
                onClick={() => setShowAddContactModal(true)}
                className="mt-6 px-4 py-2 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-lg shadow-blue-500/10 transition-all duration-150"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Search Gmail IDs Directory</span>
              </button>
            </div>
          )}
        </div>

      </div>

      {/* ========= ADD CONTACT DIRECTORY MODAL LAYOUT ========= */}
      {showAddContactModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-[#161616] rounded-2xl shadow-2xl border border-white/5 overflow-hidden">
            
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-[#1C1C1C]">
              <span className="text-xs font-black uppercase tracking-wide text-blue-400 flex items-center gap-2">
                <UserIcon className="w-4 h-4" />
                Linked Gmail address Directory
              </span>
              <button
                id="close-add-modal"
                type="button"
                onClick={() => setShowAddContactModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddContactSubmit} className="p-5 flex flex-col gap-4">
              <p className="text-[11px] text-slate-500 leading-normal">
                Enter another user's Gmail ID. If they don't have an account, the directory will auto-register them so you can test calling them!
              </p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="search-gmail" className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                  Target Gmail address:
                </label>
                <input
                  id="search-gmail"
                  type="email"
                  value={searchContactEmail}
                  onChange={(e) => setSearchContactEmail(e.target.value)}
                  placeholder="e.g. bob@gmail.com"
                  className="w-full h-11 px-4 rounded-xl bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-medium border-none"
                  required
                />
              </div>

              <button
                id="confirm-link-contact"
                type="submit"
                className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-500/10 transition-all duration-150"
              >
                <Plus className="w-4 h-4" />
                <span>Link and Open Chat</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========= CREATE GROUP CHAT MODAL LAYOUT ========= */}
      {showCreateGroupModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[#161616] rounded-2xl shadow-2xl border border-white/5 overflow-hidden flex flex-col max-h-[85vh]">
            
            {/* Modal Header */}
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-[#1C1C1C] shrink-0">
              <span className="text-xs font-black uppercase tracking-wider text-blue-400 flex items-center gap-2">
                <Users className="w-4.5 h-4.5" />
                Create New Group Chat
              </span>
              <button
                id="close-group-modal"
                type="button"
                onClick={() => {
                  setShowCreateGroupModal(false);
                  setGroupNameInput("");
                  setSelectedGroupMembers([]);
                  setGroupMemberSearchQuery("");
                }}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGroupSubmit} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 text-left">
              {/* Group Name input */}
              <div className="flex flex-col gap-1.5 shrink-0">
                <label htmlFor="group-name-input" className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                  Group Subject / Name:
                </label>
                <input
                  id="group-name-input"
                  type="text"
                  value={groupNameInput}
                  onChange={(e) => setGroupNameInput(e.target.value)}
                  placeholder="e.g. Design Sync Team"
                  className="w-full h-11 px-4 rounded-xl bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-medium border-none"
                  required
                />
              </div>

              {/* Members check-list with high contrast */}
              <div className="flex flex-col gap-2 flex-1 min-h-[220px]">
                <div className="flex justify-between items-center animate-pulse">
                  <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                    Select Participants ({selectedGroupMembers.length} selected):
                  </span>
                </div>

                {/* Sub search within candidate members list */}
                <div className="relative shrink-0">
                  <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={groupMemberSearchQuery}
                    onChange={(e) => setGroupMemberSearchQuery(e.target.value)}
                    placeholder="Search candidate contacts..."
                    className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#1D1D1D] text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 text-[11px] font-medium border border-white/5"
                  />
                </div>

                {/* Candidates Scroll List */}
                <div className="flex-1 overflow-y-auto space-y-1.5 p-1 bg-black/20 rounded-xl border border-white/5 max-h-[250px] min-h-[160px]">
                  {(Object.values(contacts) as User[])
                    .filter((u) => !u.isGroup && u.id !== "gemini_ai_gmail_com") // Avoid nested groups / bots if not wanted
                    .filter((u) => {
                      if (!groupMemberSearchQuery.trim()) return true;
                      return (
                        u.name.toLowerCase().includes(groupMemberSearchQuery.toLowerCase().trim()) ||
                        u.email.toLowerCase().includes(groupMemberSearchQuery.toLowerCase().trim())
                      );
                    })
                    .map((candidate) => {
                      const isSelected = selectedGroupMembers.includes(candidate.id);
                      return (
                        <div
                          key={candidate.id}
                          onClick={() => toggleGroupMemberSelection(candidate.id)}
                          className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all border ${
                            isSelected
                              ? "bg-blue-600/10 border-blue-500/30 text-white"
                              : "bg-[#1E1E21]/40 border-transparent hover:bg-[#1E1E21]/80 text-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <img
                              src={candidate.picture}
                              alt={candidate.name}
                              className="w-8 h-8 rounded-full border border-white/10 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold truncate leading-tight text-white">{candidate.name}</p>
                              <p className="text-[9px] font-mono text-slate-500 truncate mt-0.5">{candidate.email}</p>
                            </div>
                          </div>
                          
                          {/* Checked / Unchecked visual toggle tag */}
                          <div
                            className={`w-4.5 h-4.5 rounded-md flex items-center justify-center border transition-all shrink-0 ${
                              isSelected
                                ? "bg-blue-600 border-blue-500 text-white"
                                : "border-slate-650 hover:border-slate-400 bg-transparent"
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3px]" />}
                          </div>
                        </div>
                      );
                    })}

                  {(Object.values(contacts) as User[]).filter((u) => !u.isGroup && u.id !== "gemini_ai_gmail_com").length === 0 && (
                    <p className="text-center py-6 text-slate-500 text-[10px] italic">
                      No candidate contacts available. Add contacts to link them first.
                    </p>
                  )}
                </div>
              </div>

              {/* Action trigger button */}
              <button
                id="confirm-create-group"
                type="submit"
                disabled={!groupNameInput.trim() || selectedGroupMembers.length === 0}
                className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-500/10 transition-all duration-150 shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Create Group Conversation</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========= EMAIL SERVER INTEGRATION GATEWAY MODAL LAYOUT ========= */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-350">
          <div className="w-full max-w-lg bg-[#161616] rounded-2xl shadow-2xl border border-white/5 overflow-hidden flex flex-col my-auto animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-white/5 flex justify-between items-center bg-[#1C1C1C]">
              <span className="text-xs font-black uppercase tracking-widest text-blue-400 flex items-center gap-2">
                <Mail className="w-5 h-5 text-blue-400" />
                Email Server Connection & API Key
              </span>
              <button
                id="close-email-modal"
                type="button"
                onClick={() => setShowEmailModal(false)}
                className="text-slate-400 hover:text-white hover:bg-white/5 p-1 rounded-lg transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[80vh] flex flex-col gap-5">
              
              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 text-[11px] text-slate-300 leading-relaxed flex items-start gap-3">
                <Server className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-extrabold text-blue-400 uppercase tracking-wider mb-1">How Email Sync Works</p>
                  <span>When a user details a contact that is <strong>offline</strong>, the server acts as an instant delivery proxy: it forwards the message directly to the recipient's real mailbox. They can reply instantly from their email, or click the links to respond in real-time.</span>
                </div>
              </div>

              {/* Status Indicator Alerts */}
              {emailStatus && (
                <div className={`p-4 rounded-xl border flex gap-3 text-xs font-semibold animate-in slide-in-from-top-2 duration-150 ${
                  emailStatus.success 
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                    : "bg-red-500/10 border-red-500/20 text-red-300"
                }`}>
                  {emailStatus.success ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                  )}
                  <span className="leading-normal">{emailStatus.message}</span>
                </div>
              )}

              {/* API Configuration Options */}
              <form onSubmit={handleSaveEmailConfig} className="flex flex-col gap-4">
                
                {/* Method selector info */}
                <div className="grid grid-cols-2 gap-3 bg-[#111] p-1.5 rounded-xl border border-white/5">
                  <div className="p-3 bg-blue-600/10 text-blue-400 border border-blue-500/15 rounded-lg flex flex-col items-center justify-center text-center">
                    <Key className="w-4.5 h-4.5 mb-1" />
                    <span className="text-[10px] font-black uppercase tracking-wide">Resend API Key</span>
                    <span className="text-[8.5px] text-slate-450 mt-0.5">Primary client gateway</span>
                  </div>
                  <div className="p-3 text-slate-400 border border-transparent rounded-lg flex flex-col items-center justify-center text-center">
                    <Server className="w-4.5 h-4.5 mb-1" />
                    <span className="text-[10px] font-black uppercase tracking-wide">Custom SMTP Server</span>
                    <span className="text-[8.5px] text-slate-450 mt-0.5">Alternative mail relay</span>
                  </div>
                </div>

                {/* Input Fields */}
                <div className="flex flex-col gap-3">
                  
                  {/* Resend Secret Key */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                        Resend API Key (re_...):
                      </label>
                      <span className="text-[8px] font-bold text-slate-500 uppercase">Recommended</span>
                    </div>
                    <input
                      type="password"
                      placeholder={emailConfigInput.resendApiKey ? "re_************" : "e.g. re_9A8B7C..."}
                      value={emailConfigInput.resendApiKey}
                      onChange={(e) => setEmailConfigInput({ ...emailConfigInput, resendApiKey: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-medium border border-white/5 placeholder:text-slate-600"
                    />
                  </div>

                  {/* Or SMTP details splitting line */}
                  <div className="relative my-2 text-center">
                    <span className="bg-[#161616] px-3 text-[10px] uppercase font-bold text-slate-500 tracking-wider relative z-10">Or Custom SMTP Fallback Relay</span>
                    <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-white/5"></div>
                  </div>

                  {/* SMTP Server Details Layout */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1.5 col-span-2">
                      <label className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">SMTP Host:</label>
                      <input
                        type="text"
                        placeholder="e.g. smtp.gmail.com"
                        value={emailConfigInput.smtpHost}
                        onChange={(e) => setEmailConfigInput({ ...emailConfigInput, smtpHost: e.target.value })}
                        className="w-full h-9 px-3 rounded-lg bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-medium border border-white/5"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 col-span-1">
                      <label className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">SMTP Port:</label>
                      <input
                        type="text"
                        placeholder="e.g. 587"
                        value={emailConfigInput.smtpPort}
                        onChange={(e) => setEmailConfigInput({ ...emailConfigInput, smtpPort: e.target.value })}
                        className="w-full h-9 px-3 rounded-lg bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-medium border border-white/5"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">SMTP Username:</label>
                      <input
                        type="text"
                        placeholder="e.g. host@gmail.com"
                        value={emailConfigInput.smtpUser}
                        onChange={(e) => setEmailConfigInput({ ...emailConfigInput, smtpUser: e.target.value })}
                        className="w-full h-9 px-3 rounded-lg bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-medium border border-white/5"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">SMTP Password:</label>
                      <input
                        type="password"
                        placeholder={emailConfigInput.smtpPass ? "********" : "e.g. mail_pass_code"}
                        value={emailConfigInput.smtpPass}
                        onChange={(e) => setEmailConfigInput({ ...emailConfigInput, smtpPass: e.target.value })}
                        className="w-full h-9 px-3 rounded-lg bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-medium border border-white/5 placeholder:text-slate-600"
                      />
                    </div>
                  </div>

                  {/* Envelope Sender Address */}
                  <div className="flex flex-col gap-1.5 mt-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                      Sender Name & Address:
                    </label>
                    <input
                      type="text"
                      placeholder='e.g. "Gmail Chat Verification" <your_address@domain.com>'
                      value={emailConfigInput.smtpFrom}
                      onChange={(e) => setEmailConfigInput({ ...emailConfigInput, smtpFrom: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-medium border border-white/5"
                    />
                  </div>

                </div>

                {/* Confirm Settings Controls */}
                <button
                  type="submit"
                  disabled={isSavingEmail}
                  className="w-full h-11 mt-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-55 text-white font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all duration-150"
                >
                  {isSavingEmail ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      <span>Saving connection parameters...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Save Gateway Credentials</span>
                    </>
                  )}
                </button>
              </form>

              {/* Live Dispatch Connection Validation Section */}
              <div className="border-t border-white/5 pt-5 mt-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Live Verification Connection Test</h4>
                <p className="text-[10px] text-slate-500 mb-4 leading-normal">
                  You can immediately test whether emails transit perfectly. Enter an email address to receive a real verification email.
                </p>
                
                <div className="flex gap-3">
                  <input
                    type="email"
                    placeholder="Recipient email (e.g. name@gmail.com)"
                    value={testEmailRecipient}
                    onChange={(e) => setTestEmailRecipient(e.target.value)}
                    className="flex-1 h-10 px-3 rounded-xl bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-medium border border-white/5"
                  />
                  <button
                    onClick={handleTestEmailConfig}
                    disabled={isTestingEmail}
                    className="h-10 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all border border-white/5"
                  >
                    {isTestingEmail ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin"></span>
                        <span>Sending Check Mail...</span>
                      </>
                    ) : (
                      <>
                        <Forward className="w-3.5 h-3.5" />
                        <span>Send Test Email</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ========= WEBRTC ACTIVE CALLING PANEL OVERLAYS ========= */}
      {callState && (
        <CallOverlay
          currentUser={currentUser}
          targetUser={callState.targetUser}
          type={callState.type}
          role={callState.role}
          status={callState.status}
          onAccept={handleAcceptCaller}
          onReject={handleRejectCaller}
          onHangup={handleHangupCall}
          socket={socketRef.current}
          incomingSignal={callState.incomingSignal}
        />
      )}

      {/* ========= FORWARD MESSAGE SELECTION MODAL LAYOUT ========= */}
      {forwardingMessage && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[#161616] rounded-2xl shadow-2xl border border-white/5 overflow-hidden flex flex-col max-h-[85vh]">
            
            {/* Modal Header */}
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-[#1C1C1C]">
              <span className="text-xs font-black uppercase tracking-wide text-blue-400 flex items-center gap-2">
                <Forward className="w-4.5 h-4.5" />
                Forward Message
              </span>
              <button
                type="button"
                onClick={() => {
                  setForwardingMessage(null);
                  setForwardSearchQuery("");
                }}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Message Preview Panel so the sender knows exactly what is being sent */}
            <div className="p-3.5 bg-[#111111] border-b border-white/5 text-xs text-slate-400">
              <span className="text-[10px] uppercase font-black tracking-widest text-[#EAB308] block mb-1.5">Message Content preview:</span>
              <div className="bg-[#1C1C1E] p-3 rounded-xl border border-white/5 max-h-24 overflow-y-auto">
                {forwardingMessage.type === "image" ? (
                  <div className="flex items-center gap-2.5">
                    <img src={forwardingMessage.content} className="w-10 h-10 rounded object-cover border border-white/10" alt="preview" referrerPolicy="no-referrer" />
                    <span className="italic font-bold text-slate-350">Image attachment</span>
                  </div>
                ) : forwardingMessage.type === "file" ? (
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded bg-blue-650/10 text-blue-400">
                      <FileText className="w-5 h-5 shrink-0" />
                    </div>
                    <div className="overflow-hidden">
                      <p className="font-bold text-slate-200 truncate max-w-xs">{forwardingMessage.fileName || "Document attachment"}</p>
                      <p className="text-[9px] text-slate-500 font-mono mt-0.5">{forwardingMessage.fileSize || "1.4 MB"}</p>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-slate-300 font-medium leading-relaxed">{forwardingMessage.content}</p>
                )}
              </div>
            </div>

            {/* Recipient Filter Box */}
            <div className="p-3 bg-[#161616] border-b border-white/5 shrink-0">
              <div className="relative">
                <input
                  id="forward-search-input"
                  type="text"
                  value={forwardSearchQuery}
                  onChange={(e) => setForwardSearchQuery(e.target.value)}
                  placeholder="Search contacts list by name or email..."
                  className="w-full h-10 px-4 pl-10 rounded-xl bg-[#242424] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-semibold placeholder-slate-500 border-none transition-all"
                  autoFocus
                />
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
              </div>
            </div>

            {/* List scroll feed of target recipients */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/5 bg-[#161616] p-1.5 max-h-[40vh]">
              {(() => {
                const query = forwardSearchQuery.trim().toLowerCase();
                const filteredTargets = (Object.values(contacts) as User[]).filter((contact) => {
                  return (
                    contact.name.toLowerCase().includes(query) ||
                    (contact.email && contact.email.toLowerCase().includes(query))
                  );
                });

                if (filteredTargets.length === 0) {
                  return (
                    <div className="p-10 text-center text-slate-500 text-xs flex flex-col items-center gap-2.5">
                      <UserIcon className="w-8 h-8 opacity-40 text-slate-550" />
                      <span>No contacts match "{forwardSearchQuery}"</span>
                    </div>
                  );
                }

                return filteredTargets.map((contact: User) => {
                  return (
                    <div
                      key={contact.id}
                      className="p-3.5 flex items-center justify-between hover:bg-white/5 rounded-xl transition-all group gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <img
                            src={contact.picture}
                            alt={contact.name}
                            className="w-10 h-10 rounded-full object-cover border border-white/5"
                            referrerPolicy="no-referrer"
                          />
                          <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#161616] ${
                            contact.isOnline ? "bg-emerald-500" : "bg-slate-600"
                          }`} />
                        </div>
                        <div className="min-w-0">
                          <h5 className="font-bold text-xs text-white truncate">{contact.name}</h5>
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">{contact.email}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleForwardMessage(contact)}
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] cursor-pointer transition-all flex items-center gap-1.5 shadow-md shadow-blue-500/10 active:scale-95"
                      >
                        <Forward className="w-3.5 h-3.5" />
                        <span>Forward</span>
                      </button>
                    </div>
                  );
                });
              })()}
            </div>

          </div>
        </div>
      )}

      {/* ========= FORWARD MESSAGE SUCCESS TOAST NOTIFICATION CORNER OVERLAY ========= */}
      {forwardStatusAlert && (
        <div className="fixed bottom-24 right-6 z-50 bg-[#1A1A1D]/95 backdrop-blur border border-emerald-500/30 p-4 rounded-xl shadow-2xl flex items-center gap-3.5 max-w-sm animate-in slide-in-from-right-4 fade-in duration-300">
          <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-400 shrink-0">
            <Check className="w-4.5 h-4.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-white">Message Forwarded!</p>
            <p className="text-[10px] text-slate-400 truncate mt-0.5">Successfully sent to {forwardStatusAlert.profile.name}.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveContact(forwardStatusAlert.profile);
              setForwardStatusAlert(null);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-blue-600/25 hover:bg-blue-600/40 text-blue-400 hover:text-blue-300 text-[10px] font-bold cursor-pointer transition-all shrink-0"
          >
            Go to Chat
          </button>
          <button
            type="button"
            onClick={() => setForwardStatusAlert(null)}
            className="text-slate-500 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ========= WHATSAPP PROFILE DETAILS DIALOG (BLOCK / REPORT / SAVE CONTACT) ========= */}
      {showProfileModal && activeContact && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[#161616] rounded-2xl shadow-2xl border border-white/5 overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-[#1C1C1C]">
              <span className="text-xs font-black uppercase tracking-wide text-blue-400 flex items-center gap-2">
                <UserIcon className="w-4.5 h-4.5" />
                Contact Info
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowProfileModal(false);
                  setIsEditingNicknameField(false);
                }}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col items-center gap-5">
              
              {/* Profile Photo Display */}
              <div className="relative group">
                <img
                  src={activeContact.picture}
                  alt={activeContact.name}
                  className="w-24 h-24 rounded-full object-cover border-2 border-white/10 shadow-2xl"
                  referrerPolicy="no-referrer"
                />
                <span className="absolute bottom-0 right-0 w-4.5 h-4.5 rounded-full border-2 border-[#161616] bg-emerald-500" title="Contact active" />
              </div>

              {/* Status Alert for Block/Unblock/Report results */}
              {reportSuccessMsg && (
                <div className="w-full bg-emerald-500/10 border border-emerald-500/25 p-3 rounded-xl text-center text-emerald-400 text-xs font-bold animate-pulse">
                  {reportSuccessMsg}
                </div>
              )}

              {/* Saved Contact Name Details (WhatsApp Style Name customization) */}
              <div className="w-full bg-[#1C1C1D] p-4.5 rounded-2xl border border-white/5 flex flex-col gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                    How you saved this contact
                  </label>
                  
                  {isEditingNicknameField ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="text"
                        value={editingNickname}
                        onChange={(e) => setEditingNickname(e.target.value)}
                        placeholder="Assign a customized name..."
                        className="flex-1 h-9 px-3 rounded-lg bg-[#242424] text-white text-xs font-bold border-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveNickname(activeContact.id, editingNickname)}
                        className="px-3 py-1.5 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs cursor-pointer transition-all shrink-0"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingNicknameField(false)}
                        className="px-2 py-1.5 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 font-bold text-xs cursor-pointer transition-all shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className="text-sm font-extrabold text-white">
                        {nicknames[activeContact.id] || activeContact.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNickname(nicknames[activeContact.id] || activeContact.name);
                          setIsEditingNicknameField(true);
                        }}
                        className="text-slate-400 hover:text-blue-400 p-1.5 hover:bg-[#242424] rounded-lg transition-colors cursor-pointer"
                        title="Edit how you save this person"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="border-t border-white/5 pt-3 flex flex-col gap-1.5 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <span className="text-[10px] font-black uppercase text-slate-550">Gmail ID / Email:</span>
                    <span className="font-semibold text-slate-300 font-mono text-[11px]">{activeContact.email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px] font-black uppercase text-slate-550">Profile Name:</span>
                    <span className="font-semibold text-slate-300">{activeContact.name}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Block, Unblock, Report */}
              <div className="w-full flex flex-col gap-2.5 mt-2">
                <button
                  type="button"
                  onClick={() => handleToggleBlockContact(activeContact.id)}
                  className={`w-full py-2.5 px-4 h-11 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 border ${
                    blockedUserIds.includes(activeContact.id)
                      ? "bg-emerald-600/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-600/15"
                      : "bg-rose-600/10 border-rose-500/20 text-rose-400 hover:bg-rose-600/15"
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>
                    {blockedUserIds.includes(activeContact.id) ? "Unblock Contact" : "Block Contact"}
                  </span>
                </button>

                <div className="border-t border-white/5 my-2.5 pt-3.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#EAB308] block mb-2 text-center">
                    Report Abusive Contact
                  </p>
                  <p className="text-[10px] text-slate-400 leading-relaxed text-center mb-3">
                    If this user is spamming or sharing inappropriate material, submit a report below.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={reportText}
                      onChange={(e) => setReportText(e.target.value)}
                      placeholder="Specify reason (e.g. Abusive, Spam)..."
                      className="flex-1 h-10 px-3 rounded-xl bg-[#1C1C1D] text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#EAB308] border border-white/5 placeholder-slate-550"
                      disabled={isReporting}
                    />
                    <button
                      type="button"
                      onClick={() => handleReportContact(activeContact.id)}
                      disabled={isReporting || !reportText.trim()}
                      className="px-4.5 py-2 h-10 rounded-xl bg-[#EAB308] hover:bg-[#CA9E07] disabled:opacity-50 disabled:cursor-not-allowed text-black font-black text-xs shrink-0 cursor-pointer transition-all"
                    >
                      {isReporting ? "Reporting..." : "Report"}
                    </button>
                  </div>
                </div>

              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
}

// Modular dynamic countdown component for disappearing messages
function MessageTimer({ expiresAt }: { expiresAt?: number }) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!expiresAt) return;

    const update = () => {
      const diff = expiresAt - Date.now();
      setTimeLeft(Math.max(0, diff));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) return null;

  const seconds = Math.floor(timeLeft / 1000);
  if (seconds <= 0) return null;

  let label = "";
  if (seconds < 60) {
    label = `${seconds}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    label = `${mins}m`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    label = `${hours}h`;
  } else {
    const days = Math.floor(seconds / 86400);
    label = `${days}d`;
  }

  return (
    <span className="inline-flex items-center gap-1 ml-1.5 bg-rose-500/10 text-rose-300 border border-rose-500/15 font-black px-1.5 py-0.5 rounded text-[8px] animate-pulse" title="Time remaining until auto-delete">
      <Timer className="w-2 h-2 text-rose-400" />
      <span>{label}</span>
    </span>
  );
}

// Modular Animated Message Status Icon component with smooth fade-in and scale transitions
interface MessageStatusIconProps {
  status?: "sent" | "delivered" | "read";
  isSelf: boolean;
}

function MessageStatusIcon({ status, isSelf }: MessageStatusIconProps) {
  if (!isSelf || !status) return null;

  return (
    <span className="inline-flex items-center justify-center ml-1 select-none" style={{ minWidth: "14px", height: "14px" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ duration: 0.25, ease: "backOut" }}
          className="inline-flex items-center justify-center text-slate-300"
        >
          {status === "sent" && <Check className="w-3.5 h-3.5" />}
          {status === "delivered" && <CheckCheck className="w-3.5 h-3.5" />}
          {status === "read" && <CheckCheck className="w-3.5 h-3.5 text-cyan-300" />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

