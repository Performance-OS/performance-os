const https = require('https');

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Parse error: ' + body.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Parse error: ' + body.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const refresh_token = body.refresh_token;

    if (!refresh_token) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing refresh_token' }) };
    }

    // Step 1: Exchange refresh token for access token
    const tokenData = await httpsPost('www.strava.com', '/oauth/token', {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: refresh_token,
      grant_type: 'refresh_token'
    });

    if (!tokenData.access_token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Token exchange failed', detail: tokenData.message || 'unknown' })
      };
    }

    // Step 2: Fetch last 15 activities (filter to 10 runs)
    const activities = await httpsGet(
      'www.strava.com',
      '/api/v3/athlete/activities?per_page=30&page=1',
      tokenData.access_token
    );

    // Ensure activities is an array
    if (!Array.isArray(activities)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ runs: [], new_refresh_token: refresh_token })
      };
    }

    // Filter to runs only, take last 10
    const runs = activities
      .filter(a => a.type === 'Run' || a.sport_type === 'Run')
      .slice(0, 10)
      .map(a => ({
        date: a.start_date_local ? a.start_date_local.split('T')[0] : 'unknown',
        name: a.name || 'Run',
        distance_km: Math.round((a.distance / 1000) * 10) / 10,
        duration_mins: Math.round(a.moving_time / 60),
        avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
        max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
        avg_pace_per_km: a.average_speed && a.average_speed > 0 ? Math.round((1000 / a.average_speed) / 60 * 100) / 100 : null,
        suffer_score: a.suffer_score || null,
        elevation_gain: Math.round(a.total_elevation_gain) || 0
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        runs,
        new_refresh_token: tokenData.refresh_token || refresh_token
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', detail: err.message })
    };
  }
};
