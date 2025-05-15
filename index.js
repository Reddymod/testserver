const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const multer = require('multer');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(session({
  secret: process.env.SESSION_SECRET || 'superSecret',
  resave: false,
  saveUninitialized: false,
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));

// Discord OAuth login route
app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    redirect_uri: process.env.REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    prompt: 'consent',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

// OAuth callback
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');

  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.REDIRECT_URI,
    scope: 'identify guilds',
  });

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const tokenData = await tokenRes.json();

    if (tokenData.error) return res.status(400).send(tokenData.error_description);

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    req.session.user = userData;
    req.session.access_token = tokenData.access_token;

    res.redirect('/dashboard.html');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('OAuth callback failed');
  }
});

// Get logged-in user info
app.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.session.user);
});

// Logout
app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Fetch user guilds
app.get('/servers', async (req, res) => {
  if (!req.session.access_token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const guildRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${req.session.access_token}` },
    });
    const guilds = await guildRes.json();
    res.json(guilds);
  } catch (err) {
    console.error('Failed to fetch guilds:', err);
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// Save server settings
app.post('/api/save-settings/:serverId', upload.single('scheduleImage'), (req, res) => {
  const serverId = req.params.serverId;
  const { informalChannels, googleSheetLink, scheduleTime, scheduleChannel } = req.body;
  const filePath = path.join(__dirname, 'serverSettings.json');

  try {
    const data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : {};
    data[serverId] = {
      googleSheetLink,
      scheduleTime,
      scheduleChannel,
      informalChannels: JSON.parse(informalChannels || '[]'),
      scheduleImageUrl: req.file ? req.file.path : null,
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save settings:', error);
    res.status(500).json({ success: false, message: 'Failed to save settings' });
  }
});

// Get server settings
app.get('/api/server-settings/:serverId', (req, res) => {
  const serverId = req.params.serverId;
  const filePath = path.join(__dirname, 'serverSettings.json');

  if (!fs.existsSync(filePath)) return res.json({});

  const data = JSON.parse(fs.readFileSync(filePath));
  res.json(data[serverId] || {});
});

// Dummy server info
app.get('/server-info/:serverId', (req, res) => {
  res.json({
    id: req.params.serverId,
    memberCount: 100,
    channels: {
      categories: 5,
      text: 10,
      voice: 3,
      all: [
        { id: 'channel1', name: 'general' },
        { id: 'channel2', name: 'log' },
      ],
    },
    rolesCount: 5,
  });
});

// PayPal client ID endpoint
app.get('/api/paypal-client-id', (req, res) => {
  res.json({ clientId: process.env.PAYPAL_CLIENT_ID || '' });
});

// PayPal payment success
app.post('/api/payment-success', (req, res) => {
  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });

  const filePath = path.join(__dirname, 'serverSettings.json');
  const data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : {};

  if (!data[guildId]) data[guildId] = {};
  data[guildId].isPremium = true;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
