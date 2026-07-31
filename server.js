const express = require('express');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const chalk = require('chalk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- PAIRING ENDPOINT ----------
const sessions = {};

app.post('/pair', async (req, res) => {
  const { number } = req.body;
  if (!number || number.length < 10) {
    return res.status(400).json({ error: 'Invalid number' });
  }

  const cleanNumber = number.replace(/[^0-9]/g, '');
  const sessionId = cleanNumber;

  if (sessions[sessionId]?.sessionData) {
    return res.json({ session: sessions[sessionId].sessionData });
  }

  if (sessions[sessionId]?.code) {
    return res.json({ code: sessions[sessionId].code });
  }

  try {
    const tempDir = path.join(__dirname, 'temp_sessions', sessionId);
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

    sessions[sessionId] = { sock, state, saveCreds, tempDir, codeRequested: false, sessionData: null, code: null };

    setTimeout(async () => {
      if (sessions[sessionId].codeRequested) return;
      sessions[sessionId].codeRequested = true;
      try {
        let code = await sock.requestPairingCode(cleanNumber);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        sessions[sessionId].code = code;
        console.log(chalk.green(`✅ Code for ${cleanNumber}: ${code}`));
      } catch (err) {
        console.log(chalk.red(`❌ Pairing failed:`, err.message));
        sessions[sessionId].error = err.message;
      }
    }, 3000);

    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        console.log(chalk.green(`✅ Device linked for ${cleanNumber}!`));
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

          sessions[sessionId].sessionData = encoded;
          sessions[sessionId].ready = true;
          console.log(chalk.green(`✅ Session string ready for ${cleanNumber}`));
          sock.end();
        } catch (err) {
          console.log(chalk.red(`❌ Error reading session:`, err.message));
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    let retries = 0;
    while (!sessions[sessionId].code && retries < 10) {
      await new Promise(r => setTimeout(r, 500));
      retries++;
    }

    if (sessions[sessionId].code) {
      res.json({ code: sessions[sessionId].code });
    } else {
      res.json({ status: 'pending' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- STATUS ENDPOINT ----------
app.get('/status', (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).json({ error: 'Missing number' });

  const cleanNumber = number.replace(/[^0-9]/g, '');
  const session = sessions[cleanNumber];

  if (!session) {
    return res.status(404).json({ error: 'No session found' });
  }

  if (session.sessionData) {
    return res.json({ session: session.sessionData });
  }

  if (session.error) {
    return res.json({ error: session.error });
  }

  if (session.code) {
    return res.json({ code: session.code, status: 'waiting' });
  }

  return res.json({ status: 'pending' });
});

// ---------- START SERVER ----------
app.listen(PORT, () => {
  console.log(chalk.green(`🌐 Server running on port ${PORT}`));
  console.log(chalk.yellow(`📌 Visit http://localhost:${PORT} to generate session strings`));
});