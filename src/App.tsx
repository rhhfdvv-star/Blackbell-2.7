import { useState, useRef, useEffect } from 'react';
import { Menu, LogOut, Terminal, Mic, MicOff, AlertCircle, X, Shield, Plus, MessageSquare, Sun, Moon, Send } from 'lucide-react';
import AuthScreen from './AuthScreen';

type Message = { 
  role: 'user'|'ai'; 
  content: string; 
  isImage?: boolean; 
  winner?: string; 
  latency?: string;
  isAttachment?: boolean; 
  imageBytes?: string; 
  mimeType?: string; 
  fileName?: string;
};

// Relative last seen formatter
function getRelativeTime(timestamp: number) {
  if (!timestamp) return "Never";
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 35000) return "Active now"; // treated as online
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.floor(sec / 60);
  if (min === 1) return `1 minute ago`;
  if (min < 60) return `${min} minutes ago`;
  const hrs = Math.floor(min / 60);
  if (hrs === 1) return `1 hour ago`;
  if (hrs < 24) return `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return `1 day ago`;
  return `${days} days ago`;
}

// Extract questions block from the raw AI response
function parseAiResponse(content: string) {
  if (!content) return { mainText: '', questions: [] as string[] };
  const marker = '[QUESTIONS]';
  const idx = content.indexOf(marker);
  if (idx === -1) {
    return { mainText: content, questions: [] as string[] };
  }
  const mainText = content.substring(0, idx).trim();
  const qText = content.substring(idx + marker.length).trim();
  const questions = qText
    .split('\n')
    .map(line => line.trim())
    .map(line => line.replace(/^[-\*\d\.\)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
  return { mainText, questions };
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('blackbell_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.sessionToken) {
          return parsed;
        }
      } catch (e) {}
    }
    return null;
  });
  
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('blackbell_theme') as 'dark' | 'light') || 'dark';
  });

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm?: () => void;
    isConfirm: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    isConfirm: false
  });

  const showAlert = (title: string, message: string) => {
    setModalConfig({
      isOpen: true,
      title,
      message,
      isConfirm: false
    });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModalConfig({
      isOpen: true,
      title,
      message,
      onConfirm,
      isConfirm: true
    });
  };

  useEffect(() => {
    localStorage.setItem('blackbell_theme', theme);
  }, [theme]);

  const [isBanned, setIsBanned] = useState(false);
  const [viewMode, setViewMode] = useState<'app' | 'admin'>('app');
  
  // Existing Voice state
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // New Text AI State
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // New Voice, Memory, and Speech States
  const [voiceTranscription, setVoiceTranscription] = useState('');
  const [memories, setMemories] = useState<string[]>([]);
  const [playingMessageId, setPlayingMessageId] = useState<number | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);

  const fetchMemories = async () => {
    if (!currentUser?.email) return;
    try {
      const res = await fetch(`/api/users/memories?email=${encodeURIComponent(currentUser.email)}`, {
        headers: { 'x-session-token': currentUser.sessionToken || '' }
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch (e) {
      console.error("Error fetching memories:", e);
    }
  };

  useEffect(() => {
    if (currentUser?.email) {
      fetchMemories();
    }
  }, [currentUser?.email]);
  
  // Admin Data State
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminStats, setAdminStats] = useState<any>({ totalUsers: 0, onlineUsers: 0, bannedUsers: 0, traffic: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdminLoading, setIsAdminLoading] = useState(false);

  interface Session {
    id: string;
    title: string;
    messages: Message[];
    isPinned?: boolean;
    createdAt?: number;
    updatedAt?: number;
  }

  // Pinned context menus states
  const [activeContextMenu, setActiveContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Enforces the 15 session limit (deletes oldest unpinned sessions first)
  const enforceSessionLimits = (list: Session[]): Session[] => {
    if (list.length <= 15) return list;
    
    const pinned = list.filter(s => s.isPinned);
    const unpinned = list.filter(s => !s.isPinned);
    
    const maxAllowedUnpinned = 15 - pinned.length;
    if (unpinned.length > maxAllowedUnpinned) {
      // Sort unpinned by age/updatedAt descending (newest first), and slice to keep only newest
      const sortedUnpinned = [...unpinned].sort((a, b) => {
        const timeA = a.updatedAt || parseInt(a.id) || 0;
        const timeB = b.updatedAt || parseInt(b.id) || 0;
        return timeB - timeA;
      });
      const keptUnpinned = sortedUnpinned.slice(0, Math.max(0, maxAllowedUnpinned));
      
      return sortSessions([...pinned, ...keptUnpinned]);
    }
    return list;
  };

  const sortSessions = (list: Session[]): Session[] => {
    return [...list].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const timeA = a.updatedAt || parseInt(a.id) || 0;
      const timeB = b.updatedAt || parseInt(b.id) || 0;
      return timeB - timeA;
    });
  };

  const lastSavedUserEmailRef = useRef<string | null>(() => {
    const savedUser = localStorage.getItem('blackbell_user');
    return savedUser ? JSON.parse(savedUser)?.email || null : null;
  });

  const [sessions, setSessions] = useState<Session[]>(() => {
    const savedUser = localStorage.getItem('blackbell_user');
    const email = savedUser ? JSON.parse(savedUser)?.email : '';
    if (email) {
      const saved = localStorage.getItem(`blackbell_sessions_${email}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return sortSessions(parsed);
        } catch (e) {
          console.error(e);
        }
      }
    } else {
      const saved = localStorage.getItem('blackbell_sessions');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return sortSessions(parsed);
        } catch (e) {
          console.error(e);
        }
      }
    }
    // Check if initialized user is admin for welcome message
    const isAdminForWelcome = email === 'sy5455977@gmail.com';
    const welcomeText = isAdminForWelcome 
      ? "Hello Admin. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt."
      : "Hello. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt.";

    const defaultSession: Session = {
      id: 'default',
      title: 'Welcome Session',
      messages: [
        { 
          role: 'ai', 
          content: welcomeText
        }
      ],
      isPinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return [defaultSession];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const savedUser = localStorage.getItem('blackbell_user');
    const email = savedUser ? JSON.parse(savedUser)?.email : '';
    if (email) {
      const saved = localStorage.getItem(`blackbell_active_session_id_${email}`);
      if (saved) return saved;
    } else {
      const saved = localStorage.getItem('blackbell_active_session_id');
      if (saved) return saved;
    }
    return 'default';
  });

  // Synchronize/Load sessions when currentUser changes
  useEffect(() => {
    const email = currentUser?.email;
    if (!email) {
      lastSavedUserEmailRef.current = null;
      return;
    }

    if (lastSavedUserEmailRef.current !== email) {
      const sessionKey = `blackbell_sessions_${email}`;
      const activeKey = `blackbell_active_session_id_${email}`;

      const saved = localStorage.getItem(sessionKey);
      let loadedSessions: Session[] = [];
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            loadedSessions = sortSessions(parsed);
          }
        } catch (e) {
          console.error(e);
        }
      }

      if (loadedSessions.length === 0) {
        const isAdminForWelcome = email === 'sy5455977@gmail.com';
        const welcomeText = isAdminForWelcome 
          ? "Hello Admin. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt."
          : "Hello. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt.";

        const defaultSession: Session = {
          id: 'default',
          title: 'Welcome Session',
          messages: [{ role: 'ai', content: welcomeText }],
          isPinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        loadedSessions = [defaultSession];
      }

      setSessions(loadedSessions);

      const savedActiveId = localStorage.getItem(activeKey);
      if (savedActiveId && loadedSessions.some(s => s.id === savedActiveId)) {
        setActiveSessionId(savedActiveId);
      } else {
        setActiveSessionId(loadedSessions[0]?.id || 'default');
      }

      // Sync completed
      lastSavedUserEmailRef.current = email;
    }
  }, [currentUser?.email]);

  // Persists sessions on change, only if state matches the logged-in user email
  useEffect(() => {
    const email = currentUser?.email;
    if (email && lastSavedUserEmailRef.current === email) {
      localStorage.setItem(`blackbell_sessions_${email}`, JSON.stringify(sessions));
    }
  }, [sessions, currentUser?.email]);

  useEffect(() => {
    const email = currentUser?.email;
    if (email && lastSavedUserEmailRef.current === email) {
      localStorage.setItem(`blackbell_active_session_id_${email}`, activeSessionId);
    }
  }, [activeSessionId, currentUser?.email]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const messages = activeSession ? activeSession.messages : [];

  const updateActiveSessionMessages = (newMessages: Message[]) => {
    setSessions(prev => {
      const updated = prev.map(s => {
        if (s.id === (activeSession?.id || activeSessionId)) {
          let newTitle = s.title;
          if (s.title === 'Welcome Session' || s.title === 'New Session') {
            const firstUserMsg = newMessages.find(m => m.role === 'user');
            if (firstUserMsg) {
              newTitle = firstUserMsg.content.length > 25 
                ? firstUserMsg.content.substring(0, 25) + '...'
                : firstUserMsg.content;
            }
          }
          return {
            ...s,
            title: newTitle,
            messages: newMessages,
            updatedAt: Date.now()
          };
        }
        return s;
      });
      return sortSessions(updated);
    });
  };

  const handleNewSession = () => {
    const newSessionId = Date.now().toString();
    const isAdminNow = currentUser?.email === 'sy5455977@gmail.com';
    const welcomeContent = isAdminNow
      ? "Hello Admin. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt."
      : "Hello. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt.";

    const newSession: Session = {
      id: newSessionId,
      title: 'New Session',
      messages: [
        {
          role: 'ai',
          content: welcomeContent
        }
      ],
      isPinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    setSessions(prev => {
      const list = [newSession, ...prev];
      return sortSessions(enforceSessionLimits(list));
    });
    setActiveSessionId(newSessionId);
    setIsSidebarOpen(false);
  };

  const handlePurgeSessions = () => {
    showConfirm(
      'Purge All Sessions', 
      'Are you sure you want to purge all sessions? This will reset your entire session history permanently.',
      () => {
        const isAdminNow = currentUser?.email === 'sy5455977@gmail.com';
        const welcomeContent = isAdminNow
          ? "Hello Admin. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt."
          : "Hello. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt.";

        const defaultSession: Session = {
          id: 'default',
          title: 'Welcome Session',
          messages: [
            { 
              role: 'ai', 
              content: welcomeContent 
            }
          ],
          isPinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        setSessions([defaultSession]);
        setActiveSessionId('default');
      }
    );
  };

  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const playMessageTTS = async (text: string, index: number) => {
    try {
      if (playingMessageId === index) {
        if ('speechSynthesis' in window) {
          try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        activeSourcesRef.current.forEach(source => {
          try { source.stop(); } catch(e){}
        });
        activeSourcesRef.current = [];
        setPlayingMessageId(null);
        return;
      }

      setPlayingMessageId(index);

      if ('speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }

      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      }
      const outputCtx = outputAudioCtxRef.current;
      if (outputCtx.state === 'suspended') {
        await outputCtx.resume();
      }

      activeSourcesRef.current.forEach(source => {
        try { source.stop(); } catch(e){}
      });
      activeSourcesRef.current = [];
      nextStartTimeRef.current = outputCtx.currentTime;

      let success = false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 8000);

      try {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: 'Zephyr' }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          if (data.audio) {
            playAudioChunk(data.audio, () => {
              setPlayingMessageId(null);
            });
            success = true;
          }
        }
      } catch (err) {
        console.warn("Backend TTS connection failed or timed out. Falling back to browser Speech Synthesis:", err);
      }

      if (!success) {
        if ('speechSynthesis' in window) {
          // Speak clean content up to the questions section to avoid talking out loud the visual menu options
          const cleanText = text.split('[QUESTIONS]')[0].replace(/\*+/g, '').replace(/_+/g, '').trim();
          const utterance = new SpeechSynthesisUtterance(cleanText);
          
          // Let's pick a beautiful expressive feminine / pleasant voice
          const voices = window.speechSynthesis.getVoices();
          const femaleVoice = voices.find(v => 
            v.lang.startsWith('hi') || // Hindi
            (v.name.toLowerCase().includes('google') && v.lang.startsWith('en') && v.name.toLowerCase().includes('female')) ||
            v.name.toLowerCase().includes('female') || 
            v.name.toLowerCase().includes('zira') || 
            v.name.toLowerCase().includes('samantha')
          ) || voices[0];
          
          if (femaleVoice) {
            utterance.voice = femaleVoice;
          }
          utterance.rate = 1.05;
          utterance.pitch = 1.1; 
          utterance.onend = () => {
            setPlayingMessageId(null);
          };
          utterance.onerror = () => {
            setPlayingMessageId(null);
          };
          window.speechSynthesis.speak(utterance);
        } else {
          setPlayingMessageId(null);
        }
      }
    } catch (e) {
      console.error("TTS playback error:", e);
      setPlayingMessageId(null);
    }
  };

  // Pollinations Text API logic
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<{ base64: string; mimeType: string; name: string } | null>(null);

  const handleFileChange = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    
    const isTextFile = file.type.startsWith('text/') || 
                       file.type === 'application/json' || 
                       file.name.endsWith('.ts') || 
                       file.name.endsWith('.tsx') || 
                       file.name.endsWith('.js') || 
                       file.name.endsWith('.jsx');

    if (isTextFile) {
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const base64Content = window.btoa(unescape(encodeURIComponent(text)));
        setAttachedFile({
          base64: base64Content,
          mimeType: 'text/plain',
          name: file.name
        });
      };
      reader.readAsText(file);
    } else {
      if (file.type.startsWith('image/')) {
        const img = new Image();
        reader.onload = (event) => {
          img.src = event.target?.result as string;
        };
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            const commaIdx = dataUrl.indexOf(',');
            const rawBase64 = commaIdx !== -1 ? dataUrl.substring(commaIdx + 1) : dataUrl;
            setAttachedFile({
              base64: rawBase64,
              mimeType: 'image/jpeg',
              name: file.name
            });
          }
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = (event) => {
          const result = event.target?.result as string;
          if (result) {
            const commaIdx = result.indexOf(',');
            const rawBase64 = commaIdx !== -1 ? result.substring(commaIdx + 1) : result;
            setAttachedFile({
              base64: rawBase64,
              mimeType: file.type || 'image/octet-stream',
              name: file.name
            });
          }
        };
        reader.readAsDataURL(file);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSendMessage = async (textOverride?: any) => {
    // Proactively unlock browser audio autoplay inside direct user event context
    try {
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      }
      if (outputAudioCtxRef.current.state === 'suspended') {
        outputAudioCtxRef.current.resume();
      }
    } catch (e) {
      console.warn("Failed audio pre-init:", e);
    }

    const hasTextOverride = typeof textOverride === 'string';
    const textTarget = hasTextOverride ? textOverride : inputText;
    if (typeof textTarget !== 'string' || (!textTarget.trim() && !attachedFile) || isTyping) return;
    const currentText = textTarget.trim();
    const currentAttachment = hasTextOverride ? null : attachedFile;
    if (!hasTextOverride) {
      setAttachedFile(null);
    }

    let userMsgContent = currentText;
    if (!userMsgContent && currentAttachment) {
      userMsgContent = `Analyze this uploaded file: ${currentAttachment.name}`;
    }

    const newUserMsg: Message = { 
      role: 'user', 
      content: userMsgContent,
      ...(currentAttachment ? {
        imageBytes: currentAttachment.base64,
        mimeType: currentAttachment.mimeType,
        fileName: currentAttachment.name,
        isAttachment: true
      } : {})
    };

    const newMessages: Message[] = [...messages, newUserMsg];
    updateActiveSessionMessages(newMessages);
    if (!hasTextOverride) {
      setInputText('');
    }
    
    if (userMsgContent.toLowerCase().startsWith('/image ')) {
      setIsTyping(true);
      const prompt = userMsgContent.substring(7).trim();
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
      updateActiveSessionMessages([...newMessages, { role: 'ai', content: imageUrl, isImage: true }]);
      setIsTyping(false);
      return;
    }
    
    setIsTyping(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-session-token': currentUser?.sessionToken || ''
        },
        body: JSON.stringify({
          email: currentUser?.email,
          messages: newMessages.map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
            ...(m.isAttachment ? {
              attachment: {
                base64: m.imageBytes,
                mimeType: m.mimeType,
                name: m.fileName
              }
            } : {})
          }))
        })
      });
      if (res.status === 401) {
        handleLogout();
        throw new Error("Session expired. Please login again.");
      }
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const winner = res.headers.get('x-model-winner') || '';
      const latency = res.headers.get('x-model-latency') || '';
      const aiText = await res.text();
      const finalMsg: Message = { role: 'ai', content: aiText, winner, latency };
      updateActiveSessionMessages([...newMessages, finalMsg]);

      if (autoSpeak) {
        const parsed = parseAiResponse(aiText);
        playMessageTTS(parsed.mainText, newMessages.length);
      }

      setTimeout(fetchMemories, 1500);
    } catch (e: any) {
      const errorMsg = e?.message || "Error connecting to AI Server.";
      updateActiveSessionMessages([...newMessages, { role: 'ai', content: `Error: ${errorMsg}. Please try again.` }]);
    } finally {
      setIsTyping(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Audio Refs
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // Existing Voice API Logic
  const connectToLiveAPI = async () => {
    try {
      setError(null);
      // Init Output context (GenAI response is 24kHz)
      const outputAudioCtx = new AudioContext({ sampleRate: 24000 });
      outputAudioCtxRef.current = outputAudioCtx;
      nextStartTimeRef.current = outputAudioCtx.currentTime;

      // Ensure AudioContext is resumed (browser policy)
      if (outputAudioCtx.state === 'suspended') {
        await outputAudioCtx.resume();
      }

      // Connect via WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const userMailStr = currentUser?.email ? encodeURIComponent(currentUser.email) : '';
      const userTokenStr = currentUser?.sessionToken ? encodeURIComponent(currentUser.sessionToken) : '';
      const wsUrl = `${protocol}//${window.location.host}/live?email=${userMailStr}&token=${userTokenStr}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        setIsConnected(true);
        setIsRecording(true);
        setVoiceTranscription('');
        try {
          // Init Input context (user mic is 16kHz) with echo cancellation and noise suppression
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          streamRef.current = stream;
          
          const inputAudioCtx = new AudioContext({ sampleRate: 16000 });
          inputAudioCtxRef.current = inputAudioCtx;
          
          const source = inputAudioCtx.createMediaStreamSource(stream);
          sourceRef.current = source;
          
          const processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;
          
          source.connect(processor);
          processor.connect(inputAudioCtx.destination);
          
          processor.onaudioprocess = (e) => {
            if (ws.readyState === WebSocket.OPEN) {
              const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
              ws.send(JSON.stringify({ audio: base64 }));
            }
          };
        } catch (err) {
          setError("Microphone access denied.");
          disconnect();
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.error) {
             setError(msg.error);
             disconnect();
          }
          if (msg.audio) {
            playAudioChunk(msg.audio);
          }
          if (msg.text) {
             setVoiceTranscription(prev => prev + " " + msg.text);
          }
          if (msg.interrupted) {
             setVoiceTranscription('');
             // Stop playback of all pending/active buffers instantly
             activeSourcesRef.current.forEach(source => {
                try {
                  source.stop();
                } catch (e) {
                  // Ignore if already stopped
                }
             });
             activeSourcesRef.current = [];
             nextStartTimeRef.current = outputAudioCtxRef.current?.currentTime || 0;
          }
        } catch (err) {
          console.error("Message error:", err);
        }
      };

      ws.onerror = () => {
        setError("WebSocket error occurred.");
        disconnect();
      };
      
      ws.onclose = () => {
        disconnect();
      };
    } catch(err) {
       console.error(err);
       setError("Connection failed.");
       disconnect();
    }
  };

  const pcmToBase64 = (float32Array: Float32Array): string => {
    // Convert Float32Array to 16-bit PCM
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    // Encode to base64
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  const playAudioChunk = (base64Audio: string, onEnded?: () => void) => {
    const outputCtx = outputAudioCtxRef.current;
    if (!outputCtx) {
      if (onEnded) onEnded();
      return;
    }

    // Decode base64 to ArrayBuffer
    const binaryString = window.atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    // Convert 16-bit PCM to Float32
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
    }

    const audioBuffer = outputCtx.createBuffer(1, float32.length, outputCtx.sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = outputCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputCtx.destination);

    const playTime = Math.max(outputCtx.currentTime, nextStartTimeRef.current);
    source.start(playTime);
    nextStartTimeRef.current = playTime + audioBuffer.duration;

    // Track active source to enable true, glitch-free interruption
    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      if (onEnded) {
        onEnded();
      }
    };
  };

  const disconnect = () => {
    setIsConnected(false);
    setIsRecording(false);
    
    // Stop and clear all active playing buffers
    if (activeSourcesRef.current) {
      activeSourcesRef.current.forEach(source => {
         try {
           source.stop();
         } catch(e) {}
      });
      activeSourcesRef.current = [];
    }

    if (wsRef.current) {
       wsRef.current.close();
       wsRef.current = null;
    }
    if (processorRef.current) {
       processorRef.current.disconnect();
       processorRef.current = null;
    }
    if (sourceRef.current) {
       sourceRef.current.disconnect();
       sourceRef.current = null;
    }
    if (streamRef.current) {
       streamRef.current.getTracks().forEach(track => track.stop());
       streamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
       try { inputAudioCtxRef.current.close(); } catch(e) {}
       inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
       try { outputAudioCtxRef.current.close(); } catch(e) {}
       outputAudioCtxRef.current = null;
    }
  };

  const toggleConnection = () => {
    if (isConnected) {
      disconnect();
    } else {
      connectToLiveAPI();
    }
  };

  const handleLogout = () => {
    disconnect();
    localStorage.removeItem('blackbell_user');
    setCurrentUser(null);
    setViewMode('app');
    setIsBanned(false);
    lastSavedUserEmailRef.current = null;
    
    const welcomeText = "Hello. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt.";
    const defaultSession: Session = {
      id: 'default',
      title: 'Welcome Session',
      messages: [
        { 
          role: 'ai', 
          content: welcomeText
        }
      ],
      isPinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    setSessions([defaultSession]);
    setActiveSessionId('default');
  };

  // Keep-alive tracking & user checking interval
  useEffect(() => {
    if (!currentUser) return;

    const performPing = async () => {
      try {
        const res = await fetch('/api/users/ping', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-session-token': currentUser?.sessionToken || ''
          },
          body: JSON.stringify({ email: currentUser.email })
        });
        if (res.status === 401) {
          handleLogout();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.isBanned) {
            setIsBanned(true);
            disconnect();
          }
        }
      } catch (err) {
        console.error("Error pinging keep-alive:", err);
      }
    };

    performPing();
    const interval = setInterval(performPing, 10000); // every 10 seconds
    return () => clearInterval(interval);
  }, [currentUser?.email]);

  // Fetch Admin Panel Data Controller
  const fetchAdminData = async () => {
    if (!currentUser || currentUser.email !== 'sy5455977@gmail.com') return;
    setIsAdminLoading(true);
    try {
      const [usersRes, statsRes] = await Promise.all([
        fetch(`/api/admin/users?adminEmail=${encodeURIComponent(currentUser.email)}`, {
          headers: { 'x-session-token': currentUser.sessionToken || '' }
        }),
        fetch(`/api/admin/stats?adminEmail=${encodeURIComponent(currentUser.email)}`, {
          headers: { 'x-session-token': currentUser.sessionToken || '' }
        })
      ]);

      if (usersRes.status === 401 || statsRes.status === 401) {
        handleLogout();
        return;
      }

      if (usersRes.ok && statsRes.ok) {
        setAdminUsers(await usersRes.json());
        setAdminStats(await statsRes.json());
      }
    } catch (err) {
      console.error("Error reading admin dashboard data:", err);
    } finally {
      setIsAdminLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'admin') {
      fetchAdminData();
      const interval = setInterval(fetchAdminData, 6000); // reload periodically
      return () => clearInterval(interval);
    }
  }, [viewMode]);

  // Handle banning & unbanning user
  const handleToggleBan = async (userId: string, isCurrentlyBanned: boolean) => {
    if (!currentUser || currentUser.email !== 'sy5455977@gmail.com') return;
    const actionText = isCurrentlyBanned ? 'unban' : 'ban';
    showConfirm(
      `${actionText === 'ban' ? 'Ban' : 'Unban'} User`,
      `Are you sure you want to ${actionText} this user account?`,
      async () => {
        try {
          const res = await fetch('/api/admin/users/ban', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-session-token': currentUser.sessionToken || ''
            },
            body: JSON.stringify({
              adminEmail: currentUser.email,
              userId,
              ban: !isCurrentlyBanned
            })
          });
          if (res.status === 401) {
            handleLogout();
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.success) {
              setAdminUsers(data.users);
              await fetchAdminData();
            }
          }
        } catch (err) {
          console.error("Error toggling user ban:", err);
        }
      }
    );
  };

  // Convert active duration seconds into readable hours / minutes
  const formatDuration = (secondsTotal: number) => {
    if (!secondsTotal || secondsTotal <= 0) return "0s";
    if (secondsTotal < 60) return `${secondsTotal}s`;
    const mins = Math.floor(secondsTotal / 60);
    const secs = secondsTotal % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  };

  // cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  // Terminate voice sessions and release microphone immediately when swapping mode to text
  useEffect(() => {
    if (mode === 'text') {
      disconnect();
    }
  }, [mode]);

  // Cancel any active Speech/TTS syntheses upon switching sessions to avoid voice spills
  useEffect(() => {
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    if (activeSourcesRef.current) {
      activeSourcesRef.current.forEach(source => {
        try { source.stop(); } catch (e) {}
      });
      activeSourcesRef.current = [];
    }
    setPlayingMessageId(null);
  }, [activeSessionId]);

  // Banned full screen gate
  if (isBanned) {
    return (
      <div className="flex flex-col min-h-screen bg-[#111422] text-white px-4 py-8 items-center justify-center font-sans">
        <div className="w-full max-w-sm flex flex-col items-center bg-[#1A1D29] border border-red-500/20 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-red-950/40 border border-red-500/30 flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(239,68,68,0.25)] animate-pulse">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-serif font-bold text-white mb-3">Account Banned</h2>
          <p className="text-gray-400 text-sm mb-8 leading-relaxed">
            Your account has been suspended or banned due to policy violations. Please contact the administrator.
          </p>
          <button 
            type="button"
            onClick={() => {
              localStorage.removeItem('blackbell_user');
              setCurrentUser(null);
              setIsBanned(false);
              lastSavedUserEmailRef.current = null;
              
              const welcomeText = "Hello. I'm Blackbell AGI.\n\nType your message below. To generate an image, use /Image followed by the prompt.";
              setSessions([{
                id: 'default',
                title: 'Welcome Session',
                messages: [{ role: 'ai', content: welcomeText }],
                isPinned: false,
                createdAt: Date.now(),
                updatedAt: Date.now()
              }]);
              setActiveSessionId('default');
            }}
            className="w-full bg-purple-900/40 hover:bg-purple-900/60 text-purple-200 border border-purple-500/20 font-semibold py-3 px-4 rounded-xl transition-colors cursor-pointer"
          >
            Go Back & Sign In / Register
          </button>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthScreen onLogin={(userData) => {
      setCurrentUser(userData);
      localStorage.setItem('blackbell_user', JSON.stringify(userData));
    }} />;
  }

  const renderVoiceUI = () => (
    <main className="flex-1 flex flex-col justify-between max-w-4xl mx-auto w-full relative px-4 md:px-0">
      <div className="flex items-start justify-between w-full pt-4 md:pt-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-600"></div>
            <h1 className="text-3xl font-bold tracking-[0.2em] uppercase">BLACKBELL</h1>
          </div>
          <h2 className="text-3xl font-bold tracking-[0.2em] ml-4 uppercase">LIVE</h2>
        </div>
      </div>

      {/* Center Mic Button */}
      <div className="flex flex-col items-center justify-center flex-1 my-12 w-full">
        {error && (
          <div className="mb-8 flex items-center gap-2 text-red-400 text-sm border border-red-900/50 bg-red-950/20 px-4 py-2 rounded-lg">
             <AlertCircle className="w-4 h-4" />
             {error}
          </div>
        )}
        
        <button 
          onClick={toggleConnection}
          className={`w-40 h-40 rounded-full flex items-center justify-center transition-all duration-300 ${
            isConnected 
              ? 'bg-purple-900/20 border-2 border-purple-500 shadow-[0_0_50px_rgba(168,85,247,0.2)]' 
              : `${theme === 'light' ? 'bg-white hover:bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-900 shadow-md' : 'bg-[#1A1A1A] hover:bg-[#222222] border-gray-800 shadow-xl'}`
          }`}
        >
          {isConnected ? (
            <div className="relative">
               <Mic className="w-12 h-12 text-purple-400" />
               <div className="absolute inset-0 bg-purple-400 rounded-full animate-ping opacity-20"></div>
            </div>
          ) : (
            <MicOff className="w-12 h-12 text-gray-500" />
          )}
        </button>
        
        <p className={`mt-6 font-medium tracking-wide ${theme === 'light' ? 'text-gray-550' : 'text-[#888888]'}`}>
          {isConnected ? 'Listening...' : 'Tap to Connect'}
        </p>

        {isConnected && (
          <div className="mt-6 max-w-md w-full text-center px-4 animate-fade-in">
            <span className="text-[9px] uppercase font-bold text-purple-400/80 tracking-widest block mb-2 select-none">LIVE SPEECH-TO-TEXT</span>
            <div className={`p-4 rounded-xl min-h-[64px] max-h-[110px] overflow-y-auto text-xs italic font-medium leading-relaxed shadow-inner [scrollbar-width:thin] ${theme === 'light' ? 'bg-white border-gray-200 text-gray-700' : 'bg-black/45 border border-white/5 text-gray-300'}`}>
              {voiceTranscription || "Listening to your speech or translating voice stream..."}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-center pb-6 w-full">
        <p className={`text-xs font-semibold tracking-widest uppercase ${theme === 'light' ? 'text-gray-400' : 'text-[#333333]'}`}>
          SECURED BY GEMINI GENERATIVE AI
        </p>
      </div>
    </main>
  );

  const renderTextUI = () => (
    <div className="flex-1 flex flex-col h-full max-w-4xl mx-auto w-full px-4 md:px-8 overflow-hidden relative">
      <div className="flex-1 overflow-y-auto pb-4 pt-4 flex flex-col gap-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {messages.map((m, i) => {
          // Dynamic welcome cleaner for non-admin users
          const isAdmin = currentUser?.email === 'sy5455977@gmail.com';
          let displayContent = m.content;
          if (!isAdmin && displayContent && displayContent.includes("Hello Admin")) {
            displayContent = displayContent.replace("Hello Admin", "Hello");
          }

          let parsed = { mainText: displayContent, questions: [] as string[] };
          if (m.role === 'ai' && !m.isImage) {
            parsed = parseAiResponse(displayContent);
            displayContent = parsed.mainText;
          }

          return (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-widest flex items-center gap-2 select-none">
                {m.role === 'user' ? 'USER' : 'BLACKBELL'}
              </span>
              <div className="flex items-end gap-2.5 max-w-[85%]">
                <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user' 
                    ? 'bg-[#5b3eff] text-white rounded-tr-sm font-medium' 
                    : `${theme === 'light' ? 'bg-white text-gray-800 border-gray-200' : 'bg-[#1c1c1c] text-gray-300 border-white/5'} rounded-tl-sm border shadow-md font-medium`
                }`}>
                  {m.isImage ? (
                     <img src={m.content} alt="Generated content" className="rounded-lg w-full object-cover max-w-md bg-black min-h-[200px]" />
                  ) : (
                     displayContent
                  )}

                  {/* Render inline attachment if this message uploaded a file/photo */}
                  {m.role === 'user' && m.isAttachment && m.imageBytes && (
                    <div className="mt-3 border-t border-white/10 pt-2.5 max-w-[320px]">
                      {m.mimeType?.startsWith('image/') ? (
                        <img src={`data:${m.mimeType};base64,${m.imageBytes}`} alt="uploaded attachment" className="rounded-lg w-full object-contain max-h-56 bg-black border border-white/10" />
                      ) : (
                        <div className="flex items-center gap-2.5 p-2 bg-black/40 border border-white/10 rounded-xl">
                          <div className="w-8 h-8 rounded-lg bg-indigo-950 flex items-center justify-center border border-indigo-500/20">
                            <svg className="w-4 h-4 text-indigo-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                          </div>
                          <span className="truncate text-xs font-bold text-gray-200">{m.fileName}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {m.role === 'ai' && !m.isImage && (
                  <button 
                    onClick={() => playMessageTTS(displayContent, i)}
                    title="Speak this response"
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer flex-shrink-0 ${theme === 'light' ? 'border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-900' : 'border-white/5 bg-[#141414] hover:bg-[#222] text-gray-400 hover:text-white'} ${playingMessageId === i ? 'animate-pulse text-purple-400 border-purple-500/40 bg-purple-950/20' : ''}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                  </button>
                )}
              </div>

              {/* Related Follow-Up click questions cards */}
              {i === messages.length - 1 && m.role === 'ai' && parsed.questions.length > 0 && !isTyping && (
                <div className="flex flex-wrap gap-2 mt-3 max-w-[85%] animate-fade-in pl-1">
                  {parsed.questions.map((q, qIdx) => (
                    <button
                      key={qIdx}
                      onClick={() => handleSendMessage(q)}
                      className={`text-xs px-3.5 py-2 rounded-xl transition-all shadow-md text-left cursor-pointer font-medium active:scale-95 animate-fade-in border ${
                        theme === 'light' 
                          ? 'bg-white hover:bg-gray-50 text-purple-650 border-purple-200 hover:border-purple-300' 
                          : 'bg-[#111] hover:bg-[#1a1a1a] text-purple-300 hover:text-white border border-[#a855f7]/15 hover:border-[#a855f7]/30'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {isTyping && (
           <div className="flex flex-col items-start">
            <span className="text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-widest">BLACKBELL</span>
            <div className={`p-4 rounded-2xl max-w-[85%] text-sm rounded-tl-sm border shadow-md flex gap-1 ${
              theme === 'light' ? 'bg-white text-gray-500 border-gray-200' : 'bg-[#1c1c1c] text-gray-400 border-white/5'
            }`}>
              <span className="animate-bounce">.</span>
              <span className="animate-bounce delay-100" style={{animationDelay: '100ms'}}>.</span>
              <span className="animate-bounce delay-200" style={{animationDelay: '200ms'}}>.</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
           <div className="pt-4 pb-6 mt-auto">
        {/* Attachment selection preview pill */}
        {attachedFile && (
          <div className={`flex items-center gap-3 border p-2 px-3.5 rounded-xl mb-3.5 animate-fade-in ${
            theme === 'light' ? 'bg-white border-gray-200 text-gray-900 shadow-sm' : 'bg-[#111] border-white/5 text-white'
          }`}>
            {attachedFile.mimeType.startsWith('image/') ? (
              <img src={`data:${attachedFile.mimeType};base64,${attachedFile.base64}`} alt="preview" className="w-10 h-10 rounded-lg object-cover bg-black" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-indigo-900/40 border border-indigo-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-bold truncate ${theme === 'light' ? 'text-gray-950' : 'text-gray-200'}`}>{attachedFile.name}</p>
              <p className="text-[9px] text-gray-500 uppercase tracking-wider">{attachedFile.mimeType}</p>
            </div>
            <button 
              type="button" 
              onClick={() => setAttachedFile(null)} 
              className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="relative group">
          <button 
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors cursor-pointer p-0.5 ${theme === 'light' ? 'text-gray-400 hover:text-[#5b3eff]' : 'text-gray-500 hover:text-white'}`}
            title="Upload photo or file (Gemini style)"
          >
            <Plus className="w-5 h-5" />
          </button>
          
          <input 
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*,text/*,application/json"
            className="hidden"
          />

          <input 
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if(e.key === 'Enter') handleSendMessage() }}
            placeholder={attachedFile ? "Add a message or press enter to upload..." : "Type your message or ask Blackbell..."}
            className={`w-full border rounded-2xl py-4 pl-12 pr-14 outline-none transition-all text-sm ${
              theme === 'light' 
                ? 'bg-white hover:bg-gray-50/50 focus:bg-white text-gray-900 border-gray-200 focus:border-[#5b3eff]/30 placeholder-gray-400 shadow-sm' 
                : 'bg-[#111] hover:bg-[#151515] focus:bg-[#151515] text-white border-white/5 focus:border-white/10 placeholder-gray-600 shadow-lg'
            }`}
          />
          <button 
            onClick={handleSendMessage} 
            className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all cursor-pointer ${
              theme === 'light' 
                ? 'bg-purple-50 hover:bg-purple-100 text-[#5b3eff]' 
                : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'
            }`}
          >
             <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="flex justify-between items-center mt-3 px-2">
          <div className="flex items-center gap-2 select-none">
            <input 
              id="auto-speak-checkbox"
              type="checkbox"
              checked={autoSpeak}
              onChange={e => setAutoSpeak(e.target.checked)}
              className={`w-3.5 h-3.5 accent-[#5b3eff] rounded cursor-pointer ${
                theme === 'light' ? 'bg-white border-gray-300 text-gray-800' : 'bg-[#111] border-white/10 text-white'
              }`}
            />
            <label htmlFor="auto-speak-checkbox" className={`text-[10px] font-bold tracking-widest cursor-pointer uppercase transition-colors ${
              theme === 'light' ? 'text-gray-500 hover:text-gray-800' : 'text-gray-500 hover:text-gray-300'
            }`}>
              Auto Read Aloud (Voice Output)
            </label>
          </div>
          <span className="text-[10px] font-bold text-gray-600 tracking-widest hidden sm:block">VER 7.0 [STABLE]</span>
          <span className="text-[10px] font-bold text-gray-600 tracking-widest">SHIFT + ENTER FOR NEW LINE</span>
        </div>
      </div>
    </div>
  );

  const renderAdminDashboard = () => {
    const filteredUsers = adminUsers.filter(u => 
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.username.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div className="flex-1 flex flex-col h-full bg-[#070913] text-white p-4 md:p-8 overflow-y-auto font-sans [scrollbar-width:thin] lg:[scrollbar-width:auto]">
        {/* Header identical to the screens in Replit images */}
        <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setViewMode('app')}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer"
              title="Back to App Chats"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            </button>
            <div className="w-9 h-9 rounded-xl bg-sky-950/40 border border-sky-500/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Admin Panel
              </h1>
              <p className="text-[11px] text-gray-400">Chatter Control Center</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button 
              onClick={fetchAdminData}
              title="Refresh Users database"
              className={`p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer ${isAdminLoading ? 'animate-spin' : ''}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg>
            </button>
            <span className="px-2.5 py-1.5 bg-[#991b1b] text-[10px] font-black tracking-widest text-white rounded-lg select-none">
              ADMIN
            </span>
          </div>
        </div>

        {/* Dynamic Search Box */}
        <div className="mb-8 relative max-w-full">
          <input 
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search users by name, username or email..."
            className="w-full bg-[#111425] border border-[#23263b] focus:border-indigo-500/50 rounded-xl py-3.5 pl-11 pr-4 text-sm text-white placeholder-[#535670] outline-none transition-all shadow-md"
          />
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </div>

        {/* Stats Summary Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-[#111425] rounded-xl p-5 border border-white/5 shadow-sm">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Total Registered</p>
            <p className="text-3xl font-black font-mono text-white mt-1">{adminStats.totalUsers || 0}</p>
          </div>
          <div className="bg-[#111425] rounded-xl p-5 border border-white/5 shadow-sm">
            <p className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">Active Online</p>
            <p className="text-3xl font-black font-mono text-emerald-400 mt-1">{adminStats.onlineUsers || 0}</p>
          </div>
          <div className="bg-[#111425] rounded-xl p-5 border border-white/5 shadow-sm">
            <p className="text-xs text-red-400 font-semibold uppercase tracking-wider">Banned Users</p>
            <p className="text-3xl font-black font-mono text-red-500 mt-1">{adminStats.bannedUsers || 0}</p>
          </div>
        </div>

        {/* Real Dynamic Flowing Traffic Column Bar Chart */}
        {adminStats.traffic && adminStats.traffic.length > 0 && (
          <div className="bg-[#111425] rounded-2xl p-5 border border-white/5 shadow-sm mb-8 w-full">
            <div className="flex items-center justify-between mb-5">
              <span className="text-xs text-indigo-300 font-bold uppercase tracking-wider">Daily Traffic Analytics</span>
              <div className="flex gap-4 text-[10px] select-none">
                <span className="flex items-center gap-1.5 text-indigo-400">
                  <span className="w-2.5 h-2.5 bg-[#5b3eff] rounded-sm inline-block"></span> Visits Activity
                </span>
                <span className="flex items-center gap-1.5 text-purple-400">
                  <span className="w-2.5 h-2.5 bg-purple-500 rounded-sm inline-block"></span> Model Chats
                </span>
              </div>
            </div>

            <div className="h-44 flex items-end justify-around gap-2 pt-4 border-b border-white/5 pb-2">
              {adminStats.traffic.slice(-5).map((e: any, i: number) => {
                const maxVal = Math.max(...adminStats.traffic.map((t: any) => t.visits), 12);
                const visitsPercent = (e.visits / maxVal) * 100;
                const chatsPercent = (e.chatsCount / maxVal) * 100;

                return (
                  <div key={i} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                    {/* Floating Tooltip */}
                    <div className="absolute -top-16 bg-black/95 border border-white/10 text-[10px] text-white p-2.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap min-w-[125px] text-center shadow-2xl">
                      <p className="font-bold text-gray-300">{e.date}</p>
                      <p>Visits Logged: <span className="text-sky-300 font-bold">{e.visits}</span></p>
                      <p>Chats Counter: <span className="text-purple-300 font-bold">{e.chatsCount}</span></p>
                      <p>Unique Active: <span className="text-emerald-300 font-bold">{e.activeUsers?.length || 0}</span></p>
                    </div>

                    <div className="w-full flex items-end justify-center gap-1 h-full max-w-[40px]">
                      <div 
                        style={{ height: `${Math.max(5, visitsPercent)}%` }} 
                        className="flex-1 bg-[#5b3eff] rounded-t-sm transition-all duration-500 hover:brightness-110" 
                      />
                      <div 
                        style={{ height: `${Math.max(4, chatsPercent)}%` }} 
                        className="flex-1 bg-purple-500 rounded-t-sm transition-all duration-500 hover:brightness-110" 
                      />
                    </div>
                    <span className="text-[10px] text-gray-500 mt-2 font-mono">{e.date}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* All Users Core Table Section */}
        <div className="bg-[#111425] rounded-xl border border-white/5 overflow-hidden shadow-lg w-full">
          <div className="p-4 border-b border-white/5 bg-[#14172a]">
            <h2 className="text-sm font-bold text-gray-200">
              ALL USERS ({filteredUsers.length})
            </h2>
          </div>

          <div className="overflow-x-auto w-full [scrollbar-width:thin]">
            <table className="w-full min-w-[950px] text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-[10px] font-black tracking-wider text-gray-500 uppercase bg-[#0c0e1a]/80 select-none">
                  <th className="py-4 px-6">USER</th>
                  <th className="py-4 px-6">EMAIL</th>
                  <th className="py-4 px-6">PASSWORD</th>
                  <th className="py-4 px-6">STATUS</th>
                  <th className="py-4 px-6">LAST SEEN</th>
                  <th className="py-4 px-6">USAGE TIME</th>
                  <th className="py-4 px-6 text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredUsers.map((user: any) => {
                  const isUserAdmin = user.email === 'sy5455977@gmail.com';
                  const activeRelative = getRelativeTime(user.lastPing);

                  return (
                    <tr key={user.id} className="hover:bg-white/[0.01] transition-colors">
                      {/* USER Column with circle avatar and username */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#1b1e36] text-[#818cf8] border border-[#312e81] flex items-center justify-center font-bold text-sm uppercase select-none">
                            {user.username ? user.username.charAt(0) : '?'}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white flex items-center gap-1.5">
                              @{user.username || 'user'}
                              {isUserAdmin && (
                                <svg className="w-3.5 h-3.5 text-yellow-500 fill-current" viewBox="0 0 24 24"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">{user.username || 'user'}</p>
                          </div>
                        </div>
                      </td>

                      {/* EMAIL Column */}
                      <td className="py-4 px-6 text-sm text-gray-300 font-mono">
                        <div className="flex items-center gap-2">
                          {user.email}
                          {isUserAdmin && (
                            <span className="text-[10px] bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded-md font-bold uppercase select-none">
                              Admin
                            </span>
                          )}
                        </div>
                      </td>

                      {/* PASSWORD Column displayed as plain text inside tag card */}
                      <td className="py-4 px-6">
                        <span className="bg-[#1c1d32] border border-white/5 text-gray-300 px-2.5 py-1 rounded text-xs font-mono shadow-sm">
                          {user.password || '••••••••'}
                        </span>
                      </td>

                      {/* STATUS Column */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2 select-none">
                          <span className={`w-2.5 h-2.5 rounded-full inline-block ${user.online ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-gray-500'}`} />
                          <span className={`text-xs font-semibold ${user.online ? 'text-emerald-400' : 'text-gray-400'}`}>
                            {user.online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </td>

                      {/* LAST SEEN Column */}
                      <td className="py-4 px-6 text-xs text-gray-400 font-medium">
                        {user.online ? 'Active now' : activeRelative}
                      </td>

                      {/* USAGE TIME Column */}
                      <td className="py-4 px-6 text-xs text-gray-400 font-mono">
                        {formatDuration(user.activeDuration)}
                      </td>

                      {/* BAN / ACTION Column */}
                      <td className="py-4 px-6 text-right">
                        {isUserAdmin ? (
                          <span className="text-xs font-bold text-yellow-500 flex items-center justify-end gap-1 select-none">
                            <Shield className="w-3.5 h-3.5" /> Admin
                          </span>
                        ) : (
                          <button 
                            onClick={() => handleToggleBan(user.id, user.isBanned)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ml-auto ${
                              user.isBanned 
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm' 
                                : 'bg-[#991b1b]/15 hover:bg-[#991b1b]/30 text-red-400 border border-red-500/15'
                            }`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-ban"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>
                            {user.isBanned ? 'Unban' : 'Ban'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`flex h-[100dvh] font-sans overflow-hidden ${theme === 'light' ? 'bg-[#f9fafb] text-gray-900 border-gray-200' : 'bg-[#050505] text-white'}`}>
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 flex flex-col transform transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 ${theme === 'light' ? 'bg-white border-r border-gray-200 text-gray-900 shadow-sm' : 'bg-[#09090b] border-r border-white/5 text-white'}`}> 
        <div className="flex items-center justify-between p-4 pl-6">
           <div className="flex items-center gap-3">
              <div className={`w-7 h-7 rounded flex items-center justify-center border ${theme === 'light' ? 'bg-gray-100 border-gray-200' : 'bg-white/10 border-white/10'}`}>
                 <span className={`text-xs font-serif font-bold ${theme === 'light' ? 'text-gray-900' : 'text-gray-300'}`}>B</span>
              </div>
              <h1 className="font-bold tracking-widest text-sm uppercase">Blackbell AGI</h1>
           </div>
           <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-gray-400 hover:bg-white/5 rounded-lg transition-colors">
             <X className="w-5 h-5" />
           </button>
        </div>

        {/* Top sidebar area with dynamic admin toggle button placed exactly where requested */}
        <div className="px-4 mt-2">
           {currentUser?.email === 'sy5455977@gmail.com' && (
              <button 
                onClick={() => {
                  setViewMode(viewMode === 'admin' ? 'app' : 'admin');
                  setIsSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-xl transition-all cursor-pointer text-sm font-bold ${
                  viewMode === 'admin' 
                    ? 'bg-red-500/20 text-red-400 border border-red-500/35 shadow-md' 
                    : 'bg-purple-900/15 border border-purple-500/20 text-purple-400 hover:bg-purple-900/25'
                }`}
              >
                <Shield className="w-4 h-4 text-purple-400" />
                <span>Admin Panel</span>
              </button>
           )}
           
           <button onClick={handleNewSession} className={`w-full flex items-center gap-3 mt-4 px-4 py-3 rounded-xl border text-sm font-medium transition-colors cursor-pointer ${theme === 'light' ? 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-950' : 'bg-[#111] hover:bg-[#1a1a1a] border-white/5 text-white'}`}>
             <Plus className="w-4 h-4" />
             New Session
           </button>
           
           <div className={`flex items-center mt-4 p-1 rounded-xl border ${theme === 'light' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-white/5'}`}>
             <button onClick={() => setMode('text')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold tracking-widest transition-colors ${mode === 'text' ? (theme === 'light' ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50' : 'bg-[#1a1a1a] text-white shadow-sm') : 'text-gray-500 hover:text-gray-300'}`}>
               <Terminal className="w-3.5 h-3.5" /> TEXT
             </button>
             <button onClick={() => setMode('voice')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold tracking-widest transition-colors ${mode === 'voice' ? (theme === 'light' ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50' : 'bg-[#1a1a1a] text-white shadow-sm') : 'text-gray-500 hover:text-gray-300'}`}>
               <Mic className="w-3.5 h-3.5" /> VOICE
             </button>
           </div>

           {/* AI Learned Memories Panel */}
           {/* AI Learned Memories Panel hidden as requested */}
           {false && memories.length > 0 && (
             <div className="mt-6 border-t border-white/[0.03] pt-4">
               <div className="flex items-center gap-1.5 mb-2 px-1 text-purple-400 font-bold uppercase tracking-widest text-[10px]">
                 <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-brain"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v14"/></svg>
                 <span>Learned Memories ({memories.length})</span>
               </div>
               <div className="bg-[#111425]/35 border border-[#a855f7]/15 p-3 rounded-xl max-h-36 overflow-y-auto space-y-2 [scrollbar-width:thin] text-[11px] font-medium leading-relaxed">
                 {memories.map((m, idx) => (
                   <div key={idx} className="flex gap-1.5 text-gray-400 border-b border-white/[0.02] pb-1.5 last:border-0 last:pb-0">
                     <span className="text-purple-400 font-mono select-none">•</span>
                     <span>{m}</span>
                   </div>
                 ))}
               </div>
             </div>
           )}
        </div>

        <div className="flex-1 mt-6 overflow-y-auto px-2 space-y-1 pb-4">
           {sessions.map((s) => {
             let touchTimeout = null;

             const handleTouchStart = (e) => {
               if (renamingSessionId) return;
               const x = e.touches ? e.touches[0].clientX : e.clientX;
               const y = e.touches ? e.touches[0].clientY : e.clientY;
               touchTimeout = setTimeout(() => {
                 setActiveContextMenu({ id: s.id, x, y });
               }, 600);
             };

             const handleTouchEnd = () => {
               if (touchTimeout) {
                 clearTimeout(touchTimeout);
                 touchTimeout = null;
               }
             };

             const saveRename = (sId) => {
               if (!renameValue.trim()) return;
               setSessions(prev => prev.map(item => {
                 if (item.id === sId) {
                   return { ...item, title: renameValue.trim(), updatedAt: Date.now() };
                 }
                 return item;
               }));
               setRenamingSessionId(null);
             };

             return (
               <div key={s.id} className="relative group overflow-visible">
                 {renamingSessionId === s.id ? (
                   <div className="flex items-center gap-1.5 px-3 py-2 bg-white/5 rounded-lg border border-purple-500/25">
                     <input 
                       type="text"
                       value={renameValue}
                       onChange={e => setRenameValue(e.target.value)}
                       onKeyDown={e => {
                         if (e.key === 'Enter') saveRename(s.id);
                         if (e.key === 'Escape') setRenamingSessionId(null);
                       }}
                       className="bg-transparent text-xs text-white border-none outline-none w-full p-0 focus:ring-0 focus:outline-none focus:border-none"
                       autoFocus
                     />
                     <button 
                       onClick={() => saveRename(s.id)}
                       className="p-1 hover:bg-white/10 rounded text-emerald-400 cursor-pointer"
                     >
                       <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                     </button>
                     <button 
                       onClick={() => setRenamingSessionId(null)}
                       className="p-1 hover:bg-white/10 rounded text-red-400 cursor-pointer"
                     >
                       <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                     </button>
                   </div>
                 ) : (
                   <div 
                     role="button"
                     tabIndex={0}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' || e.key === ' ') {
                         setActiveSessionId(s.id);
                         setIsSidebarOpen(false);
                         setViewMode('app');
                       }
                     }}
                     className={`w-full flex items-center justify-between pl-3.5 pr-2.5 py-3 rounded-xl text-xs transition-all text-left font-bold border cursor-pointer outline-none ${
                       s.id === activeSessionId && viewMode === 'app'
                         ? 'bg-purple-950/20 text-purple-400 border-purple-500/25 shadow-lg shadow-purple-900/[0.04]' 
                         : 'text-gray-400 hover:text-white hover:bg-white/[0.02] border-transparent'
                     }`}
                     onMouseDown={handleTouchStart}
                     onMouseUp={handleTouchEnd}
                     onMouseLeave={handleTouchEnd}
                     onTouchStart={handleTouchStart}
                     onTouchEnd={handleTouchEnd}
                     onContextMenu={(e) => {
                       e.preventDefault();
                       setActiveContextMenu({ id: s.id, x: e.clientX, y: e.clientY });
                     }}
                     onClick={() => {
                       setActiveSessionId(s.id);
                       setIsSidebarOpen(false);
                       setViewMode('app');
                     }}
                   >
                     <div className="flex items-center gap-2.5 truncate max-w-[210px] select-none">
                       <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-40 group-hover:opacity-65" />
                       <span className="truncate pr-1">{s.title}</span>
                       {s.isPinned && (
                         <span className="text-[10px]" title="Pinned (Can't be auto-deleted)">📌</span>
                       )}
                     </div>
                     
                     <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button 
                         onClick={(e) => {
                           e.stopPropagation();
                           const rect = e.currentTarget.getBoundingClientRect();
                           setActiveContextMenu({ id: s.id, x: rect.left, y: rect.bottom + 5 });
                         }}
                         className="p-1 hover:bg-white/5 rounded-lg text-gray-400 hover:text-gray-100 cursor-pointer"
                         title="Options"
                       >
                         <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                       </button>
                     </div>
                   </div>
                 )}
               </div>
             );
           })}
        
        </div>
        
        <div className={`p-4 border-t flex items-center justify-between ${theme === 'light' ? 'border-gray-200 bg-white' : 'border-white/5 bg-[#09090b]'}`}>
          <button 
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${theme === 'light' ? 'text-gray-500 hover:text-indigo-600 hover:bg-gray-100' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5 text-indigo-500" />}
          </button>
          <button 
            type="button"
            onClick={handlePurgeSessions} 
            className={`text-xs font-bold px-3 py-1.5 rounded transition-colors tracking-widest uppercase cursor-pointer ${theme === 'light' ? 'text-red-600 hover:bg-red-50' : 'text-red-500 hover:bg-red-500/10'}`}
          >
            Purge
          </button>
        </div>
      </aside>

      {/* Main Screen Stage */}
      <div className={`flex-1 flex flex-col min-w-0 relative h-full ${theme === 'light' ? 'bg-[#f3f4f6]' : 'bg-[#050505]'}`}>
         {/* Mobile UI Overlay */}
         {isSidebarOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden transition-opacity" onClick={() => setIsSidebarOpen(false)} />}
         
         {viewMode === 'admin' ? (
           renderAdminDashboard()
         ) : (
           <>
             <header className={`flex justify-between items-center p-4 md:px-8 border-b ${theme === 'light' ? 'bg-white border-gray-200/60 text-gray-900 shadow-sm' : 'bg-[#050505] border-white/5 text-white'}`}><div className="flex items-center gap-2">
               <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg md:hidden transition-colors">
                 <Menu className="w-6 h-6" />
               </button>
               <div style={{display: 'none'}}></div>
                  <button 
                    onClick={() => {
                      setAutoSpeak(!autoSpeak);
                      try {
                        if (!outputAudioCtxRef.current) {
                          outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
                         }
                         if (outputAudioCtxRef.current.state === 'suspended') {
                           outputAudioCtxRef.current.resume();
                         }
                       } catch (e) {
                         console.warn("Failed audio pre-init on speak toggle:", e);
                       }
                    }}
                    title={autoSpeak ? "Disable Auto Read Aloud" : "Enable Auto Read Aloud"}
                    className={`p-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border ${
                      autoSpeak 
                        ? 'bg-purple-950/30 border-purple-500/30 text-purple-400 font-bold shadow-[0_0_15px_rgba(168,85,247,0.15)] animate-pulse' 
                        : theme === 'light' ? 'bg-gray-100 hover:bg-gray-200 border-gray-200 text-gray-500 hover:text-gray-900' : 'bg-[#111] hover:bg-[#181818] border-white/5 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {autoSpeak ? (
                      <Mic className="w-4 h-4 text-purple-400" />
                    ) : (
                      <MicOff className="w-4 h-4 text-gray-500" />
                    )}
                    <span className="text-[10px] uppercase tracking-wider font-bold select-none pr-1 hidden sm:inline-block">
                      {autoSpeak ? "Speak ON" : "Speak OFF"}
                    </span>
                  </button>
                </div>
                <div className="hidden md:block"></div>
               <button 
                 onClick={handleLogout}
                 className="flex items-center gap-2 px-4 py-2 border border-purple-500/30 bg-purple-500/10 rounded-full text-xs font-bold text-purple-400 hover:bg-purple-500/20 transition-colors tracking-widest ml-auto cursor-pointer"
               >
                 <LogOut className="w-3.5 h-3.5" />
                 {currentUser?.username?.toUpperCase() || 'SACHIN'}
               </button>
             </header>

                           {mode === 'voice' && renderVoiceUI()}
              {mode === 'text' && renderTextUI()}
            </>
          )}
      </div>

      {/* Floating ChatGPT Style Actions Menu Triggered by Context-Menu or Long Press */}
      {activeContextMenu && (
        <>
          <div 
            className="fixed inset-0 z-[999] bg-transparent font-sans" 
            onClick={() => setActiveContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setActiveContextMenu(null); }}
          />
          <div 
            style={{ 
              position: 'fixed', 
              top: Math.min(activeContextMenu.y, window.innerHeight - 200),
              left: Math.min(activeContextMenu.x, window.innerWidth - 180), 
            }}
            className={`border rounded-xl p-1 z-[1000] shadow-2xl min-w-[160px] animate-fade-in font-sans ${theme === 'light' ? 'bg-white border-gray-200 text-gray-900 shadow-xl' : 'bg-[#121214] border-white/10 text-white'}`}
          >
            <button 
              onClick={() => {
                const s = sessions.find(item => item.id === activeContextMenu.id);
                if (s) {
                  setSessions(prev => {
                    if (s.isPinned) {
                      const updated = prev.map(item => item.id === s.id ? { ...item, isPinned: false } : item);
                      return sortSessions(updated);
                    } else {
                      const pinnedCount = prev.filter(item => item.isPinned).length;
                      if (pinnedCount >= 5) {
                        showAlert("Pin Limit Reached", "You can pin a maximum of 5 sessions. Please unpin another session first.");
                        return prev;
                      }
                      const updated = prev.map(item => item.id === s.id ? { ...item, isPinned: true } : item);
                      return sortSessions(updated);
                    }
                  });
                }
                setActiveContextMenu(null);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-lg transition-colors text-left cursor-pointer ${theme === 'light' ? 'text-gray-700 hover:text-gray-950 hover:bg-gray-100' : 'text-gray-300 hover:text-white hover:bg-white/5'}`}
            >
              <svg className="w-3.5 h-3.5 text-purple-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>{sessions.find(s => s.id === activeContextMenu.id)?.isPinned ? 'Unpin Session' : 'Pin Session'}</span>
            </button>
            <button 
              onClick={() => {
                const s = sessions.find(item => item.id === activeContextMenu.id);
                if (s) {
                  setRenamingSessionId(s.id);
                  setRenameValue(s.title);
                }
                setActiveContextMenu(null);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-lg transition-colors text-left cursor-pointer ${theme === 'light' ? 'text-gray-700 hover:text-gray-950 hover:bg-gray-100' : 'text-gray-300 hover:text-white hover:bg-white/5'}`}
            >
              <svg className="w-3.5 h-3.5 text-blue-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Rename Title</span>
            </button>
            <div className={`h-px my-1 ${theme === 'light' ? 'bg-gray-200' : 'bg-white/5'}`} />
            <button 
              onClick={() => {
                const s = sessions.find(item => item.id === activeContextMenu.id);
                if (s) {
                  if (s.isPinned) {
                    showAlert("Session Pinned", "This session is pinned. You cannot delete a pinned session until you unpin it.");
                  } else {
                    showConfirm(
                      'Delete Session',
                      `Are you sure you want to delete the session "${s.title}"?`,
                      () => {
                        const remaining = sessions.filter(item => item.id !== s.id);
                        setSessions(remaining);
                        if (activeSessionId === s.id) {
                          setActiveSessionId(remaining[0]?.id || 'default');
                        }
                      }
                    );
                  }
                }
                setActiveContextMenu(null);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold rounded-lg transition-colors text-left cursor-pointer ${theme === 'light' ? 'text-red-600 hover:bg-red-50 hover:text-red-700' : 'text-red-400 hover:bg-red-500/10'}`}
            >
              <svg className="w-3.5 h-3.5 text-red-500" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              <span>Delete Session</span>
            </button>
          </div>
        </>
      )}

      {/* Custom Alert/Confirm Modal */}
      {modalConfig.isOpen && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
          />
          <div className={`relative w-full max-w-sm rounded-2xl border p-6 shadow-2xl animate-fade-in font-sans ${theme === 'light' ? 'bg-white border-gray-200 text-gray-900' : 'bg-[#121214] border-white/10 text-white'}`}>
            <h3 className="text-base font-bold mb-2 flex items-center gap-2">
              <AlertCircle className={`w-5 h-5 ${theme === 'light' ? 'text-purple-600' : 'text-purple-400'}`} />
              {modalConfig.title}
            </h3>
            <p className={`text-xs mb-6 font-medium leading-relaxed ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>
              {modalConfig.message}
            </p>
            <div className="flex gap-2.5 justify-end">
              {modalConfig.isConfirm && (
                <button 
                  type="button"
                  onClick={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${theme === 'light' ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}
                >
                  Cancel
                </button>
              )}
              <button 
                type="button"
                onClick={() => {
                  const callback = modalConfig.onConfirm;
                  setModalConfig(prev => ({ ...prev, isOpen: false }));
                  if (callback) callback();
                }}
                className="px-4 py-2 bg-[#5b3eff] hover:bg-[#482ee6] text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md"
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
