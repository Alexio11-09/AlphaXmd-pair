const { kv } = require('@vercel/kv');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ---------- PAIR ----------
  if (action === 'pair' && req.method === 'POST') {
    const { number } = req.body;
    if (!number || number.length < 10) {
      return res.status(400).json({ error: 'Invalid number' });
    }
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const sessionId = `session:${cleanNumber}`;

    // Check if already paired
    const existing = await kv.get(sessionId);
    if (existing) {
      return res.json({ session: existing });
    }

    const tempDir = `/tmp/${cleanNumber}`;
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(tempDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      version,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      connectTimeoutMs: 120000,
      defaultQueryTimeoutMs: 120000,
      keepAliveIntervalMs: 10000,
    });

    let code = null;

    setTimeout(async () => {
      try {
        const c = await sock.requestPairingCode(cleanNumber);
        code = c?.match(/.{1,4}/g)?.join('-') || c;
        await kv.set(`code:${cleanNumber}`, code, { ex: 120 });
      } catch (err) {
        await kv.set(`error:${cleanNumber}`, err.message, { ex: 120 });
      }
    }, 3000);

    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        try {
          const credsData = JSON.parse(fs.readFileSync(path.join(tempDir, 'creds.json')));
          const keysData = {};
          const keysDir = path.join(tempDir, 'keys');
          if (fs.existsSync(keysDir)) {
            const files = fs.readdirSync(keysDir);
            for (const file of files) {
              keysData[file] = JSON.parse(fs.readFileSync(path.join(keysDir, file)));
            }
          }
          const sessionPackage = { creds: credsData, keys: keysData };
          const encoded = Buffer.from(JSON.stringify(sessionPackage)).toString('base64');
          await kv.set(sessionId, encoded, { ex: 86400 });
          await kv.set(`status:${cleanNumber}`, 'ready', { ex: 120 });
          sock.end();
        } catch (err) {
          await kv.set(`error:${cleanNumber}`, err.message, { ex: 120 });
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Wait up to 5 sec for code
    let retries = 0;
    while (!code && retries < 10) {
      await new Promise(r => setTimeout(r, 500));
      retries++;
    }

    if (code) {
      res.json({ code });
    } else {
      res.json({ status: 'pending' });
    }
    return;
  }

  // ---------- STATUS ----------
  if (action === 'status') {
    const { number } = req.query;
    if (!number) return res.status(400).json({ error: 'Missing number' });
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const sessionId = `session:${cleanNumber}`;

    const session = await kv.get(sessionId);
    if (session) return res.json({ session });
    const error = await kv.get(`error:${cleanNumber}`);
    if (error) return res.json({ error });
    const code = await kv.get(`code:${cleanNumber}`);
    if (code) return res.json({ code, status: 'waiting' });
    return res.json({ status: 'pending' });
  }

  // ---------- DEFAULT ----------
  res.status(404).json({ error: 'Not found' });
};