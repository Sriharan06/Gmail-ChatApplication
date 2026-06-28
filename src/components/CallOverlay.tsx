import React, { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Volume2, ShieldAlert, Sparkles, Clock } from "lucide-react";
import { User, CallType } from "../types";

// Helper functions for raw PCM audio conversions required for low-latency live streaming
function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

function base64ArrayBuffer(arrayBuffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

interface CallOverlayProps {
  currentUser: User;
  targetUser: User;
  type: CallType;
  role: "caller" | "receiver";
  status: "ringing" | "dialing" | "connected";
  onAccept: (answerSignal?: any) => void;
  onReject: () => void;
  onHangup: (duration: number) => void;
  socket: any; // Socket connection to exchange signals
  incomingSignal?: any; // Offer SDP from caller (if role is receiver)
}

export default function CallOverlay({
  currentUser,
  targetUser,
  type,
  role,
  status: initialStatus,
  onAccept,
  onReject,
  onHangup,
  socket,
  incomingSignal,
}: CallOverlayProps) {
  const [status, setStatus] = useState(initialStatus);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [streamError, setStreamError] = useState<string | null>(null);

  const isGemini = targetUser.id === "gemini_ai_gmail_com";
  const [activeVoice, setActiveVoice] = useState<string>("Zephyr");
  const [geminiStatus, setGeminiStatus] = useState<"connecting" | "ready" | "speaking" | "listening">("connecting");
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  const geminiInputAudioCtxRef = useRef<AudioContext | null>(null);
  const geminiProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const geminiMicStreamRef = useRef<MediaStream | null>(null);
  const geminiOutputAudioCtxRef = useRef<AudioContext | null>(null);
  const geminiNextStartTimeRef = useRef<number>(0);
  const geminiActiveSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const visualIntervalRef = useRef<any>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const durationTimerRef = useRef<any>(null);

  // Sync state transitions if prop changes
  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  // Track call duration timer once connected
  useEffect(() => {
    if (status === "connected") {
      setCallDuration(0);
      durationTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    }
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [status]);

  // === GEMINI LIVE VOICE SESSION MANAGER ===
  useEffect(() => {
    if (!isGemini) return;

    let active = true;

    // Playback gapless PCM chunks received from socket
    function playPCMChunk(base64Data: string) {
      if (!geminiOutputAudioCtxRef.current) {
        try {
          geminiOutputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        } catch (e) {
          console.error("Failed to construct playback audio context:", e);
          return;
        }
      }

      const ctx = geminiOutputAudioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      // Calculate voice amplitude level for visual orb rendering
      let sum = 0;
      for (let i = 0; i < float32Array.length; i++) {
        sum += float32Array[i] * float32Array[i];
      }
      const rms = Math.sqrt(sum / (float32Array.length || 1));
      const peak = Math.min(100, Math.round(rms * 500));
      setAudioLevel(peak);

      const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      geminiActiveSourcesRef.current.push(source);

      source.onended = () => {
        geminiActiveSourcesRef.current = geminiActiveSourcesRef.current.filter((s) => s !== source);
      };

      const currentTime = ctx.currentTime;
      if (geminiNextStartTimeRef.current < currentTime) {
        geminiNextStartTimeRef.current = currentTime + 0.04; 
      }

      source.start(geminiNextStartTimeRef.current);
      geminiNextStartTimeRef.current += audioBuffer.duration;
    }

    function handleInterruption() {
      console.log("[Gemini] Audio streaming interrupted.");
      geminiActiveSourcesRef.current.forEach((source) => {
        try {
          source.stop();
        } catch (_) {}
      });
      geminiActiveSourcesRef.current = [];
      geminiNextStartTimeRef.current = 0;
      setAudioLevel(0);
    }

    // Set up listeners mapped on socket
    socket.on("gemini:connected", () => {
      console.log("[GeminiLive] Connection fully established.");
      if (active) {
        setGeminiStatus("listening");
        setStatus("connected");
      }
    });

    socket.on("gemini:audio", (payload: { audio: string }) => {
      if (active) {
        setGeminiStatus("speaking");
        playPCMChunk(payload.audio);
      }
    });

    socket.on("gemini:interrupted", () => {
      if (active) {
        handleInterruption();
        setGeminiStatus("listening");
      }
    });

    socket.on("gemini:error", (payload: { message: string }) => {
      if (active) {
        setGeminiError(payload.message);
        setGeminiStatus("listening");
      }
    });

    socket.on("gemini:closed", () => {
      if (active) {
        setGeminiStatus("connecting");
      }
    });

    // Start server-side session
    socket.emit("gemini:start", { voice: activeVoice });

    // Try to record audio from microphone
    async function initMicrophone() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        geminiMicStreamRef.current = stream;

        // Initialize user mic input context at exactly 16000Hz (requirement for speech conversion to Gemini)
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        geminiInputAudioCtxRef.current = inputCtx;

        const sourceNode = inputCtx.createMediaStreamSource(stream);
        const processorNode = inputCtx.createScriptProcessor(2048, 1, 1);
        geminiProcessorRef.current = processorNode;

        sourceNode.connect(processorNode);
        processorNode.connect(inputCtx.destination);

        processorNode.onaudioprocess = (e) => {
          if (!active) return;
          const float32Samples = e.inputBuffer.getChannelData(0);
          
          // Compute RMS for user's own input as well
          if (geminiStatus === "listening" || geminiStatus === "ready") {
            let uSum = 0;
            for (let i = 0; i < float32Samples.length; i++) {
              uSum += float32Samples[i] * float32Samples[i];
            }
            const uRms = Math.sqrt(uSum / (float32Samples.length || 1));
            if (uRms > 0.01) {
              setAudioLevel(Math.min(100, Math.round(uRms * 350)));
            }
          }

          const rawPCM = floatTo16BitPCM(float32Samples);
          const base64Samples = base64ArrayBuffer(rawPCM);

          socket.emit("gemini:audio_input", { audio: base64Samples });
        };

      } catch (err: any) {
        console.error("[GeminiUI] Microphone initiation failure:", err);
        setGeminiError("Unable to access your microphone. Please check system preferences, site permissions, or browser blocklists.");
      }
    }

    initMicrophone();

    // Setup an interval to decay the voice energy level to make it smooth
    visualIntervalRef.current = setInterval(() => {
      setAudioLevel((prev) => Math.max(0, Math.floor(prev * 0.85)));
    }, 60);

    return () => {
      active = false;
      
      socket.off("gemini:connected");
      socket.off("gemini:audio");
      socket.off("gemini:interrupted");
      socket.off("gemini:error");
      socket.off("gemini:closed");

      socket.emit("gemini:stop");

      if (visualIntervalRef.current) clearInterval(visualIntervalRef.current);

      if (geminiMicStreamRef.current) {
        geminiMicStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (geminiProcessorRef.current) {
        geminiProcessorRef.current.disconnect();
      }
      if (geminiInputAudioCtxRef.current) {
        geminiInputAudioCtxRef.current.close().catch(() => {});
      }
      
      geminiActiveSourcesRef.current.forEach((src) => {
        try { src.stop(); } catch (_) {}
      });
      geminiActiveSourcesRef.current = [];

      if (geminiOutputAudioCtxRef.current) {
        geminiOutputAudioCtxRef.current.close().catch(() => {});
        geminiOutputAudioCtxRef.current = null;
      }
    };
  }, [isGemini, activeVoice]);

  // WebRTC Connection Setup and Stream Hook
  useEffect(() => {
    if (isGemini) return;
    let active = true;

    async function initMediaAndWebRTC() {
      // 1. Capture local media devices (gracefully catch if blocked or unavailable)
      try {
        const constraints = {
          audio: true,
          video: type === "video",
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;

        if (localVideoRef.current && active) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err: any) {
        console.warn("Unable to capture physical camera/mic stream:", err);
        setStreamError("Physical camera/microphone is unavailable or blocked by iframe permissions. Activating Secure Sandbox stream simulation...");
      }

      // If connected, build PeerConnection
      if (status === "connected" && socket) {
        try {
          const configuration = {
            iceServers: [{ urls: "stun:stun1.l.google.com:19302" }],
          };
          const pc = new RTCPeerConnection(configuration);
          peerConnectionRef.current = pc;

          // Add local tracks to WebRTC connection
          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => {
              pc.addTrack(track, localStreamRef.current!);
            });
          }

          // Handle incoming tracks from remote peer
          pc.ontrack = (event) => {
            if (remoteVideoRef.current && event.streams[0] && active) {
              remoteVideoRef.current.srcObject = event.streams[0];
            }
          };

          // Handle ICE candidates and emit to peer through server relay
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              socket.emit("call:signal", {
                targetId: targetUser.id,
                signal: { candidate: event.candidate },
              });
            }
          };

          // Dual-Role Signaling Code:
          if (role === "caller") {
            // Caller creates SDP Offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit("call:dial", {
              receiverId: targetUser.id,
              type,
              offerSignal: offer,
            });
          } else if (role === "receiver" && incomingSignal) {
            // Receiver handles SDP Offer and creates SDP Answer
            await pc.setRemoteDescription(new RTCSessionDescription(incomingSignal));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("call:response", {
              callId: `call_${Date.now()}`,
              callerId: targetUser.id,
              status: "connected",
              answerSignal: answer,
            });
          }

          // Listen for incoming peer candidates or answers on socket
          const handleWebIceSignal = (payload: { senderId: string; signal: any }) => {
            if (payload.senderId !== targetUser.id) return;
            const pc = peerConnectionRef.current;
            if (!pc) return;

            if (payload.signal.candidate) {
              pc.addIceCandidate(new RTCIceCandidate(payload.signal.candidate)).catch((err) =>
                console.error("Error adding WebRTC candidate", err)
              );
            } else if (payload.signal.sdp && role === "caller") {
              pc.setRemoteDescription(new RTCSessionDescription(payload.signal)).catch((err) =>
                console.error("Error setting remote SDP description", err)
              );
            }
          };

          socket.on("call:signal", handleWebIceSignal);

          return () => {
            socket.off("call:signal", handleWebIceSignal);
          };
        } catch (webrtcErr) {
          console.error("WebRTC Negotiation Failed:", webrtcErr);
        }
      }
    }

    if (status === "connected" || status === "dialing" || (status === "ringing" && role === "receiver")) {
      initMediaAndWebRTC();
    }

    return () => {
      active = false;
      cleanupCallStreams();
    };
  }, [status, role, type, targetUser.id]);

  function cleanupCallStreams() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  }

  // Toggle audio track state
  const handleToggleMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
    }
    setMicMuted(!micMuted);
  };

  // Toggle video track state
  const handleToggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
    }
    setCameraOff(!cameraOff);
  };

  const handleAcceptCall = () => {
    setStatus("connected");
    onAccept(incomingSignal);
  };

  const handleRejectCall = () => {
    cleanupCallStreams();
    onReject();
  };

  const handleHangupCall = () => {
    cleanupCallStreams();
    onHangup(callDuration);
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Render Custom Gemini Live Voice Companion Overlay
  if (isGemini) {
    return (
      <div className="fixed inset-0 bg-[#0a0c0f]/95 backdrop-blur-xl z-50 flex flex-col items-center justify-center text-white p-6 md:p-12 overflow-y-auto">
        <div className="max-w-md w-full flex flex-col items-center text-center">
          
          {/* Tag status with pulsing lights */}
          <div className="mb-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-400 text-xs font-bold uppercase tracking-widest border border-blue-500/20">
              <Sparkles className="w-3.5 h-3.5 animate-spin duration-3000" />
              Gemini Live Voice Companion
            </span>
          </div>

          {/* Majestic Pulsing Sound Orb Visualizer */}
          <div className="relative my-8 flex items-center justify-center w-64 h-64">
            {/* Morphing glow backdrop */}
            <div 
              className="absolute inset-0 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 opacity-20 blur-2xl transition-all duration-300"
              style={{
                transform: `scale(${1 + audioLevel / 180})`,
              }}
            />
            {/* Concentric ripples */}
            <div 
              className="absolute inset-4 rounded-full border-2 border-blue-400/20 transition-all duration-150"
              style={{
                transform: `scale(${1 + audioLevel / 220})`,
              }}
            />
            <div 
              className="absolute inset-8 rounded-full border-2 border-indigo-400/15 transition-all duration-150"
              style={{
                transform: `scale(${1 + audioLevel / 140})`,
              }}
            />

            {/* Glowing Orb */}
            <div 
              className="w-40 h-40 rounded-full flex items-center justify-center transition-all bg-gradient-to-b from-[#181d24] to-[#0c0e12] border-4 border-slate-700/50 shadow-[0_0_50px_rgba(59,130,246,0.3)] z-10"
              style={{
                transform: `scale(${1 + audioLevel / 350})`,
                borderColor: geminiStatus === "speaking" ? "#3b82f6" : geminiStatus === "listening" ? "#10b981" : "#475569",
              }}
            >
              <img
                src={targetUser.picture}
                alt={targetUser.name}
                className={`w-32 h-32 rounded-full border-2 border-white/5 ${geminiStatus === "speaking" ? "animate-pulse" : ""}`}
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Reacting status dot bar */}
            {geminiStatus === "speaking" && (
              <span className="absolute bottom-2 flex h-3 w-3 z-20">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
              </span>
            )}
            {geminiStatus === "listening" && (
              <span className="absolute bottom-2 flex h-3 w-3 z-20">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            )}
          </div>

          <h3 className="text-3xl font-black tracking-tight">{targetUser.name}</h3>
          <p className="text-slate-400 text-sm mt-1 mb-6 font-mono">{targetUser.email}</p>

          {/* Action indicator message */}
          <div className="mb-8 px-6 py-2.5 rounded-2xl bg-[#111317] border border-white/5 inline-flex items-center gap-2 text-sm text-blue-400 font-mono font-bold">
            {geminiStatus === "connecting" && (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                <span>Handshaking with Gemini Live...</span>
              </>
            )}
            {geminiStatus === "listening" && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Listening... Speak anytime</span>
              </>
            )}
            {geminiStatus === "speaking" && (
              <>
                <Volume2 className="w-4 h-4 text-blue-400 animate-bounce" />
                <span>Gemini Speaking...</span>
              </>
            )}
            {geminiStatus === "ready" && (
              <>
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span>Ready</span>
              </>
            )}
          </div>

          {/* Voice select sliders */}
          <div className="w-full bg-[#111317] rounded-3xl p-5 border border-white/5 mb-8 text-left">
            <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              Select Voice Tone
            </h5>
            <div className="flex flex-wrap gap-2">
              {["Zephyr", "Puck", "Charon", "Kore", "Fenrir"].map((voice) => (
                <button
                  key={voice}
                  type="button"
                  onClick={() => {
                    setActiveVoice(voice);
                    setGeminiStatus("connecting");
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    activeVoice === voice
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25 scale-105 border border-blue-400"
                      : "bg-[#181b21] text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent"
                  }`}
                >
                  {voice}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-2.5 leading-normal">
              Changing the tone will instantly restart your Gemini voice Companion with a different prebuilt voice matrix.
            </p>
          </div>

          {/* Control Triggers */}
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => {
                setMicMuted(!micMuted);
                if (geminiMicStreamRef.current) {
                  geminiMicStreamRef.current.getAudioTracks().forEach((track) => {
                    track.enabled = micMuted;
                  });
                }
              }}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer border ${
                micMuted 
                  ? "bg-red-500 text-white border-red-400 shadow-lg shadow-red-500/20" 
                  : "bg-[#111317] hover:bg-slate-800 text-slate-300 border-white/5"
              }`}
              title={micMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {micMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>

            <button
              type="button"
              onClick={handleHangupCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl hover:scale-105 active:scale-95 transition-all cursor-pointer border border-red-400"
              title="End Voice Call"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </div>

          {/* Exception error message */}
          {geminiError && (
            <div className="mt-8 text-[11px] text-red-400 leading-normal max-w-xs text-center border border-red-500/20 p-3 rounded-2xl bg-red-500/10 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{geminiError}</span>
            </div>
          )}

          {/* Standard iframe permission warning fallbacks */}
          {streamError && !geminiError && (
            <p className="mt-8 text-[10px] text-slate-500 leading-normal max-w-xs text-center">
              {streamError}
            </p>
          )}

        </div>
      </div>
    );
  }

  // Render RINGING view (For Receiver)
  if (status === "ringing" && role === "receiver") {
    return (
      <div className="fixed inset-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-white animate-in fade-in duration-300">
        <div className="flex flex-col items-center max-w-sm text-center">
          {/* Avatar Ring Animation */}
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-blue-600 rounded-full animate-ping opacity-30" />
            <div className="absolute inset-[-12px] bg-blue-500/20 rounded-full animate-pulse opacity-20" />
            <img
              src={targetUser.picture}
              alt={targetUser.name}
              className="w-28 h-28 rounded-full border-4 border-blue-600 relative z-10"
              referrerPolicy="no-referrer"
            />
          </div>

          <h3 className="text-2xl font-black">{targetUser.name}</h3>
          <span className="text-blue-400 font-mono text-xs uppercase tracking-widest mt-1 mb-8 block">
            Incoming {type === "video" ? "Video" : "Voice"} Call
          </span>

          <p className="text-slate-400 text-sm mb-12 leading-relaxed">
            Invite you for a {type} connection using your Gmail profile identity.
          </p>

          {/* Action Call Toggles */}
          <div className="flex gap-8">
            <button
              id="accept-call-btn"
              type="button"
              onClick={handleAcceptCall}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 hover:scale-110 active:scale-95 transition-all cursor-pointer"
            >
              {type === "video" ? <Video className="w-7 h-7" /> : <Phone className="w-7 h-7" />}
            </button>
            <button
              id="reject-call-btn"
              type="button"
              onClick={handleRejectCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-lg shadow-red-500/20 hover:scale-110 active:scale-95 transition-all cursor-pointer"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render DIALING view (For Caller)
  if (status === "dialing" && role === "caller") {
    return (
      <div className="fixed inset-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-white animate-in fade-in duration-300">
        <div className="flex flex-col items-center max-w-sm text-center">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-25" />
            <img
              src={targetUser.picture}
              alt={targetUser.name}
              className="w-28 h-28 rounded-full border-4 border-slate-800 relative z-10"
              referrerPolicy="no-referrer"
            />
          </div>

          <h3 className="text-2xl font-black">{targetUser.name}</h3>
          <span className="text-blue-400 font-mono text-xs uppercase tracking-wider mt-1 mb-8 block animate-pulse">
            Calling out Gmail recipient...
          </span>

          <p className="text-slate-400 text-xs mb-12">
            Waiting for {targetUser.email} to pick up. Please ensure they are online to receive alerts.
          </p>

          <button
            id="cancel-dial-btn"
            type="button"
            onClick={handleRejectCall}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-lg hover:scale-110 active:scale-95 transition-all cursor-pointer"
          >
            <PhoneOff className="w-7 h-7" />
          </button>
        </div>
      </div>
    );
  }

  // Render CONNECTED ACTIVE view (Support both Voice and Video)
  return (
    <div className="fixed inset-0 z-50 bg-[#0A0A0A] flex flex-col items-center justify-center text-white overflow-hidden animate-in fade-in duration-500">
      
      {/* 1. Video Calling view Layout */}
      {type === "video" ? (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Main remote video screen stream */}
          <div className="absolute inset-0 bg-[#0E0E0E] flex items-center justify-center overflow-hidden">
            {streamError ? (
              <div className="flex flex-col items-center p-6 text-center max-w-sm">
                <div className="w-20 h-20 rounded-full border border-blue-500 bg-blue-500/10 flex items-center justify-center mb-4 text-blue-400">
                  <ShieldAlert className="w-10 h-10" />
                </div>
                <h4 className="font-bold text-slate-200">Video Simulation Ready</h4>
                <p className="text-slate-500 text-xs mt-2 leading-relaxed">
                  Both devices are connected! Playing animated cartoon canvas sync since physical stream is sandboxed.
                </p>
                <div className="mt-6 flex flex-col gap-1 items-center bg-slate-900/80 p-3 rounded-xl border border-white/5">
                  <img src={targetUser.picture} alt="" className="w-12 h-12 rounded-full animate-spin duration-3000" />
                  <span className="text-xs text-blue-400 mt-2 font-black">{targetUser.name} talking...</span>
                </div>
              </div>
            ) : (
              <video
                id="remote-video-stream"
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            )}
          </div>

          {/* Picture-In-Picture Local Video Grid (top-right overlay) */}
          <div className="absolute top-4 right-4 w-32 h-44 sm:w-40 sm:h-56 bg-slate-900 rounded-2xl overflow-hidden border-2 border-white/5 shadow-2xl z-20 hover:scale-105 transition-transform">
            {cameraOff ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-xs bg-black">
                <VideoOff className="w-6 h-6 mb-1" />
                <span>Camera off</span>
              </div>
            ) : streamError ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-black p-2 text-center">
                <img src={currentUser.picture} className="w-10 h-10 rounded-full border border-white/5" alt="" />
                <span className="text-[10px] text-slate-400 mt-1.5 truncate w-full">{currentUser.name} (You)</span>
              </div>
            ) : (
              <video
                id="local-video-stream"
                ref={localVideoRef}
                muted
                autoPlay
                playsInline
                className="w-full h-full object-cover scale-x-[-1]"
              />
            )}
          </div>

          {/* Floating UI Toolbar Overlays */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 bg-black/80 backdrop-blur-lg px-6 py-4 rounded-3xl border border-white/5 shadow-2xl flex items-center gap-6">
            
            {/* Mic Toggle Button */}
            <button
              id="call-toggle-mic"
              type="button"
              onClick={handleToggleMic}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                micMuted ? "bg-red-500 text-white" : "bg-[#242424] hover:bg-white/5 text-slate-300"
              }`}
            >
              {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {/* Camera Toggle Button */}
            <button
              id="call-toggle-camera"
              type="button"
              onClick={handleToggleCamera}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                cameraOff ? "bg-red-500 text-white" : "bg-[#242424] hover:bg-white/5 text-slate-300"
              }`}
            >
              {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>

            {/* Timer Display Widget */}
            <div className="px-4 py-2 rounded-xl bg-black text-blue-400 border border-white/5 text-xs font-mono font-bold flex items-center gap-1.5 shrink-0">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatDuration(callDuration)}</span>
            </div>

            {/* Hang Up Button */}
            <button
              id="call-hangup-btn"
              type="button"
              onClick={handleHangupCall}
              className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        /* 2. Voice Calling view Layout */
        <div className="flex flex-col items-center max-w-sm text-center px-4">
          
          <div className="text-center mb-8">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-semibold uppercase tracking-wider border border-blue-500/20 mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              Secure Gmail VoIP Call
            </span>
          </div>

          <div className="relative mb-8">
            {/* Waves Pulsing loops */}
            <div className="absolute inset-0 bg-blue-600 rounded-full animate-ping opacity-15" />
            <div className="absolute inset-3 bg-blue-500 rounded-full animate-pulse opacity-10" />
            <img
              src={targetUser.picture}
              alt={targetUser.name}
              className="w-32 h-32 rounded-full border-4 border-[#161616] relative z-10 mx-auto"
              referrerPolicy="no-referrer"
            />
          </div>

          <h3 className="text-2xl font-black">{targetUser.name}</h3>
          <p className="text-slate-400 text-sm mt-1 mb-8 font-mono">{targetUser.email}</p>

          {/* Call timer clock */}
          <div className="mb-12 px-6 py-2.5 rounded-2xl bg-[#161616] border border-white/5 inline-flex items-center gap-2 text-sm text-blue-400 font-mono font-black">
            <Volume2 className="w-4 h-4 animate-bounce" />
            <span>{formatDuration(callDuration)}</span>
          </div>

          {/* Bottom Audio Controller Toggles */}
          <div className="flex items-center gap-6">
            <button
              id="voice-toggle-mic"
              type="button"
              onClick={handleToggleMic}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                micMuted ? "bg-red-500 text-white" : "bg-[#161616] hover:bg-white/5 text-slate-300 border border-white/5"
              }`}
            >
              {micMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>

            <button
              id="voice-hangup-btn"
              type="button"
              onClick={handleHangupCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </div>

          {/* Graceful Stream warning display if we don't have mic */}
          {streamError && (
            <p className="mt-8 text-[11px] text-orange-500 dark:text-orange-400 leading-normal max-w-xs text-center border border-orange-500/10 p-2.5 rounded-xl bg-orange-500/5">
              {streamError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
