import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "db.json");

export interface UserInfo {
  id: string;
  email: string;
  username: string;
  password?: string;
  online: boolean;
  lastPing: number;
  createdAt: string;
  isBanned: boolean;
  activeDuration: number; // in seconds
  memories?: string[];
  sessionToken?: string;
}

export interface TrafficEntry {
  date: string;
  visits: number;
  activeUsers: string[];
  chatsCount: number;
}

export interface DBData {
  users: UserInfo[];
  traffic: TrafficEntry[];
}

function getInitialDB(): DBData {
  return {
    users: [
      {
        id: "admin-id",
        email: "sy5455977@gmail.com",
        username: "sy5455977@gmail.com",
        password: "Sachin6264341093",
        online: true,
        lastPing: Date.now(),
        createdAt: new Date().toISOString(),
        isBanned: false,
        activeDuration: 15420
      }
    ],
    traffic: []
  };
}

export function readDB(): DBData {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const initial = getInitialDB();
      fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }
    const content = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.error("Error reading database file:", err);
    return getInitialDB();
  }
}

export function writeDB(data: DBData): void {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error writing database file:", err);
  }
}

// Log traffic for the current day
export function logTraffic(email: string, isChat: boolean = false) {
  const db = readDB();
  const todayStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  
  let entry = db.traffic.find(t => t.date === todayStr);
  if (!entry) {
    entry = {
      date: todayStr,
      visits: 0,
      activeUsers: [],
      chatsCount: 0
    };
    db.traffic.push(entry);
  }

  entry.visits += 1;
  if (!entry.activeUsers.includes(email)) {
    entry.activeUsers.push(email);
  }
  if (isChat) {
    entry.chatsCount += 1;
  }

  writeDB(db);
}

// Update users who have ceased pinging
export function updateOnlineStatuses() {
  const db = readDB();
  const threshold = 35000; // 35 seconds offline threshold
  const now = Date.now();
  let changed = false;

  db.users = db.users.map(u => {
    const isRecentlyActive = (now - u.lastPing) < threshold;
    if (u.online && !isRecentlyActive) {
      u.online = false;
      changed = true;
    }
    return u;
  });

  if (changed) {
    writeDB(db);
  }
}

export function getUserMemories(email: string): string[] {
  try {
    const db = readDB();
    const cleanEmail = email.trim().toLowerCase();
    const user = db.users.find(u => u.email === cleanEmail);
    return user?.memories || [];
  } catch (err) {
    console.error("getUserMemories error:", err);
    return [];
  }
}

export function appendUserMemory(email: string, memory: string): void {
  try {
    const db = readDB();
    const cleanEmail = (email || "").trim().toLowerCase();
    if (!cleanEmail) return;
    const user = db.users.find(u => u.email === cleanEmail);
    if (user) {
      if (!user.memories) {
        user.memories = [];
      }
      const lowerMemory = memory.toLowerCase().trim();
      const exists = user.memories.some(m => m.toLowerCase().trim() === lowerMemory);
      if (!exists && memory.trim().length > 0) {
        user.memories.push(memory.trim());
        if (user.memories.length > 20) {
          user.memories.shift();
        }
        writeDB(db);
      }
    }
  } catch (err) {
    console.error("appendUserMemory error:", err);
  }
}
