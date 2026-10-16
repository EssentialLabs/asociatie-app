const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const JSONL_LOG_PATH = path.join(LOG_DIR, 'telemetry-errors.jsonl');
const TEXT_LOG_PATH = path.join(LOG_DIR, 'telemetry-errors.log');

function ensureLogFiles() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    if (!fs.existsSync(JSONL_LOG_PATH)) {
      fs.writeFileSync(JSONL_LOG_PATH, '', 'utf8');
    }
    if (!fs.existsSync(TEXT_LOG_PATH)) {
      fs.writeFileSync(
        TEXT_LOG_PATH,
        `# ORHIDEEA Telemetry & Error Log\n# Initialized: ${new Date().toISOString()}\n\n`,
        'utf8'
      );
    }
  } catch (_) {
    // Ignore filesystem errors in read-only environments
  }
}

/**
 * Records an error event into:
 * 1. G:\asociatie-app\logs\telemetry-errors.jsonl (structured JSONL for AI agents)
 * 2. G:\asociatie-app\logs\telemetry-errors.log (human-readable stack trace log)
 * 3. SQLite `system_error_logs` table (for Turn de Control UI)
 */
function recordTelemetryError(db, payload = {}) {
  ensureLogFiles();

  const timestamp = payload.timestamp || new Date().toISOString();
  const entry = {
    timestamp,
    platforma: String(payload.platforma || payload.source || 'web-app'),
    severity: String(payload.severity || 'ERROR'),
    method: payload.method || null,
    url: payload.url || null,
    status: payload.status || null,
    asociatie_id: payload.asociatie_id || null,
    user: payload.user || null,
    mesaj: String(payload.mesaj || payload.message || 'Eroare necunoscută'),
    stack: String(payload.stack || ''),
    context: payload.context || null
  };

  // 1. Append to JSONL file
  try {
    fs.appendFileSync(JSONL_LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
  } catch (_) {}

  // 2. Append to human-readable .log file
  try {
    const textBlock = [
      `[${entry.timestamp}] [${entry.severity}] [${entry.platforma}] ${entry.method ? entry.method + ' ' : ''}${entry.url || ''} ${entry.status ? '(' + entry.status + ')' : ''}`.trim(),
      `  Mesaj: ${entry.mesaj}`,
      entry.user || entry.asociatie_id ? `  Context: user=${entry.user || 'anon'} asociatie_id=${entry.asociatie_id || 1}` : null,
      entry.stack ? `  Stack: ${entry.stack.replace(/\n/g, '\n         ')}` : null,
      entry.context ? `  Payload: ${typeof entry.context === 'string' ? entry.context : JSON.stringify(entry.context)}` : null,
      '--------------------------------------------------------------------------------'
    ]
      .filter(Boolean)
      .join('\n') + '\n';
    fs.appendFileSync(TEXT_LOG_PATH, textBlock, 'utf8');
  } catch (_) {}

  // 3. Insert into SQLite system_error_logs
  let insertedId = null;
  if (db) {
    try {
      const stackWithContext = [
        entry.method && entry.url ? `${entry.method} ${entry.url} -> HTTP ${entry.status || 500}` : '',
        entry.stack || '',
        entry.context ? `Context: ${typeof entry.context === 'string' ? entry.context : JSON.stringify(entry.context)}` : ''
      ]
        .filter(Boolean)
        .join('\n');

      const res = db
        .prepare(`INSERT INTO system_error_logs (platforma, mesaj, stack) VALUES (?, ?, ?)`)
        .run(entry.platforma, entry.mesaj, stackWithContext);
      insertedId = Number(res.lastInsertRowid);
    } catch (_) {}
  }

  return { id: insertedId, entry };
}

/**
 * Express middleware that automatically logs any API response with status >= 400
 * (excluding intentional test probes if X-Skip-Telemetry is set) into the error files & DB.
 */
function apiErrorTelemetryMiddleware(resolveDbFn) {
  ensureLogFiles();
  return function (req, res, next) {
    const startTime = Date.now();
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      if (res.statusCode >= 400 && !req.headers['x-skip-telemetry']) {
        try {
          const db = typeof resolveDbFn === 'function' ? resolveDbFn(req) : null;
          const errMsg =
            (body && (body.error || body.message || body.mesaj)) ||
            `HTTP ${res.statusCode} pe ${req.method} ${req.originalUrl}`;
          recordTelemetryError(db, {
            platforma: res.statusCode >= 500 ? 'backend-500' : 'backend-4xx',
            severity: res.statusCode >= 500 ? 'CRITICAL' : 'WARN',
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            asociatie_id: req.asociatieId || 1,
            user: req.user?.username || 'operator',
            mesaj: errMsg,
            stack: body?.stack || '',
            context: {
              duration_ms: Date.now() - startTime,
              query: req.query,
              body: req.body ? sanitizeBody(req.body) : undefined
            }
          });
        } catch (_) {}
      }
      return originalJson(body);
    };

    next();
  };
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const copy = { ...body };
  if (copy.password) copy.password = '[REDACTED]';
  if (copy.parola) copy.parola = '[REDACTED]';
  return copy;
}

function readJsonlErrors(limit = 200) {
  ensureLogFiles();
  try {
    const content = fs.readFileSync(JSONL_LOG_PATH, 'utf8').trim();
    if (!content) return [];
    const lines = content.split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return { timestamp: new Date().toISOString(), mesaj: line };
        }
      });
  } catch (_) {
    return [];
  }
}

module.exports = {
  LOG_DIR,
  JSONL_LOG_PATH,
  TEXT_LOG_PATH,
  ensureLogFiles,
  recordTelemetryError,
  apiErrorTelemetryMiddleware,
  readJsonlErrors
};
