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
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try{resolve(JSON.parse(body));}catch(e){reject(new Error('Parse: '+body.substring(0,200)));} });
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
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try{resolve(JSON.parse(body));}catch(e){reject(new Error('Parse: '+body.substring(0,200)));} });
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

    // Fetch activities and athlete stats in parallel
    const [activities, stats] = await Promise.all([
      httpsGet('www.strava.com', '/api/v3/athlete/activities?per_page=30&page=1', token),
      httpsGet('www.strava.com', '/api/v3/athletes/' + (tokenData.athlete ? tokenData.athlete.id : 'me') + '/stats', token)
        .catch(() => null)
    ]);

    // Fetch athlete profile to get ID if not in token response
    let athleteStats = stats;
    if (!athleteStats) {
      try {
        const athlete = await httpsGet('www.strava.com', '/api/v3/athlete', token);
        if (athlete && athlete.id) {
          athleteStats = await httpsGet('www.strava.com', '/api/v3/athletes/' + athlete.id + '/stats', token).catch(() => null);
        }
      } catch(e) {}
    }

    // Process activities
    if (!Array.isArray(activities)) {
      return { statusCode: 200, headers, body: JSON.stringify({ runs: [], pbs: {}, predictions: {}, new_refresh_token: refresh_token }) };
    }

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

    // Extract best efforts PBs from recent activities
    const pbs = {};
    const distances = { '400m': 400, '1/2 mile': 805, '1k': 1000, '1 mile': 1609, '2 mile': 3219, '5k': 5000, '10k': 10000, 'half marathon': 21097, 'marathon': 42195 };
    
    activities
      .filter(a => a.type === 'Run' || a.sport_type === 'Run')
      .forEach(a => {
        if (a.best_efforts) {
          a.best_efforts.forEach(effort => {
            const key = effort.name.toLowerCase();
            if (distances[key] !== undefined) {
              if (!pbs[key] || effort.elapsed_time < pbs[key]) {
                pbs[key] = effort.elapsed_time;
              }
            }
          });
        }
      });

    // Extract predictions from athlete stats
    const predictions = {};
    if (athleteStats && athleteStats.recent_run_totals) {
      // Strava provides recent_run_totals but not direct predictions
      // We calculate predicted times from recent pace data
      const recentRuns = activities
        .filter(a => (a.type === 'Run' || a.sport_type === 'Run') && a.average_speed > 0)
        .slice(0, 5);
      
      if (recentRuns.length > 0) {
        const avgSpeed = recentRuns.reduce((s, r) => s + r.average_speed, 0) / recentRuns.length;
        // Apply race effort multipliers
        predictions['5k'] = Math.round(5000 / (avgSpeed * 1.05));
        predictions['10k'] = Math.round(10000 / (avgSpeed * 1.02));
        predictions['half marathon'] = Math.round(21097 / (avgSpeed * 0.98));
        predictions['marathon'] = Math.round(42195 / (avgSpeed * 0.94));
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        runs,
        pbs,
        predictions,
        new_refresh_token: tokenData.refresh_token || refresh_token
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error', detail: err.message }) };
  }
};
