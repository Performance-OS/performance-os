const https = require('https');
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname, path, method: 'POST',
      headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}
    };
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try{resolve(JSON.parse(b));}catch(e){reject(new Error('Parse: '+b.substring(0,200)));} });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname, path, method: 'GET',
      headers: {Authorization: 'Bearer ' + token}
    };
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try{resolve(JSON.parse(b));}catch(e){reject(new Error('Parse: '+b.substring(0,200)));} });
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    const refresh_token = body.refresh_token;
    if (!refresh_token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing refresh_token' }) };

    // Exchange refresh token
    const tokenData = await httpsPost('www.strava.com', '/oauth/token', {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token,
      grant_type: 'refresh_token'
    });

    if (!tokenData.access_token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token exchange failed', detail: tokenData.message || 'unknown' }) };
    }

    const token = tokenData.access_token;

    // Fetch activities (30 to get 10 runs past gym sessions)
    const activities = await httpsGet('www.strava.com', '/api/v3/athlete/activities?per_page=30&page=1', token);

    if (!Array.isArray(activities)) {
      return { statusCode: 200, headers, body: JSON.stringify({ runs: [], pbs: {}, new_refresh_token: refresh_token }) };
    }

    // Filter to runs, take last 10
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

    // Extract all-time PBs from best_efforts across all fetched runs
    // Also fetch more activities specifically to find best efforts for all distances
    const pbActivities = await httpsGet('www.strava.com', '/api/v3/athlete/activities?per_page=100&page=1', token);
    const allRuns = Array.isArray(pbActivities) ? pbActivities.filter(a => a.type === 'Run' || a.sport_type === 'Run') : activities.filter(a => a.type === 'Run' || a.sport_type === 'Run');

    const targetDistances = ['400m','1k','1 mile','2 mile','5k','10k','half marathon','marathon'];
    const pbs = {};

    allRuns.forEach(a => {
      if (a.best_efforts && Array.isArray(a.best_efforts)) {
        a.best_efforts.forEach(effort => {
          const key = effort.name.toLowerCase();
          if (targetDistances.includes(key)) {
            if (!pbs[key] || effort.elapsed_time < pbs[key]) {
              pbs[key] = effort.elapsed_time;
            }
          }
        });
      }
    });

    // Get athlete stats for additional PB data
    try {
      const athlete = await httpsGet('www.strava.com', '/api/v3/athlete', token);
      if (athlete && athlete.id) {
        const stats = await httpsGet('www.strava.com', `/api/v3/athletes/${athlete.id}/stats`, token);
        // Stats has recent/all-time totals but not individual PBs — already covered by best_efforts above
      }
    } catch(e) {}

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        runs,
        pbs,
        new_refresh_token: tokenData.refresh_token || refresh_token
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error', detail: err.message }) };
  }
};
