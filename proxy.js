const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const app = express();
const PORT = 3000;

const apiKey = 'c2d411e4-10fa-433c-b266-1f336915afce'; // Your v4 API key
let jwtToken = null;

async function authenticate() {
  const res = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: apiKey })
  });
  const data = await res.json();
  jwtToken = data.data.token;
  console.log('Authenticated with TheTVDB');
}

app.use(express.static('.'));

app.get('/api/search', async (req, res) => {
  if (!jwtToken) await authenticate();

  const query = req.query.q;
  const r = await fetch(`https://api4.thetvdb.com/v4/search?query=${encodeURIComponent(query)}&type=series`, {
    headers: { Authorization: `Bearer ${jwtToken}` }
  });
  const data = await r.json();
  res.json(data);
});

app.get('/api/episodes', async (req, res) => {
  if (!jwtToken) await authenticate();

  const seriesId = req.query.id;
  const r = await fetch(`https://api4.thetvdb.com/v4/series/${seriesId}/episodes/default?page=0`, {
    headers: { Authorization: `Bearer ${jwtToken}` }
  });

  const data = await r.json();
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
});
