const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const LOG_DIR = process.env.LOG_DIR || "./logs";

fs.mkdirSync(LOG_DIR, { recursive: true });

const logFile = path.join(LOG_DIR, "app.log");

let logStream = null;
try {
  logStream = fs.createWriteStream(logFile, { flags: "a" });
  logStream.on("error", (err) => {
    console.error(`[LOG_STREAM_ERROR] ${err.message}`);
    logStream = null;
  });
} catch (err) {
  console.error(`[LOG_INIT_ERROR] ${err.message}`);
}

function writeLog(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  console.log(line);

  if (logStream) {
    try {
      logStream.write(line + "\n");
    } catch (err) {
      console.error(`[LOG_WRITE_ERROR] ${err.message}`);
    }
  }
}

app.use((req, res, next) => {
  writeLog("INFO", `${req.method} ${req.url} - ip:${req.ip}`);
  next();
});

app.get("/", (req, res) => {
  res.json({
    message: "Hello World!",
    service: "my-docker-app",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

app.get("/health", (req, res) => {
  writeLog("INFO", "Health check requested");
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/logs/tail", (req, res) => {
  try {
    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n").slice(-50);
    res.json({ lines, total: lines.length });
  } catch {
    res.json({ lines: [], total: 0 });
  }
});

app.listen(PORT, () => {
  writeLog("INFO", `Server started on port ${PORT} | env=${process.env.NODE_ENV || "development"}`);
});
