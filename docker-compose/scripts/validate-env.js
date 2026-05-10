#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const envPath = path.resolve(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  console.error("❌ .env file not found. Hãy tạo từ .env.example trước khi deploy.");
  process.exit(1);
}

const envMeta = {};

function parseEnvFile(filePath) {
  const out = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const idx = s.indexOf("=");
    const key = s.slice(0, idx).trim();
    const rawValue = s.slice(idx + 1).trim();
    const quote = (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? "'"
      : ((rawValue.startsWith('"') && rawValue.endsWith('"')) ? '"' : "");
    let value = rawValue;
    value = value.replace(/^['"]|['"]$/g, "");
    envMeta[key] = { rawValue, quote };
    out[key] = value;
  }
  return out;
}

const env = parseEnvFile(envPath);

function expandEnvReferences(values) {
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  for (let pass = 0; pass < 5; pass += 1) {
    let changed = false;
    for (const [key, value] of Object.entries(values)) {
      const next = String(value || "").replace(pattern, (_match, name) => values[name] ?? "");
      if (next !== value) {
        values[key] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

expandEnvReferences(env);

const errors = [];
const warnings = [];
const ok = [];

function isBool(v) {
  return v === "true" || v === "false";
}

function checkPort(key, required = true) {
  const v = env[key];
  if (!v) {
    if (required) errors.push(`${key} is required`);
    else warnings.push(`${key} not set (optional)`);
    return;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    errors.push(`${key} must be an integer in range 1..65535`);
    return;
  }
  ok.push(`${key}=${n}`);
}

function checkRequired(key, desc, validate) {
  const v = (env[key] || "").trim();
  if (!v) {
    errors.push(`${key} is required (${desc})`);
    return;
  }
  if (validate) {
    const msg = validate(v);
    if (msg) {
      errors.push(`${key}: ${msg}`);
      return;
    }
  }
  ok.push(`${key}=OK`);
}

function checkOptional(key, desc, validate) {
  const v = (env[key] || "").trim();
  if (!v) {
    warnings.push(`${key} optional: ${desc}`);
    return;
  }
  if (validate) {
    const msg = validate(v);
    if (msg) {
      errors.push(`${key}: ${msg}`);
      return;
    }
  }
  ok.push(`${key}=OK (optional)`);
}

function isValidDomain(v) {
  if (v.startsWith("http://") || v.startsWith("https://")) return "must not include http/https";
  if (v.endsWith("/")) return "must not end with /";
  if (!v.includes(".")) return "must be a valid domain, e.g. example.com";
  return null;
}

function isValidHttpsJsonUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.pathname.endsWith(".json");
  } catch {
    return false;
  }
}

function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function validateHttpUrl(v) {
  return isHttpUrl(v) ? null : "must be an http(s) URL";
}

function validateOriginList(v) {
  const items = v.split(",").map((item) => item.trim()).filter(Boolean);
  if (!items.length) return null;
  const invalid = items.find((item) => !isHttpUrl(item));
  return invalid ? `invalid origin: ${invalid}` : null;
}

function validateFirebaseDatabaseUrl(v) {
  if (!isHttpUrl(v)) return "must be an http(s) Firebase Realtime Database URL";
  if (v.endsWith(".json")) return "must be the database root URL, not a .json REST path";
  return null;
}

function validateJsonObject(v) {
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? null : "must be a JSON object";
  } catch (err) {
    return `invalid JSON: ${err.message}`;
  }
}

function buildAppHost(project, domain) {
  const p = (project || "").trim().toLowerCase();
  const d = (domain || "").trim().toLowerCase();
  if (p && d && (d === p || d.startsWith(`${p}.`))) {
    return domain;
  }
  return `${project}.${domain}`;
}

// 1) Required core env from compose files
checkRequired("PROJECT_NAME", "docker project/network + subdomain prefix", (v) =>
  /^[a-z0-9][a-z0-9-]*$/.test(v) ? null : "only lowercase letters, numbers, hyphen"
);
checkRequired("DOMAIN", "root domain", isValidDomain);
checkRequired("CADDY_EMAIL", "caddy email label", (v) => (v.includes("@") ? null : "invalid email"));
checkRequired("CADDY_AUTH_USER", "basic auth username");
checkRequired("CADDY_AUTH_HASH", "basic auth bcrypt hash", (v) => {
  if (v.includes("$$")) {
    return "must not escape dollars as $$; use single quotes around the bcrypt hash";
  }
  if (envMeta.CADDY_AUTH_HASH?.quote !== "'") {
    return "wrap the bcrypt hash in single quotes, e.g. CADDY_AUTH_HASH='$2a$14$...'";
  }
  return /^\$2[aby]\$\d{2}\$/.test(v) ? null : "must be bcrypt hash ($2a$/$2b$/$2y$...)";
});
checkPort("APP_PORT", true);

// 2) Optional env from compose files
checkPort("APP_HOST_PORT", false);
checkPort("DOZZLE_HOST_PORT", false);
checkPort("FILEBROWSER_HOST_PORT", false);
checkPort("RCLONE_MANAGER_GUI_HOST_PORT", false);
checkPort("RCLONE_MANAGER_GUI_PORT", false);
checkPort("WEBSSH_HOST_PORT", false);
checkOptional("NODE_ENV", "app runtime env");
checkOptional("HEALTH_PATH", "health endpoint path", (v) => (v.startsWith("/") ? null : "must start with '/'"));
checkOptional("DOCKER_SOCK", "docker socket path override");
checkOptional("RCLONE_MANAGER_FRONTEND_URL", "rclone OAuth callback/frontend base URL", validateHttpUrl);
checkOptional("RCLONE_MANAGER_ALLOWED_ORIGINS", "comma-separated CORS origins", validateOriginList);
checkOptional("RCLONE_MANAGER_BACKEND_API_KEY", "optional shared key for external backend API callers", (v) =>
  v.length >= 16 ? null : "should be at least 16 characters"
);
checkOptional("RCLONE_MANAGER_REQUIRE_GOOGLE_AUTH", "true|false toggle for Firebase Google auth", (v) =>
  isBool(v) ? null : "must be true|false"
);
checkOptional("RCLONE_MANAGER_AUTH_SESSION_SECRET", "secret used to sign Google auth sessions", (v) =>
  v.length >= 32 ? null : "should be at least 32 characters"
);
checkOptional("RCLONE_MANAGER_AUTH_SESSION_TTL_MS", "Google auth session lifetime in milliseconds", (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 60000 ? null : "must be an integer >= 60000";
});
checkOptional("RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_API_KEY", "Firebase Web API key for Google Auth");
checkOptional("RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_AUTH_DOMAIN", "Firebase Auth domain", (v) =>
  v.includes(".firebaseapp.com") || v.includes(".web.app") ? null : "should be a Firebase auth domain"
);
checkOptional("RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_DATABASE_URL", "Firebase Web databaseURL", validateFirebaseDatabaseUrl);
checkOptional("RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_PROJECT_ID", "Firebase projectId");
checkOptional("RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_STORAGE_BUCKET", "Firebase storageBucket");
checkOptional("RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_MESSAGING_SENDER_ID", "Firebase messagingSenderId", (v) =>
  /^\d+$/.test(v) ? null : "must contain digits only"
);
checkOptional("RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_APP_ID", "Firebase appId", (v) =>
  /^1:\d+:web:[0-9a-f]+$/i.test(v) ? null : "does not look like a Firebase web appId"
);
checkOptional("RCLONE_MANAGER_FIREBASE_DATABASE_URL", "rclone manager Firebase Realtime Database URL", validateFirebaseDatabaseUrl);
checkOptional("RCLONE_MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON", "Firebase service account JSON", validateJsonObject);
checkOptional("RCLONE_MANAGER_FIREBASE_SERVICE_ACCOUNT_PATH", "container path to mounted Firebase service account file");
checkOptional("RCLONE_MANAGER_FIREBASE_DATABASE_SECRET", "Firebase Realtime Database legacy secret");
checkOptional("RCLONE_MANAGER_ENCRYPTION_KEY", "secret used to encrypt stored OAuth client secrets", (v) =>
  v.length >= 16 ? null : "should be at least 16 characters"
);
checkOptional("RCLONE_MANAGER_GUI_PUBLIC_URL", "public URL for the built-in rclone GUI", validateHttpUrl);
checkOptional("RCLONE_MANAGER_GUI_CADDY_HOSTS", "comma-separated Caddy hostnames for rclone GUI");
checkOptional("RCLONE_MANAGER_GUI_CONFIG_PATH", "app-container path to generated GUI rclone.conf");
checkOptional("RCLONE_MANAGER_GUI_CONTAINER_CONFIG_PATH", "GUI-container path to mounted rclone.conf");
checkOptional("RCLONE_MANAGER_GUI_CONTAINER_CACHE_DIR", "GUI-container cache directory for web GUI assets");
checkOptional("RCLONE_MANAGER_GUI_WEB_GUI_UPDATE", "true|false toggle for rclone web GUI auto update", (v) =>
  isBool(v) ? null : "must be true|false"
);
checkOptional("RCLONE_MANAGER_GUI_RC_ALLOW_ORIGIN", "optional RC CORS allow-origin value");
checkOptional("RCLONE_MANAGER_GUI_AUTO_MOUNT_SELECTED", "true|false toggle to mount selected configs when publishing to GUI", (v) =>
  isBool(v) ? null : "must be true|false"
);
checkOptional("RCLONE_MANAGER_GUI_EXTRA_ARGS", "advanced extra args appended to rclone rcd");

const rcloneGuiRcUser = (env.RCLONE_MANAGER_GUI_RC_USER || "").trim();
const rcloneGuiRcPass = (env.RCLONE_MANAGER_GUI_RC_PASS || "").trim();
if (rcloneGuiRcUser || rcloneGuiRcPass) {
  if (!rcloneGuiRcUser) errors.push("RCLONE_MANAGER_GUI_RC_USER is required when RCLONE_MANAGER_GUI_RC_PASS is set");
  if (!rcloneGuiRcPass) errors.push("RCLONE_MANAGER_GUI_RC_PASS is required when RCLONE_MANAGER_GUI_RC_USER is set");
  if (rcloneGuiRcPass && rcloneGuiRcPass.length < 8) {
    warnings.push("RCLONE_MANAGER_GUI_RC_PASS should be at least 8 characters");
  }
  if (rcloneGuiRcUser && rcloneGuiRcPass) ok.push("RCLONE_MANAGER_GUI_RC_AUTH=enabled");
} else {
  ok.push("RCLONE_MANAGER_GUI_RC_AUTH=disabled");
}
checkPort("DOCKER_DEPLOY_CODE_PORT", false);
checkPort("DOCKER_DEPLOY_CODE_HOST_PORT", false);
checkOptional("DOCKER_DEPLOY_CODE_INTERNAL_URL", "internal deploy-code sidecar URL", validateHttpUrl);
checkOptional("DOCKER_DEPLOY_CODE_CADDY_HOSTS", "public Caddy host(s) for deploy-code API");
checkOptional("DOCKER_DEPLOY_CODE_REPO_DIR", "repo path mounted inside deploy-code sidecar");
checkOptional("DOCKER_DEPLOY_CODE_BRANCH", "git branch to deploy");
checkOptional("DOCKER_DEPLOY_CODE_REMOTE", "git remote to fetch");
checkOptional("DOCKER_DEPLOY_CODE_COMPOSE_SCRIPT", "compose orchestration script inside repo");
checkOptional("DOCKER_DEPLOY_CODE_DEPLOY_SERVICES", "comma-separated compose services to rebuild/redeploy");
checkOptional("DOCKER_DEPLOY_CODE_RESTART_CONTAINERS", "comma-separated container names to docker restart after deploy");
checkOptional("DOCKER_DEPLOY_CODE_CONTAINER_CONTROL_ENABLED", "true|false toggle for container control API", (v) =>
  isBool(v) ? null : "must be true|false"
);
checkOptional("DOCKER_DEPLOY_CODE_CONTAINER_ALLOW_ALL", "true|false toggle to allow all Docker containers", (v) =>
  isBool(v) ? null : "must be true|false"
);
checkOptional("DOCKER_DEPLOY_CODE_SERVICE_ALLOWLIST", "comma-separated compose services allowed for start/stop/restart/rebuild/logs");
checkOptional("DOCKER_DEPLOY_CODE_CONTAINER_ALLOWLIST", "comma-separated containers allowed for start/stop/restart/logs/inspect");
checkOptional("DOCKER_DEPLOY_CODE_CONTAINER_LOG_DEFAULT_LINES", "default container log tail lines", (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? null : "must be positive integer";
});
checkOptional("DOCKER_DEPLOY_CODE_CONTAINER_LOG_MAX_LINES", "max container log tail lines", (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? null : "must be positive integer";
});
checkOptional("DOCKER_DEPLOY_CODE_CONTAINER_ACTION_TIMEOUT_SEC", "Docker action timeout seconds", (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 30 ? null : "must be integer >= 30";
});
checkOptional("DOCKER_DEPLOY_CODE_API_TOKEN", "optional sidecar API token", (v) =>
  v.length >= 16 ? null : "should be at least 16 characters"
);
checkOptional("DOCKER_DEPLOY_CODE_POLL_INTERVAL_SEC", "git polling interval seconds", (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 30 ? null : "must be integer >= 30";
});
checkOptional("DOCKER_DEPLOY_CODE_ZIP_MAX_MB", "max raw ZIP upload size in MB", (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? null : "must be positive integer";
});

const hasFirebaseUrl = Boolean((env.RCLONE_MANAGER_FIREBASE_DATABASE_URL || "").trim());
const hasServiceAccount = Boolean(
  (env.RCLONE_MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON || "").trim() ||
  (env.RCLONE_MANAGER_FIREBASE_SERVICE_ACCOUNT_PATH || "").trim()
);
const hasDatabaseSecret = Boolean((env.RCLONE_MANAGER_FIREBASE_DATABASE_SECRET || "").trim());
if (!hasFirebaseUrl && (hasServiceAccount || hasDatabaseSecret)) {
  errors.push("RCLONE_MANAGER_FIREBASE_DATABASE_URL is required when Firebase credentials are set");
}
if (hasFirebaseUrl && !hasServiceAccount && !hasDatabaseSecret) {
  warnings.push("RCLONE_MANAGER_FIREBASE_DATABASE_URL set without credentials -> app may fall back to offline memory mode");
}
if (hasServiceAccount && hasDatabaseSecret) {
  warnings.push("Both Firebase service account and database secret are set -> service account mode takes precedence");
}

const requireGoogleAuth = env.RCLONE_MANAGER_REQUIRE_GOOGLE_AUTH ? env.RCLONE_MANAGER_REQUIRE_GOOGLE_AUTH === "true" : true;
const hasBackendApiKey = Boolean((env.RCLONE_MANAGER_BACKEND_API_KEY || "").trim());
if (requireGoogleAuth) {
  for (const key of [
    "RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_API_KEY",
    "RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_AUTH_DOMAIN",
    "RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_PROJECT_ID",
    "RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_APP_ID",
  ]) {
    if (!(env[key] || "").trim()) errors.push(`${key} is required when RCLONE_MANAGER_REQUIRE_GOOGLE_AUTH=true`);
  }
  if (!(env.RCLONE_MANAGER_AUTH_SESSION_SECRET || "").trim()) {
    errors.push("RCLONE_MANAGER_AUTH_SESSION_SECRET is required when RCLONE_MANAGER_REQUIRE_GOOGLE_AUTH=true");
  }
  if (!hasBackendApiKey) {
    warnings.push("RCLONE_MANAGER_BACKEND_API_KEY is empty -> external API-key access is disabled; UI still uses Google auth");
  }
} else if (!hasBackendApiKey) {
  warnings.push("RCLONE_MANAGER_REQUIRE_GOOGLE_AUTH=false and RCLONE_MANAGER_BACKEND_API_KEY is empty -> protected APIs are open");
}

// 3) Flags
for (const key of ["ENABLE_DOZZLE", "ENABLE_FILEBROWSER", "RCLONE_MANAGER_GUI_ENABLED", "ENABLE_WEBSSH", "ENABLE_TAILSCALE", "DOCKER_DEPLOY_CODE_ENABLED", "DOCKER_DEPLOY_CODE_APP_PROXY_ENABLED", "DOCKER_DEPLOY_CODE_POLL_ENABLED", "DOCKER_DEPLOY_CODE_AUTO_DEPLOY_ON_CHANGE", "DOCKER_DEPLOY_CODE_RUN_ON_START", "DOCKER_DEPLOY_CODE_REQUIRE_TOKEN", "DOCKER_DEPLOY_CODE_GIT_CLEAN", "DOCKER_DEPLOY_CODE_ZIP_STRIP_TOP_LEVEL", "DOCKER_DEPLOY_CODE_ZIP_DELETE_MISSING", "DOCKER_DEPLOY_CODE_ZIP_BACKUP_BEFORE_APPLY", "DOCKER_DEPLOY_CODE_ZIP_DEPLOY_AFTER_APPLY"]) {
  const v = env[key];
  if (!v) {
    warnings.push(`${key} not set -> using default from scripts/compose`);
    continue;
  }
  if (!isBool(v)) errors.push(`${key} must be true|false`);
  else ok.push(`${key}=${v}`);
}

// 4) Files required by cloudflared mounts
const cfConfig = path.resolve(process.cwd(), "cloudflared/config.yml");
const cfCreds = path.resolve(process.cwd(), "cloudflared/credentials.json");
if (!fs.existsSync(cfConfig)) errors.push("cloudflared/config.yml missing (cloudflared mount required)");
else ok.push("cloudflared/config.yml present");
if (!fs.existsSync(cfCreds)) errors.push("cloudflared/credentials.json missing (cloudflared mount required)");
else ok.push("cloudflared/credentials.json present");

// 5) Optional webssh runtime tuning vars
if ((env.ENABLE_WEBSSH || "true") === "true") {
  if (!env.CUR_WHOAMI) warnings.push("CUR_WHOAMI optional (webssh linux default runner)");
  if (!env.CUR_WORK_DIR) warnings.push("CUR_WORK_DIR optional (webssh linux default /home/runner)");
  if (!env.SHELL) warnings.push("SHELL optional (webssh linux default /bin/bash)");
}

// 6) Tailscale + keep-ip rules based on compose.access.yml
if (env.ENABLE_TAILSCALE === "true") {
  checkRequired("TAILSCALE_AUTHKEY", "required by tailscale service", (v) =>
    v.startsWith("tskey-") ? null : "must start with tskey-"
  );
  checkRequired("TAILSCALE_TAILNET_DOMAIN", "required by dc.sh to render tailscale/serve.json", (v) =>
    v && v !== "-" ? null : "must not be empty or '-'"
  );
  checkOptional("TAILSCALE_TAGS", "advertise tags", (v) =>
    /^tag:[A-Za-z0-9][A-Za-z0-9_-]*(,tag:[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(v)
      ? null
      : "format must be tag:a,tag:b"
  );

  const keepIp = (env.TAILSCALE_KEEP_IP_ENABLE || "false").trim();
  if (!isBool(keepIp)) errors.push("TAILSCALE_KEEP_IP_ENABLE must be true|false");

  const keepRemove = (env.TAILSCALE_KEEP_IP_REMOVE_HOSTNAME_ENABLE || "").trim();
  if (keepRemove && !isBool(keepRemove)) {
    errors.push("TAILSCALE_KEEP_IP_REMOVE_HOSTNAME_ENABLE must be true|false when provided");
  }

  if (keepIp === "true") {
    checkRequired("TAILSCALE_KEEP_IP_FIREBASE_URL", "required when keep-ip enabled", (v) =>
      isValidHttpsJsonUrl(v) ? null : "must be https URL ending with .json"
    );
    checkOptional("TAILSCALE_KEEP_IP_CERTS_DIR", "certs dir path");
    checkOptional("TAILSCALE_KEEP_IP_INTERVAL_SEC", "backup interval seconds", (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 5 ? null : "must be integer >= 5";
    });
  } else {
    warnings.push("TAILSCALE_KEEP_IP_ENABLE=false -> keep-ip backup/restore disabled");
  }

  const removeHostnameEnabled = keepRemove ? keepRemove === "true" : keepIp === "true";
  if (removeHostnameEnabled) {
    if (!env.TAILSCALE_CLIENTID) {
      errors.push("remove-hostname enabled requires TAILSCALE_CLIENTID");
    }
    const authKey = (env.TAILSCALE_AUTHKEY || "").trim();
    if (!authKey) {
      errors.push("remove-hostname enabled requires TAILSCALE_AUTHKEY");
    } else if (!authKey.startsWith("tskey-client-")) {
      errors.push("remove-hostname requires TAILSCALE_AUTHKEY in tskey-client-* format");
    }
  }
}

const project = env.PROJECT_NAME || "<project>";
const domain = env.DOMAIN || "<domain>";
const host = env.PROJECT_NAME || "myapp";
const tailnet = env.TAILSCALE_TAILNET_DOMAIN || "tailnet.local";
const appHost = buildAppHost(project, domain);
ok.push(`subdomain preview: app=${appHost}`);
if ((env.ENABLE_DOZZLE || "true") === "true") ok.push(`subdomain preview: logs=logs.${appHost}`);
if ((env.ENABLE_FILEBROWSER || "true") === "true") ok.push(`subdomain preview: files=files.${appHost}`);
if (env.RCLONE_MANAGER_GUI_ENABLED === "true") {
  const guiHost = (env.RCLONE_MANAGER_GUI_CADDY_HOSTS || `rclone-gui.${domain}`)
    .split(",")[0]
    .trim()
    .replace(/^https?:\/\//i, "");
  ok.push(`subdomain preview: rclone-gui=${guiHost}`);
}
if ((env.ENABLE_WEBSSH || "true") === "true") ok.push(`subdomain preview: ttyd=ttyd.${appHost}`);
if (env.ENABLE_TAILSCALE === "true") {
  const dozzlePort = env.DOZZLE_HOST_PORT || "18080";
  const filesPort = env.FILEBROWSER_HOST_PORT || "18081";
  const guiPort = env.RCLONE_MANAGER_GUI_HOST_PORT || "5572";
  const sshPort = env.WEBSSH_HOST_PORT || "17681";
  ok.push(`tailnet host: https://${host}.${tailnet}`);
  if ((env.ENABLE_DOZZLE || "true") === "true") ok.push(`tailnet dozzle: http://${host}.${tailnet}:${dozzlePort}`);
  if ((env.ENABLE_FILEBROWSER || "true") === "true") ok.push(`tailnet filebrowser: http://${host}.${tailnet}:${filesPort}`);
  if (env.RCLONE_MANAGER_GUI_ENABLED === "true") ok.push(`tailnet rclone-gui: http://${host}.${tailnet}:${guiPort}`);
  if ((env.ENABLE_WEBSSH || "true") === "true") ok.push(`tailnet webssh: http://${host}.${tailnet}:${sshPort}`);
}

console.log("\n📋 ENV VALIDATION REPORT");
console.log("─".repeat(60));

if (ok.length) {
  console.log(`\n✅ Valid (${ok.length})`);
  for (const s of ok) console.log(`  - ${s}`);
}
if (warnings.length) {
  console.log(`\n⚠️ Warnings (${warnings.length})`);
  for (const s of warnings) console.log(`  - ${s}`);
}
if (errors.length) {
  console.log(`\n❌ Errors (${errors.length})`);
  for (const s of errors) console.log(`  - ${s}`);
  console.log("\nDừng triển khai. Hãy sửa lỗi bắt buộc trước khi chạy up.\n");
  process.exit(1);
}

console.log("\n✅ Env hợp lệ. Có thể triển khai.\n");
