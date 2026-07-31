const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  const { number } = req.query;
  if (!number) return res.status(400).json({ error: 'Missing number' });

  const cleanNumber = number.replace(/[^0-9]/g, '');
  const sessionId = `session:${cleanNumber}`;

  const session = await kv.get(sessionId);
  if (session) {
    return res.json({ session });
  }

  const error = await kv.get(`error:${cleanNumber}`);
  if (error) {
    return res.json({ error });
  }

  const code = await kv.get(`code:${cleanNumber}`);
  if (code) {
    return res.json({ code, status: 'waiting' });
  }

  return res.json({ status: 'pending' });
};