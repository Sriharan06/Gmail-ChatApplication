# 🚀 Gmail Chat & AI Live Voice Companion

[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen?style=for-the-badge&logo=render)](https://gmail-chatapplication.onrender.com)

A state-of-the-art, premium real-time chat application featuring **Google Sign-In**, **WebRTC Voice & Video calling**, an **IndexedDB offline-first cache**, real-time **Gemini AI text and live PCM audio conversation companions**, **Firebase Firestore sync with local fallbacks**, and a cryptographically secure **one-click email reply integration**.

---

## 🛠️ Technology Stack

The application is built using a modern, scalable full-stack TypeScript architecture:

### Frontend (Client-side)
*   **Framework**: [React 19](https://react.dev/) (Leveraging concurrent rendering features)
*   **Build System**: [Vite 6](https://vite.dev/) (Lightning-fast HMR and bundle pipeline)
*   **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) (Using the direct `@tailwindcss/vite` integration)
*   **Animations**: [Motion](https://motion.dev/) (For fluid micro-interactions, spring animations, and overlays)
*   **Icons**: [Lucide React](https://lucide.dev/) (Sleek, modern vector icon sets)
*   **Real-time Communication**: [Socket.io Client](https://socket.io/) & [WebRTC APIs](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
*   **Offline Data Store**: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (For local database message caching, drafts, and queueing offline updates)

### Backend (Server-side)
*   **Runtime**: [Node.js](https://nodejs.org/) with [TypeScript](https://www.typescriptlang.org/)
*   **Framework**: [Express 4](https://expressjs.com/) (For Auth callback handlers and REST APIs)
*   **Execution**: [tsx](https://github.com/privatenumber/tsx) (For seamless TypeScript server execution in development)
*   **Real-time Server**: [Socket.io Server](https://socket.io/) (Handling presence state, audio streaming, WebRTC signaling, and messages)
*   **Email Relays**: [Resend SDK](https://resend.com/) & [Nodemailer](https://nodemailer.com/) (SMTP server fallback client)

### Databases & Cloud Integrations
*   **Primary DB Sync**: [Google Cloud Firestore](https://firebase.google.com/docs/firestore) (Synchronized dynamically via `firebase-admin` SDK)
*   **Local DB Sandbox**: `db.json` (Local flat JSON store, acting as a clean fallback when offline or in sandbox mode)
*   **AI Engine**: [Google Gemini APIs](https://ai.google.dev/) (Utilizing `@google/genai` SDK)
    *   *Text Chat model*: `gemini-3.5-flash` (With fallback to `gemini-3.1-flash-lite` with exponential backoff)
    *   *Live Voice model*: `gemini-3.1-flash-live-preview` (Bi-directional low-latency PCM audio streaming)
*   **Identity Provider**: [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)

---

## ✨ Features

*   🔒 **Google Authentication & Mock Mode**: Secure sign-in using official Google OAuth 2.0, with a Mock Sign-In feature for developer testing.
*   💬 **Advanced Messaging**: Real-time message status tracking (sent, delivered, read), emoji reactions, and typing indicators.
*   👥 **Group Chats**: Dynamic group creation, group messages, and email updates to all active group members.
*   🎙️ **WebRTC Voice & Video Calls**: Native, browser-to-browser voice and video calling via WebRTC signaling.
*   🧠 **Gemini Live AI Companion**: 
    *   *Chat*: Natural-sounding conversational buddy that has context memory of up to 15 messages.
    *   *Live Audio*: Real-time audio companion. Clicking the call button connects to Gemini Live, letting you chat out loud using a selection of voice tones (Zephyr, Puck, Charon, Kore, Fenrir) with visual sound orb animations.
*   📧 **Secure One-Click Reply Links**: When a user receives an email notification for a message, the email includes a secure link containing an HMAC signature. Clicking it logs the user in instantly and pre-fills the message text box with a reply draft!
*   ⏳ **Disappearing Messages**: Configurable message lifespans (10s, 1m, 1h, 24h, 7d). A background server thread runs every 2 seconds to prune expired messages from both the local database and Firestore.
*   🛡️ **Safety Integrations**: Built-in user blocking and reporting utilities.

---

## 📐 Architecture & Flow

The following diagram illustrates how WebSocket signaling, WebRTC streams, Firestore replication, and Gemini Live AI interact:

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Alice (Client)
    actor Bob as Bob (Client / Gemini)
    participant Srv as Node Express/Socket.io Server
    database DB as Firestore / db.json
    participant Gem as Google Gemini Live (API)

    %% Authentication
    Note over Alice, Srv: Authentication & Sync
    Alice->>Srv: Google OAuth Consent / Mock Sign-In
    Srv-->>Alice: Authenticated User Info
    Srv->>DB: Pull / Sync User Conversations

    %% Real-time Chat
    Note over Alice, Srv: Real-Time Chat & Offline Email Notification
    Alice->>Srv: Socket.io "message:send"
    Srv->>DB: Replicate & Save Message
    alt Bob is Online
        Srv-->>Bob: Socket.io Emit "message:receive"
        Bob-->>Srv: Socket.io Emit "message:read_all"
    else Bob is Offline
        Srv->>Srv: Generate HMAC Secure Link
        Srv->>Bob: Email Notification (Resend/SMTP) with Secure Link
        Note right of Bob: Bob clicks link to log in & auto-draft reply
    end

    %% WebRTC Signaling
    Note over Alice, Bob: WebRTC Call Signaling (Peer-to-Peer)
    Alice->>Srv: Socket.io "call:dial" (Offer SDP)
    Srv-->>Bob: Socket.io "call:incoming"
    Bob->>Srv: Socket.io "call:response" (Answer SDP)
    Srv-->>Alice: Socket.io "call:response" (Connected)
    Alice<-->Bob: Direct WebRTC Audio/Video Stream

    %% Gemini Live Voice Chat
    Note over Alice, Gem: Gemini Live Voice Session (PCM Streaming)
    Alice->>Srv: Socket.io "gemini:start" (Call request to Gemini)
    Srv->>Gem: GoogleGenAI live.connect WebSocket (PCM 24kHz/16kHz)
    Srv-->>Alice: "gemini:connected"
    Alice->>Srv: "gemini:audio_input" (User Voice PCM 16kHz)
    Srv->>Gem: Send Realtime Input
    Gem-->>Srv: Server Content Response (PCM 24kHz)
    Srv-->>Alice: "gemini:audio" (Playback PCM chunks)
```

---

## ⚙️ Environment Variables & Configuration

Create a `.env` or `.env.local` file in the root directory. Use the following variables to configure the app:

| Variable | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google AI Studio Key for text generator and live voice connections | **Yes** | `AQ.Ab8RN6IMnCB...` |
| `APP_URL` | Base hosting URL (for Google OAuth redirects and email callback links) | **Yes** | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | OAuth Client ID from Google Cloud Console | No (Mock fallback) | `123456-abcdef.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret from Google Cloud Console | No (Mock fallback) | `GOCSPX-abc123xyz` |
| `LINK_SECRET` | Secret key used to sign email HMAC reply tokens | **Yes** | `your_hmac_reply_signing_secret_key` |
| `RESEND_API_KEY` | Resend API Key for high-deliverability email dispatching | No (SMTP fallback) | `re_abc123xyz...` |
| `SMTP_HOST` | Fallback SMTP Relay Server host | No | `smtp.gmail.com` |
| `SMTP_PORT` | Fallback SMTP Relay Server port (Secure: 465, TLS: 587) | No | `587` |
| `SMTP_USER` | Fallback SMTP authentication username | No | `your-smtp-username` |
| `SMTP_PASS` | Fallback SMTP authentication password | No | `your-smtp-password` |
| `SMTP_FROM` | Verified sender address header (e.g. `Gmail Chat <no-reply@domain.com>`) | No | `"Gmail Chat" <onboarding@resend.dev>` |
| `FIREBASE_SERVICE_ACCOUNT` | JSON-string representation of a Google Service Account credentials file | No (db.json fallback)| `'{"type": "service_account", ...}'` |

---

## 🏃 Local Setup & Installation

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v18 or higher) installed on your system.

### 1. Clone the repository and install packages
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` or `.env.local` and fill in the required keys:
```bash
cp .env.example .env
```
*At a minimum, configure `GEMINI_API_KEY`, `APP_URL`, and `LINK_SECRET` to unlock the app's full AI and secure link capabilities.*

### 3. (Optional) Configure Google Firebase Firestore
To utilize Cloud Firestore synchronization instead of the `db.json` local file:
1. Obtain a Firebase Private Key Service Account JSON from the **Firebase Console > Settings > Service Accounts**.
2. Save it as `firebase-service-account.json` in the root folder, OR copy the JSON content directly as a single-line string into the `FIREBASE_SERVICE_ACCOUNT` environment variable.
3. Keep the file `firebase-applet-config.json` configured in the root with your Firestore metadata.

### 4. Run the Development Server
```bash
npm run dev
```
The server will boot and serve the frontend client using Vite's live dev middleware.
Visit [http://localhost:3000](http://localhost:3000) to open the application!

### 5. Production Build
To build the static React assets and compile the server script for production environments:
```bash
npm run build
npm start
```

---

## 🧪 Detailed Feature Spotlights

### 📧 Cryptographic One-Click Replies
When a contact is offline and you send them a message, the server generates a cryptographically signed HMAC token using the `LINK_SECRET`:
$$\text{Signature} = \text{HMAC-SHA256}(\text{LINK\_SECRET}, \text{receiverEmail} + \text{":"} + \text{senderId} + \text{":"} + \text{draftText})$$
This signature is packed into a direct login link in the email notification. When clicked, the receiver is securely validated on the server without password forms, logged in, and has their chat session opened with their reply pre-drafted!

### ⏱️ Disappearing Messages Cleaner Thread
Unlike simple client-side hides, disappearing messages in this app are secure. When set:
1. Messages are written to database stores with an `expiresAt` unix timestamp.
2. A server-side `setInterval` background daemon runs every 2000ms.
3. It filters expired entries, issues a bulk transaction delete to **Firestore**, deletes them from `db.json`, and issues a `messages:deleted` socket broadcast to clear them from browser **IndexedDB** stores on all active client devices.

### 🎙️ Gemini Live Audio PCM Signaling
The Gemini live audio connection relies on full-duplex streaming:
*   The client records the user's mic using an `AudioContext` set to **16kHz sample rate**, converting floats to **16-bit PCM ArrayBuffers** sent as base64 over the Socket.io connection (`gemini:audio_input`).
*   The backend pipes this chunk directly into the `GoogleGenAI` live connection.
*   Gemini returns **24kHz PCM chunks** back, which the backend routes to the client.
*   The client feeds these chunks into a playback queue using a custom web audio buffer source sequence for smooth, gapless voice reproduction.
