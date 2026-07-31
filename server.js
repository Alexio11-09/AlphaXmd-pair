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
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Alpha Bot – Session Generator</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #0d1117; color: #c9d1d9; }
        .container { background: #161b22; padding: 30px; border-radius: 10px; border: 1px solid #30363d; }
        h1 { color: #58a6ff; }
        label { display: block; margin-top: 15px; font-weight: bold; }
        input { width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; border-radius: 5px; margin-top: 5px; }
        button { margin-top: 20px; padding: 10px 20px; background: #238636; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; width: 100%; }
        button:hover { background: #2ea043; }
        .result { margin-top: 20px; padding: 15px; background: #0d1117; border-radius: 5px; border: 1px solid #30363d; word-break: break-all; font-family: monospace; font-size: 12px; max-height: 400px; overflow: auto; }
        .code { font-size: 28px; font-weight: bold; color: #58a6ff; padding: 15px; background: #0d1117; border-radius: 5px; text-align: center; }
        .loading { color: #f0883e; }
        .success { color: #3fb950; }
        .error { color: #f85149; }
        .info { color: #8b949e; }
        textarea { width: 100%; height: 120px; background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 5px; padding: 10px; font-family: monospace; font-size: 11px; margin-top: 10px; }
        .btn-copy { background: #1f6feb; margin-top: 5px; width: auto; padding: 8px 20px; }
        .btn-copy:hover { background: #388bfd; }
        .footer { margin-top: 30px; font-size: 12px; color: #8b949e; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Alpha Bot – Session Generator</h1>
        <p>Enter your WhatsApp number to get your session string.</p>
        <form id="pairForm">
          <label>📱 WhatsApp Number (without + or spaces)</label>
          <input type="text" id="number" placeholder="263784969735" required>
          <button type="submit" id="submitBtn">Generate Session</button>
        </form>
        <div id="result" class="result" style="display: none;"></div>
      </div>
      <div class="footer">🔒 Your session string is your WhatsApp login – keep it private.</div>

      <script>
        const form = document.getElementById('pairForm');
        const resultDiv = document.getElementById('result');
        const submitBtn = document.getElementById('submitBtn');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const number = document.getElementById('number').value.trim();
          if (!number || number.length < 10) {
            alert('Please enter a valid number (at least 10 digits)');
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Processing...';
          resultDiv.style.display = 'block';
          resultDiv.innerHTML = '<div class="loading">⏳ Starting pairing...</div>';

          try {
            const pairRes = await fetch('/pair', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ number })
            });
            const pairData = await pairRes.json();

            if (pairData.error) {
              resultDiv.innerHTML = `<div class="error">❌ ${pairData.error}</div>`;
              submitBtn.disabled = false;
              submitBtn.textContent = 'Generate Session';
              return;
            }

            if (pairData.session) {
              showSession(pairData.session);
              submitBtn.disabled = false;
              submitBtn.textContent = 'Generate Session';
              return;
            }

            if (pairData.code) {
              resultDiv.innerHTML = \`
                <div class="code">✅ PAIRING CODE: \${pairData.code}</div>
                <p style="margin-top:15px;">📱 <strong>Instructions:</strong></p>
                <ol style="padding-left:20px;line-height:1.8;">
                  <li>Open <strong>WhatsApp</strong> on your phone</li>
                  <li>Go to <strong>Settings → Linked Devices → Link a Device</strong></li>
                  <li>Enter this code: <strong>\${pairData.code}</strong></li>
                </ol>
                <div class="loading" id="waitMsg">⏳ Waiting for you to link your device... (this may take up to 2 minutes)</div>
              \`;

              let attempts = 0;
              const maxAttempts = 30;
              const poll = setInterval(async () => {
                attempts++;
                try {
                  const statusRes = await fetch(`/status?number=${number}`);
                  const statusData = await statusRes.json();

                  if (statusData.session) {
                    clearInterval(poll);
                    showSession(statusData.session);
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Generate Session';
                    return;
                  }

                  if (statusData.error) {
                    clearInterval(poll);
                    resultDiv.innerHTML = `<div class="error">❌ \${statusData.error}</div>`;
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Generate Session';
                    return;
                  }

                  if (attempts >= maxAttempts) {
                    clearInterval(poll);
                    resultDiv.innerHTML = `<div class="error">❌ Timeout. Device not linked within 2 minutes.</div>`;
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Generate Session';
                    return;
                  }

                  document.getElementById('waitMsg').textContent = `⏳ Waiting... (\${Math.round(attempts*4)}s)`;
                } catch (err) {}
              }, 4000);
            } else {
              resultDiv.innerHTML = `<div class="error">❌ Unexpected response.</div>`;
              submitBtn.disabled = false;
              submitBtn.textContent = 'Generate Session';
            }
          } catch (err) {
            resultDiv.innerHTML = `<div class="error">❌ Network error: \${err.message}</div>`;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Generate Session';
          }
        });

        function showSession(session) {
          resultDiv.innerHTML = \`
            <div class="success">✅ Session generated successfully!</div>
            <p class="info">Copy this string and save it to a file named <code>session_data</code> in your bot folder.</p>
            <textarea id="sessionText" readonly>\${session}</textarea>
            <button class="btn-copy" onclick="copySession()">📋 Copy to Clipboard</button>
            <p class="info" style="margin-top:10px;">📌 Your bot will read this file and connect instantly – no pairing required.</p>
          \`;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Generate Session';
        }

        function copySession() {
          const textarea = document.getElementById('sessionText');
          if (!textarea) return;
          navigator.clipboard.writeText(textarea.value).then(() => {
            alert('✅ Session string copied to clipboard!');
          }).catch(() => {
            textarea.select();
            document.execCommand('copy');
            alert('✅ Session string copied!');
          });
        }
      </script>
    </body>
    </html>
  `);
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

  // If already paired, return session
  if (sessions[sessionId]?.sessionData) {
    return res.json({ session: sessions[sessionId].sessionData });
  }

  // If pairing in progress, return existing code
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

    // Request pairing code after 3 seconds
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

    // Listen for connection open (device linked)
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

    // Wait up to 5 seconds for code
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