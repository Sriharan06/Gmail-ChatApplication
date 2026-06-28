import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import http from "http";
import path from "path";
import { Server, Socket } from "socket.io";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI, Modality } from "@google/genai";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { Resend } from "resend";
import nodemailer from "nodemailer";

// Load types
import { User, Message, CallLog, MessageStatus } from "./src/types.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e7, // 10MB file ceiling
});

const PORT = process.env.PORT || 3000;

// Initialize Database Storage (Simulated robust in-memory/JSON store for Cloud Run sandbox)
const DB_FILE = path.join(process.cwd(), "db.json");

// ========= FIREBASE FIREBASE CONFIGURATION & FIREBASE_ADMIN INITIALIZATION =========
let firestore: Firestore | null = null;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const serviceAccountPath = path.join(process.cwd(), "firebase-service-account.json");
  
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.projectId) {
      let hasCredentials = false;
      let initializeOptions: any = { projectId: config.projectId };

      if (fs.existsSync(serviceAccountPath)) {
        initializeOptions.credential = cert(serviceAccountPath);
        hasCredentials = true;
        console.log("[Firebase] Found local service account JSON. Initializing Admin SDK with key.");
      } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
          initializeOptions.credential = cert(serviceAccount);
          hasCredentials = true;
          console.log("[Firebase] Found FIREBASE_SERVICE_ACCOUNT environment variable. Initializing Admin SDK with JSON.");
        } catch (parseErr: any) {
          console.error("[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable:", parseErr.message || parseErr);
        }
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        hasCredentials = true;
        console.log("[Firebase] GOOGLE_APPLICATION_CREDENTIALS environment variable found.");
      } else if (process.env.K_SERVICE) {
        hasCredentials = true;
        console.log("[Firebase] Running on Google Cloud (Cloud Run). Utilizing Application Default Credentials.");
      } else {
        console.log("[Firebase] Running locally in offline fallback mode. Database records will save to db.json.");
      }

      if (hasCredentials) {
        const firebaseApp = initializeApp(initializeOptions);
        if (config.firestoreDatabaseId) {
          firestore = getFirestore(firebaseApp, config.firestoreDatabaseId);
          console.log(`[Firebase] Lazy initialized with Custom database: ${config.firestoreDatabaseId}`);
        } else {
          firestore = getFirestore(firebaseApp);
          console.log("[Firebase] Lazy initialized default Firestore database");
        }
      }
    }
  }
} catch (e) {
  console.error("[Firebase] Warning: SDK-load or credential auto-discovery failed. Proceeding with db.json fallback:", e);
}

// Helpers for Firestore replication
async function saveMessageToFirestore(message: Message) {
  if (!firestore) return;
  try {
    const serializedMessage = {
      id: message.id || "",
      senderId: message.senderId || "",
      receiverId: message.receiverId || "",
      content: message.content || "",
      type: message.type || "text",
      status: message.status || "sent",
      timestamp: message.timestamp || Date.now(),
      fileName: message.fileName || null,
      fileSize: message.fileSize || null,
      expiresAt: message.expiresAt || null,
      reactions: message.reactions || null,
    };
    await firestore.collection("messages").doc(serializedMessage.id).set(serializedMessage);
    console.log(`[Firebase] Successfully written message doc ${serializedMessage.id}`);
  } catch (err) {
    console.warn(`[Firebase] Could not replicate message to Firestore:`, err);
  }
}

async function updateMessageStatusInFirestore(messageId: string, status: MessageStatus) {
  if (!firestore) return;
  try {
    await firestore.collection("messages").doc(messageId).update({ status });
    console.log(`[Firebase] Status updated for doc ${messageId} to ${status}`);
  } catch (err) {
    console.warn(`[Firebase] Could not update status in Firestore:`, err);
  }
}

async function updateMessageReactionsInFirestore(messageId: string, reactions: any) {
  if (!firestore) return;
  try {
    await firestore.collection("messages").doc(messageId).update({ reactions: reactions || null });
    console.log(`[Firebase] Reactions updated for doc ${messageId}`);
  } catch (err) {
    console.warn(`[Firebase] Could not update reactions in Firestore:`, err);
  }
}

async function deleteMessagesFromFirestore(ids: string[]) {
  if (!firestore || ids.length === 0) return;
  try {
    const batch = firestore.batch();
    ids.forEach((id) => {
      batch.delete(firestore!.collection("messages").doc(id));
    });
    await batch.commit();
    console.log(`[Firebase] Pruned/Removed ${ids.length} expired message docs`);
  } catch (err) {
    console.warn(`[Firebase] Could not perform batch-delete in Firestore:`, err);
  }
}

async function syncMessagesFromFirestore() {
  if (!firestore) return;
  try {
    console.log("[Firebase] Synced fetching messages from Cloud Firestore...");
    const snapshot = await firestore.collection("messages").orderBy("timestamp", "asc").get();
    const loaded: Message[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      const msg: Message = {
        id: data.id,
        senderId: data.senderId,
        receiverId: data.receiverId,
        content: data.content,
        type: data.type,
        status: data.status,
        timestamp: data.timestamp,
      };
      if (data.fileName) msg.fileName = data.fileName;
      if (data.fileSize) msg.fileSize = data.fileSize;
      if (data.expiresAt) msg.expiresAt = data.expiresAt;
      if (data.reactions) msg.reactions = data.reactions;
      loaded.push(msg);
    });

    if (loaded.length > 0) {
      console.log(`[Firebase] Loaded and parsed ${loaded.length} messages`);
      const existingIds = new Set(db.messages.map(m => m.id));
      loaded.forEach(m => {
        if (!existingIds.has(m.id)) {
          db.messages.push(m);
        } else {
          // Sync status and reactions
          const match = db.messages.find(ex => ex.id === m.id);
          if (match) {
            match.status = m.status;
            if (m.reactions) match.reactions = m.reactions;
          }
        }
      });
      // Sort in-memory messages chronologically
      db.messages.sort((a, b) => a.timestamp - b.timestamp);
      // Wait, db is loaded at top, but we'll call saveDatabase afterward
    }
  } catch (err: any) {
    const isPermissionDenied = err && (err.code === 7 || 
      (err.message && (
        err.message.includes("PERMISSION_DENIED") || 
        err.message.toLowerCase().includes("permission") || 
        err.message.toLowerCase().includes("insufficient")
      ))
    );
    if (isPermissionDenied) {
      console.warn(
        "\n================================================================================\n" +
        "[Firebase] WARNING: Firestore connection test returned PERMISSION_DENIED.\n" +
        "This occurs when your project's GCS/IAM service account credentials are propagating\n" +
        "or lack appropriate database roles for the custom database.\n" +
        "Disabling Firestore sync and cleanly falling back to localized storage (db.json)\n" +
        "so the application remains fully functional in local sandbox mode.\n" +
        "================================================================================\n"
      );
      firestore = null;
    } else {
      console.warn("[Firebase] Could not sync latest messages on startup:", err);
    }
  }
}


interface Database {
  users: Record<string, User>;
  messages: Message[];
  calls: CallLog[];
  disappearingSettings?: Record<string, number>; // conversationKey -> duration in ms (0 or undefined = Off)
  emailSettings?: {
    resendApiKey?: string;
    smtpHost?: string;
    smtpPort?: string;
    smtpUser?: string;
    smtpPass?: string;
    smtpFrom?: string;
  };
  blockedUsers?: Record<string, string[]>; // blockerUserId -> array of blockedUserIds
  reportedUsers?: Record<string, { reporterId: string; reason: string; timestamp: number }[]>; // reportedUserId -> list of reports
}

function getConversationKey(userId1: string, userId2: string): string {
  return [userId1, userId2].sort().join(":");
}

// Robust custom helper to send real emails via Resend or SMTP fallbacks
async function sendMessageEmail(senderName: string, receiverEmail: string, messageContent: string, messageType: string, replyToId?: string) {
  const appUrl = process.env.APP_URL || "https://ai.studio/build";
  
  const isMedia = messageType === "image" || messageType === "file";
  const contentDisplay = isMedia ? "sent you a file or attachment" : `"${messageContent}"`;

  let replyLink = appUrl;
  if (replyToId) {
    const draftText = `Hi, responding to your message...`;
    const LINK_SECRET = process.env.LINK_SECRET || "gmail-chat-secure-reply-secret-2026";
    const hmac = crypto.createHmac("sha256", LINK_SECRET);
    hmac.update(`${receiverEmail}:${replyToId}:${draftText}`);
    const sig = hmac.digest("hex");
    
    replyLink = `${appUrl.replace(/\/$/, "")}/?email=${encodeURIComponent(receiverEmail)}&replyTo=${encodeURIComponent(replyToId)}&draft=${encodeURIComponent(draftText)}&sig=${sig}`;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>New Message on Gmail Chat</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
        <tr>
          <td align="center" style="padding: 40px 10px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden; border: 1px solid #e2e8f0;">
              <!-- Header -->
              <tr>
                <td style="background-color: #0b57d0; padding: 24px 32px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">Gmail Chat Invitation</h1>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding: 32px;">
                  <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 24px; font-weight: 600;">Hello!</p>
                  <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 24px; color: #475569;">
                    <strong>${senderName}</strong> sent you a new message:
                  </p>
                  
                  <!-- Message Box -->
                  <div style="background-color: #f1f5f9; border-left: 4px solid #0b57d0; border-radius: 4px; padding: 18px 20px; margin-bottom: 28px; font-style: italic; font-size: 15px; color: #1e293b; line-height: 24px;">
                    ${contentDisplay}
                  </div>

                  <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 22px; color: #475569;">
                    To view this message, reply directly to <strong>${senderName}</strong>, or chat in real-time with automatic voice/video support, please use the secure link below to open the application with a pre-filled reply draft:
                  </p>

                  <!-- Call to Action -->
                  <div style="text-align: center; margin-bottom: 28px;">
                    <a href="${replyLink}" target="_blank" style="background-color: #0b57d0; color: #ffffff; text-decoration: none; padding: 12px 30px; font-size: 15px; font-weight: 600; border-radius: 6px; display: inline-block; box-shadow: 0 4px 6px rgba(11, 87, 208, 0.2); transition: background-color 0.2s;">
                      Securely Reply to Chat
                    </a>
                  </div>

                  <p style="margin: 0; font-size: 13px; line-height: 18px; color: #64748b; text-align: center;">
                    Until you open the application, you will continue to receive instant email notifications for new messages.
                  </p>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; line-height: 18px;">
                  This is an automatic notification from your real-time secure sandbox workspace.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const textContent = `${senderName} sent you a message on Gmail Chat: ${contentDisplay}. Reply directly using this secure link: ${replyLink}`;

  // Evaluate dynamic email settings saved in db.json first, then process.env fallback
  const emailConfig = db.emailSettings || {};
  const resendApiKey = emailConfig.resendApiKey || process.env.RESEND_API_KEY;
  const smtpHost = emailConfig.smtpHost || process.env.SMTP_HOST;
  const smtpPort = emailConfig.smtpPort || process.env.SMTP_PORT;
  const smtpUser = emailConfig.smtpUser || process.env.SMTP_USER;
  const smtpPass = emailConfig.smtpPass || process.env.SMTP_PASS;
  const smtpFrom = emailConfig.smtpFrom || process.env.SMTP_FROM;

  // Try Resend primary client
  let resendAttempted = false;
  if (resendApiKey) {
    resendAttempted = true;
    try {
      console.log(`[Email] Dispatching via Resend API to ${receiverEmail}`);
      const resend = new Resend(resendApiKey);
      const hostFrom = smtpFrom || 'Gmail Chat <onboarding@resend.dev>';
      const response = await resend.emails.send({
        from: hostFrom,
        to: receiverEmail,
        subject: `[New Message] ${senderName} sent you a message`,
        html: htmlContent,
        text: textContent,
      });
      if (response.error) {
        console.error(`[Email] Resend API validation/delivery error:`, response.error);
      } else {
        console.log(`[Email] Resend API success response:`, response.data);
        return;
      }
    } catch (err) {
      console.error(`[Email] Failed to send via Resend API:`, err);
    }
  }

  // Fallback SMTP
  let smtpAttempted = false;
  if (smtpHost && smtpUser && smtpPass) {
    smtpAttempted = true;
    try {
      console.log(`[Email] Dispatching via SMTP (${smtpHost}:${smtpPort || "587"}) to ${receiverEmail}`);
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort || "587"),
        secure: smtpPort === "465",
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const mailOptions = {
        from: smtpFrom || `"Gmail Chat" <${smtpUser}>`,
        to: receiverEmail,
        subject: `[New Message] ${senderName} sent you a message`,
        text: textContent,
        html: htmlContent,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`[Email] SMTP success. Mail ID: ${info.messageId}`);
      return;
    } catch (err) {
      console.error(`[Email] Failed to send via SMTP:`, err);
    }
  }

  if (resendAttempted || smtpAttempted) {
    console.warn(
      `[Email] Could not send real email to ${receiverEmail}. ` +
      `Gateways were configured (Resend: ${resendAttempted ? "Yes" : "No"}, SMTP: ${smtpAttempted ? "Yes" : "No"}), but all attempts failed. ` +
      `Check the logs above for specific validation or connection errors.`
    );
  } else {
    console.warn(
      `[Email] Could not send real email to ${receiverEmail}. ` +
      `No configured Resend API Key or SMTP credentials available. ` +
      `Please configure Email server settings within the application web UI.`
    );
  }
}

let db: Database = {
  users: {
    "alice_gmail_com": {
      id: "alice_gmail_com",
      email: "alice@gmail.com",
      name: "Alice Adams",
      picture: "https://api.dicebear.com/7.x/adventurer/svg?seed=Alice",
      lastSeen: Date.now(),
      isOnline: false,
    },
    "bob_gmail_com": {
      id: "bob_gmail_com",
      email: "bob@gmail.com",
      name: "Bob Baker",
      picture: "https://api.dicebear.com/7.x/adventurer/svg?seed=Bob",
      lastSeen: Date.now(),
      isOnline: false,
    },
    "charlie_gmail_com": {
      id: "charlie_gmail_com",
      email: "charlie@gmail.com",
      name: "Charlie Clark",
      picture: "https://api.dicebear.com/7.x/adventurer/svg?seed=Charlie",
      lastSeen: Date.now(),
      isOnline: false,
    },
    "gemini_ai_gmail_com": {
      id: "gemini_ai_gmail_com",
      email: "gemini_ai@gmail.com",
      name: "Gemini Live AI",
      picture: "https://api.dicebear.com/7.x/bottts/svg?seed=gemini",
      lastSeen: Date.now(),
      isOnline: true,
    }
  },
  messages: [],
  calls: [],
  disappearingSettings: {},
};

// Load DB if exists
if (fs.existsSync(DB_FILE)) {
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(data);
    db = { ...db, ...parsed };
  } catch (err) {
    console.error("Error loading db.json, starting fresh", err);
  }
}

db.disappearingSettings = db.disappearingSettings || {};

// Sync with Firestore database on server boot
db.blockedUsers = db.blockedUsers || {};
db.reportedUsers = db.reportedUsers || {};
(async () => {
  await syncMessagesFromFirestore();
})();

// Guarantee Gemini AI is always present and online
if (!db.users["gemini_ai_gmail_com"]) {
  db.users["gemini_ai_gmail_com"] = {
    id: "gemini_ai_gmail_com",
    email: "gemini_ai@gmail.com",
    name: "Gemini Live AI",
    picture: "https://api.dicebear.com/7.x/bottts/svg?seed=gemini",
    lastSeen: Date.now(),
    isOnline: true,
  };
} else {
  db.users["gemini_ai_gmail_com"].isOnline = true;
  db.users["gemini_ai_gmail_com"].name = "Gemini Live AI";
  db.users["gemini_ai_gmail_com"].picture = "https://api.dicebear.com/7.x/bottts/svg?seed=gemini";
}

// Save DB helper
function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing to db.json", err);
  }
}

// Middleware
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Helper to sanitize emails for Firestore/Local-DB use as key/ID
function emailToId(email: string): string {
  return email.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_");
}

// Decodes JWT (Google ID token) payload simply without bulky external packages
function decodeJwt(token: string) {
  try {
    const segments = token.split(".");
    if (segments.length < 2) return null;
    const payload = segments[1];
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch (e) {
    console.error("Failed to decode JWT token", e);
    return null;
  }
}

// Auth API endpoints
// 1. Get Google OAuth URL
app.get("/api/auth/url", (req: Request, res: Response) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.APP_URL 
    ? `${process.env.APP_URL.replace(/\/$/, "")}/auth/callback`
    : `${req.protocol}://${req.get("host")}/auth/callback`;

  if (!googleClientId) {
    return res.status(400).json({ 
      error: "Google Sign-In is not fully configured on the server. Please define GOOGLE_CLIENT_ID." 
    });
  }

  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
    new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
    }).toString();

  res.json({ url: oauthUrl });
});

// 2. Google OAuth Callback
// Accepts code from Google consent pop-up and exchanges it for user data
app.get(["/auth/callback", "/auth/callback/"], async (req: Request, res: Response) => {
  const { code } = req.query;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.APP_URL 
    ? `${process.env.APP_URL.replace(/\/$/, "")}/auth/callback`
    : `${req.protocol}://${req.get("host")}/auth/callback`;

  if (!code) {
    return res.send(`
      <html>
        <body>
          <script>
            window.opener && window.opener.postMessage({ type: "OAUTH_AUTH_FAILURE", error: "No code received" }, "*");
            window.close();
          </script>
          <p>Auth failed: No code received. Please re-try.</p>
        </body>
      </html>
    `);
  }

  try {
    // Exchange Auth Code for IDs & Access tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: googleClientId || "",
        client_secret: googleClientSecret || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errorData = await tokenRes.text();
      throw new Error(`Google Token Exchange Code Failed: ${errorData}`);
    }

    const tokenData = await tokenRes.json();
    const idToken = tokenData.id_token;
    const profile = decodeJwt(idToken);

    if (!profile || !profile.email) {
      throw new Error("Unable to read user profile from Google ID Token");
    }

    const email = profile.email;
    const name = profile.name || email.split("@")[0];
    const picture = profile.picture || `https://api.dicebear.com/7.x/adventurer/svg?seed=${name}`;
    const userId = emailToId(email);

    // Persist or update user in database
    const existingUser = db.users[userId];
    const updatedUser: User = {
      id: userId,
      email: email,
      name: name,
      picture: picture,
      lastSeen: Date.now(),
      isOnline: existingUser ? existingUser.isOnline : false,
    };

    db.users[userId] = updatedUser;
    saveDatabase();

    // Send token and success signal back to parent React application
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: "OAUTH_AUTH_SUCCESS", 
                user: ${JSON.stringify(updatedUser)} 
              }, "*");
              window.close();
            } else {
              window.location.href = "/";
            }
          </script>
          <p>Logged in successfully as ${email}! Redirecting back...</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("OAuth Exchange Error:", error);
    res.send(`
      <html>
        <body>
          <script>
            window.opener && window.opener.postMessage({ type: "OAUTH_AUTH_FAILURE", error: "${error.message || error}" }, "*");
            window.close();
          </script>
          <p>Authentication error occurred during exchange: ${error.message || error}</p>
        </body>
      </html>
    `);
  }
});

// 3. Developer Mock Sign-In (Highly helpful for sandbox multi-tab peer chats)
app.post("/api/auth/mock", (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Please enter a valid Gmail address/ID" });
  }

  const userId = emailToId(email);
  const existingUser = db.users[userId];
  
  const user: User = {
    id: userId,
    email: email.toLowerCase().trim(),
    name: existingUser ? existingUser.name : email.split("@")[0].replace(/[._\-+]/g, " "),
    picture: existingUser ? existingUser.picture : `https://api.dicebear.com/7.x/adventurer/svg?seed=${email.split("@")[0]}`,
    lastSeen: Date.now(),
    isOnline: false
  };

  db.users[userId] = user;
  saveDatabase();

  res.json({ success: true, user });
});

// 4. Secure Reply to Chat URL Verification
// Accepts email, replyTo, draft, and sig, validates signature and returns/autologs the user
app.post("/api/auth/verify-secure-link", (req: Request, res: Response) => {
  const { email, replyTo, draft, sig } = req.body;
  if (!email || !replyTo || !draft || !sig) {
    return res.status(400).json({ error: "Missing required parameters: email, replyTo, draft, or sig" });
  }

  const secret = process.env.LINK_SECRET || "gmail-chat-secure-reply-secret-2026";
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${email}:${replyTo}:${draft}`);
  const expectedSig = hmac.digest("hex");

  if (expectedSig !== sig) {
    return res.status(403).json({ error: "Unauthorized: Invalid secure link signature" });
  }

  // Signature matches! Automatically find or register recipient user
  const userId = emailToId(email);
  const existingUser = db.users[userId];
  const user: User = {
    id: userId,
    email: email.toLowerCase().trim(),
    name: existingUser ? existingUser.name : email.split("@")[0].replace(/[._\-+]/g, " "),
    picture: existingUser ? existingUser.picture : `https://api.dicebear.com/7.x/adventurer/svg?seed=${email.split("@")[0]}`,
    lastSeen: Date.now(),
    isOnline: false
  };

  db.users[userId] = user;
  saveDatabase();

  res.json({ success: true, user });
});

// Get profiles & chat history for logged user
app.get("/api/users", (req: Request, res: Response) => {
  res.json(Object.values(db.users));
});

// GET email server configuration securely with masked keys/passwords
app.get("/api/email-config", (req: Request, res: Response) => {
  const config = db.emailSettings || {};
  res.json({
    resendApiKey: config.resendApiKey ? `${config.resendApiKey.slice(0, 4)}***${config.resendApiKey.slice(-4)}` : "",
    smtpHost: config.smtpHost || "",
    smtpPort: config.smtpPort || "",
    smtpUser: config.smtpUser || "",
    smtpPass: config.smtpPass ? "********" : "",
    smtpFrom: config.smtpFrom || ""
  });
});

// POST to update email server configuration
app.post("/api/email-config", (req: Request, res: Response) => {
  const { resendApiKey, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom } = req.body;
  const current = db.emailSettings || {};
  
  db.emailSettings = {
    resendApiKey: (resendApiKey === "********" || (resendApiKey && resendApiKey.includes("***"))) ? current.resendApiKey : resendApiKey,
    smtpHost: smtpHost || "",
    smtpPort: smtpPort || "",
    smtpUser: smtpUser || "",
    smtpPass: smtpPass === "********" ? current.smtpPass : smtpPass,
    smtpFrom: smtpFrom || ""
  };

  saveDatabase();
  res.json({ success: true, message: "Email configuration saved successfully." });
});

// POST to instantly test the email server configuration with real delivery
app.post("/api/email-config/test", async (req: Request, res: Response) => {
  const { testEmail, resendApiKey, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom } = req.body;

  if (!testEmail || !testEmail.includes("@")) {
    return res.status(400).json({ error: "Please enter a valid recipient email address for testing." });
  }

  const current = db.emailSettings || {};
  const activeResendKey = (resendApiKey === "********" || (resendApiKey && resendApiKey.includes("***"))) ? current.resendApiKey : resendApiKey;
  const activeSmtpPass = smtpPass === "********" ? current.smtpPass : smtpPass;

  const appUrl = process.env.APP_URL || "https://ai.studio/build";
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Email Sync Verified</title>
    </head>
    <body style="font-family: sans-serif; padding: 24px; color: #1e293b; background-color: #f8fafc;">
      <h2 style="color: #0b57d0; font-size: 22px;">Gmail Chat - Connection Success Verification! 🚀</h2>
      <p style="font-size: 15px; color: #475569;">This is a real-time test email dispatched to verify your new integrated <strong>Email Gateway Server Configuration</strong>.</p>
      
      <div style="background-color: #f1f5f9; border-left: 4px solid #0b57d0; padding: 16px; margin: 20px 0; border-radius: 4px;">
        <strong>Configured Delivery Method:</strong> ${activeResendKey ? "Resend API (Primary Client Mode)" : "Custom SMTP Relay Server"}<br/>
        <strong>Sender Address:</strong> ${smtpFrom || (activeResendKey ? "onboarding@resend.dev" : smtpUser)}<br/>
        <strong>Recipient:</strong> ${testEmail}
      </div>

      <p style="font-size: 15px; color: #475569;">The application is now fully configured! When contacts are offline, any chat messages you send them will instantly forward to their actual email inbox securely, mimicking WhatsApp's seamless cross-device message synchronization.</p>
      <p style="margin-top: 32px;"><a href="${appUrl}" style="background-color: #0b57d0; color: #ffffff; text-decoration: none; padding: 12px 24px; font-weight: 600; border-radius: 6px; display: inline-block;">Return to Chat Workspace</a></p>
    </body>
    </html>
  `;

  // Test Resend API key directly if provided or defined
  if (activeResendKey) {
    try {
      console.log(`[Email-Test] Dispatching Resend test email to ${testEmail}`);
      const resend = new Resend(activeResendKey);
      const fromEmail = smtpFrom || 'Gmail Chat <onboarding@resend.dev>';
      const data = await resend.emails.send({
        from: fromEmail,
        to: testEmail,
        subject: `[Success] Gmail Chat Mail Verification`,
        html: htmlContent,
      });
      console.log(`[Email-Test] Resend Success:`, data);
      return res.json({ success: true, message: "Test email dispatched successfully via Resend API!" });
    } catch (err: any) {
      console.error(`[Email-Test] Resend test failure:`, err);
      return res.status(500).json({ error: `Resend API Error: ${err.message || JSON.stringify(err)}` });
    }
  }

  // Test SMTP directly if provided or defined
  if (smtpHost && smtpUser && activeSmtpPass) {
    try {
      console.log(`[Email-Test] Dispatching SMTP test email to ${testEmail}`);
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort || "587"),
        secure: smtpPort === "465",
        auth: {
          user: smtpUser,
          pass: activeSmtpPass,
        },
      });

      const mailOptions = {
        from: smtpFrom || `"Gmail Chat" <${smtpUser}>`,
        to: testEmail,
        subject: `[Success] Gmail Chat SMTP Verification`,
        html: htmlContent,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`[Email-Test] SMTP Success. Message ID: ${info.messageId}`);
      return res.json({ success: true, message: "Test email dispatched successfully via SMTP!" });
    } catch (err: any) {
      console.error(`[Email-Test] SMTP test failure:`, err);
      return res.status(500).json({ error: `SMTP Server Error: ${err.message || JSON.stringify(err)}` });
    }
  }

  return res.status(400).json({ error: "Missing configuration inputs. Enter a Resend API key, or fill out the SMTP Server details!" });
});

// Register / Search Contact by Gmail ID
app.post("/api/contacts/search", (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Please provide a valid Gmail ID" });
  }

  const searchEmail = email.toLowerCase().trim();
  const userId = emailToId(searchEmail);
  
  // If user does not exist, pre-create or simulate creating them dynamically
  if (!db.users[userId]) {
    const name = searchEmail.split("@")[0].replace(/[._\-+]/g, " ");
    db.users[userId] = {
      id: userId,
      email: searchEmail,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      picture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}`,
      lastSeen: Date.now() - 3600000 * 2, // 2 hours ago
      isOnline: false,
    };
    saveDatabase();
  }

  res.json({ user: db.users[userId] });
});

// GET list of user IDs blocked by a user
app.get("/api/blocks/:userId", (req: Request, res: Response) => {
  const { userId } = req.params;
  const list = db.blockedUsers?.[userId] || [];
  res.json({ blockedIds: list });
});

// POST to toggle block state of a target user
app.post("/api/blocks/toggle", (req: Request, res: Response) => {
  const { userId, targetId } = req.body;
  if (!userId || !targetId) {
    return res.status(400).json({ error: "Missing userId or targetId" });
  }

  db.blockedUsers = db.blockedUsers || {};
  const currentList = db.blockedUsers[userId] || [];
  
  let isBlocked = false;
  if (currentList.includes(targetId)) {
    db.blockedUsers[userId] = currentList.filter(id => id !== targetId);
    isBlocked = false;
  } else {
    db.blockedUsers[userId] = [...currentList, targetId];
    isBlocked = true;
  }

  saveDatabase();
  res.json({ success: true, isBlocked, blockedIds: db.blockedUsers[userId] });
});

// POST to register a report on a user
app.post("/api/report", (req: Request, res: Response) => {
  const { reporterId, targetId, reason } = req.body;
  if (!reporterId || !targetId || !reason) {
    return res.status(400).json({ error: "Missing reporterId, targetId, or report reason" });
  }

  db.reportedUsers = db.reportedUsers || {};
  const list = db.reportedUsers[targetId] || [];
  
  db.reportedUsers[targetId] = [
    ...list,
    {
      reporterId,
      reason,
      timestamp: Date.now()
    }
  ];

  saveDatabase();
  res.json({ success: true, message: "User reported successfully." });
});

// POST to create a new group chat
app.post("/api/groups", (req: Request, res: Response) => {
  const { name, members, createdBy } = req.body;
  if (!name || !members || !Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: "Missing group name or member list" });
  }

  const groupId = `group_${Date.now()}`;
  const groupUser: User = {
    id: groupId,
    email: `${groupId}@group.chat`,
    name: name,
    picture: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name)}`,
    lastSeen: Date.now(),
    isOnline: true,
    isGroup: true,
    members: members,
    createdBy: createdBy || "system",
  };

  db.users[groupId] = groupUser;

  // Add an initial SYSTEM message to welcome users to the group and make the group immediately discoverable!
  const systemMessageId = `msg_system_${Date.now()}`;
  const systemMessage: Message = {
    id: systemMessageId,
    senderId: "system",
    receiverId: groupId,
    content: `Group "${name}" created. Chat started with ${members.length} members!`,
    type: "system",
    status: "read",
    timestamp: Date.now(),
  };

  db.messages.push(systemMessage);
  saveDatabase();
  saveMessageToFirestore(systemMessage);

  // Broadcast to all active group members to dynamically refresh their UI and add the group list!
  members.forEach((memberId) => {
    io.to(`room_${memberId}`).emit("message:receive", systemMessage);
  });

  res.json({ success: true, group: groupUser });
});

// Fetch historical messages
app.get("/api/messages/:userId1/:userId2", (req: Request, res: Response) => {
  const { userId1, userId2 } = req.params;
  const isGroup = userId1.startsWith("group_") || userId2.startsWith("group_");
  const groupId = userId1.startsWith("group_") ? userId1 : userId2;
  const now = Date.now();

  if (isGroup) {
    const filtered = db.messages.filter(
      (m) => m.receiverId === groupId && (!m.expiresAt || m.expiresAt > now)
    );
    
    // Mark group messages as "read" if sender is not the reading user
    let updated = false;
    db.messages.forEach((m) => {
      if (m.receiverId === groupId && m.senderId !== userId1 && m.status !== "read") {
        m.status = "read";
        updateMessageStatusInFirestore(m.id, "read");
        updated = true;
      }
    });

    if (updated) {
      saveDatabase();
    }

    return res.json(filtered);
  }

  const conversationKey = getConversationKey(userId1, userId2);
  const filtered = db.messages.filter(
    (m) =>
      (((m.senderId === userId1 && m.receiverId === userId2) ||
        (m.senderId === userId2 && m.receiverId === userId1)) ||
       (m.senderId === "system" && m.receiverId === conversationKey)) &&
      (!m.expiresAt || m.expiresAt > now)
  );

  // Mark pending unread messages received by userId1 from userId2 as read
  let updated = false;
  db.messages.forEach((m) => {
    if (m.senderId === userId2 && m.receiverId === userId1 && m.status !== "read") {
      m.status = "read";
      updateMessageStatusInFirestore(m.id, "read");
      updated = true;
    }
  });

  if (updated) {
    saveDatabase();
  }

  res.json(filtered);
});

// Fetch disappearing messages setting for a conversation pair
app.get("/api/disappearing-settings/:userId1/:userId2", (req: Request, res: Response) => {
  const { userId1, userId2 } = req.params;
  const key = getConversationKey(userId1, userId2);
  const durationMs = db.disappearingSettings?.[key] || 0;
  res.json({ durationMs });
});

// Fetch active calls history
app.get("/api/calls/:userId", (req: Request, res: Response) => {
  const { userId } = req.params;
  const filtered = db.calls.filter((c) => c.callerId === userId || c.receiverId === userId);
  res.json(filtered.reverse());
});

// Active socket mappings: userId -> list of Socket.id strings (supporting multi-tab clients!)
const userSockets: Record<string, string[]> = {};

function addSocket(userId: string, socketId: string) {
  if (!userSockets[userId]) {
    userSockets[userId] = [];
  }
  if (!userSockets[userId].includes(socketId)) {
    userSockets[userId].push(socketId);
  }
}

function removeSocket(userId: string, socketId: string) {
  if (!userSockets[userId]) return;
  userSockets[userId] = userSockets[userId].filter((id) => id !== socketId);
  if (userSockets[userId].length === 0) {
    delete userSockets[userId];
  }
}

// WebSocket real-time communication handling
io.on("connection", (socket: Socket) => {
  let authenticatedUserId: string | null = null;
  let geminiSession: any = null;

  // Handle user connecting and declaring their identity
  socket.on("auth:init", ({ userId }: { userId: string }) => {
    if (!userId || !db.users[userId]) return;
    
    authenticatedUserId = userId;
    addSocket(userId, socket.id);
    
    // Join personal identity room
    socket.join(`room_${userId}`);

    // Update state to Online
    db.users[userId].isOnline = true;
    db.users[userId].lastSeen = Date.now();
    saveDatabase();

    // Broadcast updated presence
    io.emit("presence:update", {
      userId,
      isOnline: true,
      lastSeen: db.users[userId].lastSeen,
    });

    // Mark outstanding incoming messages for them as delivered
    db.messages.forEach((msg) => {
      if (msg.receiverId === userId && msg.status === "sent") {
        msg.status = "delivered";
        updateMessageStatusInFirestore(msg.id, "delivered");
        // Notify sender their message was delivered
        io.to(`room_${msg.senderId}`).emit("message:status_changed", {
          messageId: msg.id,
          status: "delivered",
        });
      }
    });
    saveDatabase();

    console.log(`User ${userId} [${socket.id}] connected and authenticated.`);
  });

  // Handle private message sending
  socket.on("message:send", (payload: Omit<Message, "status" | "timestamp">) => {
    if (!authenticatedUserId) return;

    // Block list check
    const isReceiverBlockingSender = db.blockedUsers?.[payload.receiverId]?.includes(authenticatedUserId);
    const isSenderBlockingReceiver = db.blockedUsers?.[authenticatedUserId]?.includes(payload.receiverId);

    if (isReceiverBlockingSender || isSenderBlockingReceiver) {
      socket.emit("message:error", {
        message: isSenderBlockingReceiver 
          ? "You have blocked this contact. Unblock them first to send messages."
          : "Message could not be delivered. You have been blocked by this user."
      });
      return;
    }

    const messageId = payload.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const hasActiveSockets = userSockets[payload.receiverId] && userSockets[payload.receiverId].length > 0;
    
    const conversationKey = getConversationKey(authenticatedUserId, payload.receiverId);
    const durationMs = db.disappearingSettings?.[conversationKey] || 0;
    const expiresAt = durationMs > 0 ? Date.now() + durationMs : undefined;

    const newMessage: Message = {
      id: messageId,
      senderId: authenticatedUserId,
      receiverId: payload.receiverId,
      content: payload.content,
      type: payload.type,
      status: hasActiveSockets ? "delivered" : "sent",
      timestamp: Date.now(),
      fileName: payload.fileName,
      fileSize: payload.fileSize,
      expiresAt,
    };

    if (payload.receiverId === "gemini_ai_gmail_com") {
      db.messages.push(newMessage);
      saveDatabase();
      saveMessageToFirestore(newMessage);
      io.to(`room_${authenticatedUserId}`).emit("message:receive", newMessage);

      // Trigger Gemini AI companion Typing status
      io.to(`room_${authenticatedUserId}`).emit("chat:typing", {
        senderId: "gemini_ai_gmail_com",
        isTyping: true,
      });

      // Query Gemini AI server side
      (async () => {
        try {
          const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: {
              headers: {
                'User-Agent': "aistudio-build",
              }
            }
          });

          // Fetch a brief conversation history to pass as context
          const history = db.messages.filter(
            (m) =>
              (m.senderId === authenticatedUserId && m.receiverId === "gemini_ai_gmail_com") ||
              (m.senderId === "gemini_ai_gmail_com" && m.receiverId === authenticatedUserId)
          ).slice(-15);

          const contents = history.map((m) => ({
            role: m.senderId === authenticatedUserId ? "user" : "model",
            parts: [{ text: m.content || "" }]
          }));

          // Robust try-generate helper with exponential backoff & model fallback
          async function tryGenerateWithRetry(payloadContents: any[]): Promise<string> {
            const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
            let lastError: any = null;

            for (const modelName of modelsToTry) {
              const maxRetries = 2; // Retry 2 times per model if rate-limited or busy (total 3 attempts)
              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                  const response = await ai.models.generateContent({
                    model: modelName,
                    contents: payloadContents,
                    config: {
                      systemInstruction: "You are Gemini Live AI, a supportive conversation partner and virtual companion inside Gmail Chat. Talk naturally, friendly, and briefly (2-3 sentences max). Suggest initiating a Voice Conversation with you anytime by clicking the Call icon in the header."
                    }
                  });
                  if (response && response.text) {
                    console.log(`[Gemini] Successfully generated response after ${attempt} retry attempts using model ${modelName}`);
                    return response.text;
                  }
                } catch (err: any) {
                  lastError = err;
                  const isRetryable = err.status === 503 || err.status === 429 || 
                                     (err.message && (err.message.includes("503") || err.message.toLowerCase().includes("high demand") || err.message.includes("429") || err.message.toLowerCase().includes("unavailable")));
                  
                  if (isRetryable && attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 600; // 600ms, 1200ms
                    console.warn(`[Gemini] Warning: Model ${modelName} returned high-demand or transient error (${err.message || '503'}). Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                  } else {
                    console.warn(`[Gemini] Model ${modelName} failed or exhausted retries: ${err.message || err}`);
                    break; // Move to next fallback model
                  }
                }
              }
            }
            throw lastError || new Error("Failed to generate content after trying multiple models.");
          }

          let replyText = "";
          try {
            replyText = await tryGenerateWithRetry(contents);
          } catch (err: any) {
            console.error("Gemini companion error (all models failed):", err);
            if (!process.env.GEMINI_API_KEY) {
              replyText = "Communication issue: GEMINI_API_KEY is missing on the server. Please add it to your Settings > Secrets panel.";
            } else {
              replyText = "Hey! I'm running into a tiny bit of high demand at the moment. Let's keep chatting—could you please try resending your message? ✨";
            }
          }

          const replyMessage: Message = {
            id: `msg_${Date.now()}_gemini`,
            senderId: "gemini_ai_gmail_com",
            receiverId: authenticatedUserId,
            content: replyText,
            type: "text",
            status: "read",
            timestamp: Date.now(),
          };

          db.messages.push(replyMessage);
          saveDatabase();
          saveMessageToFirestore(replyMessage);

          io.to(`room_${authenticatedUserId}`).emit("chat:typing", {
            senderId: "gemini_ai_gmail_com",
            isTyping: false,
          });
          io.to(`room_${authenticatedUserId}`).emit("message:receive", replyMessage);
        } catch (err: any) {
          console.error("Fatal outer exception in Gemini block:", err);
          io.to(`room_${authenticatedUserId}`).emit("chat:typing", {
            senderId: "gemini_ai_gmail_com",
            isTyping: false,
          });

          const errMessage: Message = {
            id: `msg_${Date.now()}_gemini_err`,
            senderId: "gemini_ai_gmail_com",
            receiverId: authenticatedUserId,
            content: `Communication error with Gemini: ${err.message || "Please make sure your GEMINI_API_KEY is configured."}`,
            type: "text",
            status: "read",
            timestamp: Date.now(),
          };
          io.to(`room_${authenticatedUserId}`).emit("message:receive", errMessage);
        }
      })();
      return;
    }

    const targetUser = db.users[payload.receiverId];
    if (targetUser && targetUser.isGroup && targetUser.members) {
      db.messages.push(newMessage);
      saveDatabase();
      saveMessageToFirestore(newMessage);

      const senderUser = db.users[authenticatedUserId];
      const senderName = senderUser ? senderUser.name : "A User";

      // Emit to all group members
      targetUser.members.forEach((memberId) => {
        io.to(`room_${memberId}`).emit("message:receive", newMessage);

        // Send an email notification to all group members (excluding the sender)
        if (memberId !== authenticatedUserId) {
          const mUser = db.users[memberId];
          if (mUser && mUser.email && mUser.email.includes("@")) {
            sendMessageEmail(`${senderName} (Group: ${targetUser.name})`, mUser.email, newMessage.content, newMessage.type, targetUser.id).catch((err) => {
              console.error("[Email] Error dispatching group notification email:", err);
            });
          }
        }
      });
      console.log(`Group message sent from ${authenticatedUserId} to group ${payload.receiverId}`);
      return;
    }

    db.messages.push(newMessage);
    saveDatabase();
    saveMessageToFirestore(newMessage);

    // Emit back to sender's own devices (multi-tab sync)
    io.to(`room_${authenticatedUserId}`).emit("message:receive", newMessage);

    // Emit to receiver's devices
    io.to(`room_${payload.receiverId}`).emit("message:receive", newMessage);

    // Dispatch a real notification email (always send when a message is dispatched)
    const senderUser = db.users[authenticatedUserId];
    const senderName = senderUser ? senderUser.name : "A User";
    const receiverUser = db.users[payload.receiverId];
    if (receiverUser && receiverUser.email && receiverUser.email.includes("@")) {
      sendMessageEmail(senderName, receiverUser.email, newMessage.content, newMessage.type, authenticatedUserId).catch((err) => {
        console.error("[Email] Error dispatching message notification email:", err);
      });
    }

    console.log(`Message sent from ${authenticatedUserId} to ${payload.receiverId}`);
  });

  // Handle read receipt marking
  socket.on("message:read_all", ({ senderId }: { senderId: string }) => {
    if (!authenticatedUserId || !senderId) return;

    let updated = false;
    db.messages.forEach((msg) => {
      if (msg.senderId === senderId && msg.receiverId === authenticatedUserId && msg.status !== "read") {
        msg.status = "read";
        updateMessageStatusInFirestore(msg.id, "read");
        updated = true;
        // Emit receipt update
        io.to(`room_${senderId}`).emit("message:status_changed", {
          messageId: msg.id,
          status: "read",
        });
      }
    });

    if (updated) {
      saveDatabase();
    }
  });

  // Handle typing indicator status
  socket.on("chat:typing", (payload: { receiverId: string; isTyping: boolean }) => {
    if (!authenticatedUserId) return;
    const isGroup = payload.receiverId && payload.receiverId.startsWith("group_");
    if (isGroup) {
      const groupUser = db.users[payload.receiverId];
      if (groupUser && groupUser.isGroup && groupUser.members) {
        groupUser.members.forEach((memberId) => {
          if (memberId !== authenticatedUserId) {
            io.to(`room_${memberId}`).emit("chat:typing", {
              senderId: authenticatedUserId,
              receiverId: payload.receiverId, // Specify the group ID so client knows which group chat typing is happening in
              isTyping: payload.isTyping,
            });
          }
        });
      }
    } else {
      io.to(`room_${payload.receiverId}`).emit("chat:typing", {
        senderId: authenticatedUserId,
        isTyping: payload.isTyping,
      });
    }
  });

  // Handle message reaction toggling
  socket.on("message:react", ({ messageId, emoji }: { messageId: string; emoji: string }) => {
    if (!authenticatedUserId || !messageId || !emoji) return;

    const msg = db.messages.find((m) => m.id === messageId);
    if (!msg) return;

    if (!msg.reactions) {
      msg.reactions = {};
    }

    if (!msg.reactions[emoji]) {
      msg.reactions[emoji] = [];
    }

    const index = msg.reactions[emoji].indexOf(authenticatedUserId);
    if (index > -1) {
      // Toggle off: user already reacted with this emoji, remove it
      msg.reactions[emoji].splice(index, 1);
      // Clean up empty emoji lists
      if (msg.reactions[emoji].length === 0) {
        delete msg.reactions[emoji];
      }
    } else {
      // Toggle on: add the user
      msg.reactions[emoji].push(authenticatedUserId);
    }

    saveDatabase();
    updateMessageReactionsInFirestore(msg.id, msg.reactions);

    // Broadcast the reaction update to all members if it's a group chat, otherwise to both rooms
    const isGroup = msg.receiverId && msg.receiverId.startsWith("group_");
    const reactionUpdate = {
      messageId: msg.id,
      reactions: msg.reactions,
    };

    if (isGroup) {
      const groupUser = db.users[msg.receiverId];
      if (groupUser && groupUser.isGroup && groupUser.members) {
        groupUser.members.forEach((memberId) => {
          io.to(`room_${memberId}`).emit("message:reaction_updated", reactionUpdate);
        });
      }
    } else {
      const roomA = `room_${msg.senderId}`;
      const roomB = `room_${msg.receiverId}`;
      io.to(roomA).emit("message:reaction_updated", reactionUpdate);
      io.to(roomB).emit("message:reaction_updated", reactionUpdate);
    }
  });

  // Handle disappearing messages setting changes
  socket.on("disappearing:change", ({ userId1, userId2, durationMs }: { userId1: string; userId2: string; durationMs: number }) => {
    if (!authenticatedUserId) return;

    const key = getConversationKey(userId1, userId2);
    db.disappearingSettings = db.disappearingSettings || {};
    db.disappearingSettings[key] = durationMs;
    saveDatabase();

    // Broadcast update to both users so clients sync state instantly
    io.to(`room_${userId1}`).emit("disappearing:update", { userId1, userId2, durationMs });
    io.to(`room_${userId2}`).emit("disappearing:update", { userId1, userId2, durationMs });

    // Generate and push a clean system message that alerts both peers beautifully
    const changerName = db.users[authenticatedUserId]?.name || "Someone";
    let messageText = "";
    if (durationMs <= 0) {
      messageText = `${changerName} turned off disappearing messages.`;
    } else {
      let durationStr = "";
      if (durationMs === 10000) durationStr = "10 seconds";
      else if (durationMs === 60000) durationStr = "1 minute";
      else if (durationMs === 3600000) durationStr = "1 hour";
      else if (durationMs === 86400000) durationStr = "24 hours";
      else if (durationMs === 604800000) durationStr = "7 days";
      else durationStr = `${durationMs / 1000}s`;
      
      messageText = `${changerName} set messages to disappear after ${durationStr}.`;
    }

    const systemMessage: Message = {
      id: `sys_${Date.now()}_disappearing`,
      senderId: "system",
      receiverId: key, // conversation key
      content: messageText,
      type: "system",
      status: "read",
      timestamp: Date.now(),
    };

    db.messages.push(systemMessage);
    saveDatabase();
    saveMessageToFirestore(systemMessage);

    // Broadcast system message alert to both user client sockets
    io.to(`room_${userId1}`).emit("message:receive", systemMessage);
    io.to(`room_${userId2}`).emit("message:receive", systemMessage);

    console.log(`[Disappearing] Changed timer to ${durationMs}ms for key ${key} by ${changerName}`);
  });

  // ========== GEMINI LIVE AUDIO SIGNALING ENDPOINTS ==========
  socket.on("gemini:start", async (payload: { voice?: string } = {}) => {
    try {
      if (geminiSession) {
        try {
          await geminiSession.close();
        } catch (_) {}
        geminiSession = null;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        socket.emit("gemini:error", { message: "GEMINI_API_KEY environment variable is missing on the server. Please add it to your Settings > Secrets panel." });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': "aistudio-build",
          }
        }
      });

      console.log(`[GeminiLive] Handshaking with Gemini Live API for user: ${authenticatedUserId}`);
      geminiSession = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: payload.voice || "Zephyr" }
            }
          },
          systemInstruction: "You are Gemini Live, a fast, engaging voice assistant. Keep your answers brief, friendly, natural, and highly conversational. Answer directly under two sentences.",
        },
        callbacks: {
          onmessage: (message: any) => {
            const dataBytes = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (dataBytes) {
              socket.emit("gemini:audio", { audio: dataBytes });
            }
            if (message.serverContent?.interrupted) {
              socket.emit("gemini:interrupted");
            }
          },
          onclose: () => {
            console.log("[GeminiLive] Connection closed by Gemini Live endpoint.");
            socket.emit("gemini:closed");
            geminiSession = null;
          }
        },
      });

      console.log("[GeminiLive] Handshake accomplished with Google backends.");
      socket.emit("gemini:connected");
    } catch (err: any) {
      console.error("[GeminiLive] Exception starting Live Session:", err);
      socket.emit("gemini:error", { message: err.message || "Failed to start Gemini Live voice handshakes." });
    }
  });

  socket.on("gemini:audio_input", (payload: { audio: string }) => {
    if (geminiSession) {
      try {
        geminiSession.sendRealtimeInput({
          audio: { data: payload.audio, mimeType: "audio/pcm;rate=16000" }
        });
      } catch (err) {
        console.error("Failed sending live audio chunk to Gemini Live:", err);
      }
    }
  });

  socket.on("gemini:stop", async () => {
    if (geminiSession) {
      console.log("[GeminiLive] Terminating active companion session...");
      try {
        await geminiSession.close();
      } catch (_) {}
      geminiSession = null;
      socket.emit("gemini:closed");
    }
  });

  // WebRTC Audio/Video Call Signaling Flow
  // 1. Caller starts dial
  socket.on("call:dial", (payload: { receiverId: string; type: "voice" | "video"; offerSignal: any }) => {
    if (!authenticatedUserId) return;

    const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    const callerMeta = db.users[authenticatedUserId];
    if (!callerMeta) return;

    console.log(`[Call] Dialing from ${authenticatedUserId} to ${payload.receiverId} (Type: ${payload.type})`);

    // Redirect dial request to receiver's devices
    io.to(`room_${payload.receiverId}`).emit("call:incoming", {
      callId,
      callerId: authenticatedUserId,
      callerName: callerMeta.name,
      callerPicture: callerMeta.picture,
      type: payload.type,
      offerSignal: payload.offerSignal,
    });
  });

  // 2. Transports SDP and Ice Candidates between peer clients transparently
  socket.on("call:signal", (payload: { targetId: string; signal: any }) => {
    if (!authenticatedUserId) return;
    io.to(`room_${payload.targetId}`).emit("call:signal", {
      senderId: authenticatedUserId,
      signal: payload.signal,
    });
  });

  // 3. Receiver actions call state: Accept, Reject, No-Answer
  socket.on("call:response", (payload: { callId: string; callerId: string; status: "connected" | "rejected" | "no-answer"; answerSignal?: any }) => {
    if (!authenticatedUserId) return;

    console.log(`[Call] Response from ${authenticatedUserId} to ${payload.callerId}: ${payload.status}`);

    // Notify caller
    io.to(`room_${payload.callerId}`).emit("call:response", {
      callId: payload.callId,
      receiverId: authenticatedUserId,
      status: payload.status,
      answerSignal: payload.answerSignal,
    });

    // Save Call logs appropriately
    const duration = payload.status === "connected" ? 0 : undefined;
    db.calls.push({
      id: payload.callId,
      callerId: payload.callerId,
      receiverId: authenticatedUserId,
      type: "video", // Will default or can be sync'd dynamically
      status: payload.status,
      timestamp: Date.now(),
      duration,
    });
    saveDatabase();
  });

  // 4. Hang up active call
  socket.on("call:hangup", (payload: { targetId: string; duration?: number }) => {
    if (!authenticatedUserId) return;

    console.log(`[Call] Hangup between ${authenticatedUserId} and ${payload.targetId}`);
    io.to(`room_${payload.targetId}`).emit("call:hangup", { senderId: authenticatedUserId });
  });

  // Disconnection logic
  socket.on("disconnect", () => {
    if (geminiSession) {
      console.log(`[GeminiLive] Client disconnected. Cleaning up session for user ${authenticatedUserId}`);
      try {
        geminiSession.close();
      } catch (_) {}
      geminiSession = null;
    }

    if (!authenticatedUserId) return;

    removeSocket(authenticatedUserId, socket.id);

    // If no sockets left for this user, mark them offline
    if (!userSockets[authenticatedUserId] || userSockets[authenticatedUserId].length === 0) {
      db.users[authenticatedUserId].isOnline = false;
      db.users[authenticatedUserId].lastSeen = Date.now();
      saveDatabase();

      io.emit("presence:update", {
        userId: authenticatedUserId,
        isOnline: false,
        lastSeen: db.users[authenticatedUserId].lastSeen,
      });

      console.log(`User ${authenticatedUserId} has gone completely offline.`);
    }
  });
});

// Active background processor to check and delete expired messages every 2 sec
setInterval(() => {
  try {
    const now = Date.now();
    const expiredMessages = db.messages.filter((m) => m.expiresAt && m.expiresAt < now);
    
    if (expiredMessages.length > 0) {
      db.messages = db.messages.filter((m) => !m.expiresAt || m.expiresAt >= now);
      saveDatabase();
      
      const expiredIds = expiredMessages.map((m) => m.id);
      deleteMessagesFromFirestore(expiredIds);
      io.emit("messages:deleted", { ids: expiredIds });
      console.log(`[Cleaner] Automatically pruned ${expiredIds.length} expired messages: ${expiredIds.join(", ")}`);
    }
  } catch (err) {
    console.error("[Cleaner] Error running background pruning interval:", err);
  }
}, 2000);

// Serve frontend build and mount Vite middlewares for instant dev refresh handling
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Vite middleware for lightning-fast live development
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production statics
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Use the standard HTTP wrapper to allow Socket.IO and Express to serve on the same 3000 container port!
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Gmail Chat Fullstack Server Running on: http://localhost:${PORT}`);
    console.log(`Local Time: 2026-06-17T02:01:31-07:00`);
  });
}

startServer();
