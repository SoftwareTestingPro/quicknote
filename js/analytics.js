// IP Geolocation & Visitor Analytics Module
// Silent, permission-free tracking using IP lookup (zero browser location prompts)

(function() {
  const STORAGE_KEY = 'qn_visitor_info';

  function getOrCreateVisitorId() {
    let id = localStorage.getItem('qn_visitor_id');
    if (!id) {
      id = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('qn_visitor_id', id);
    }
    return id;
  }

  async function logVisitorGeo() {
    const visitorId = getOrCreateVisitorId();
    const now = new Date().toISOString();

    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) {}

    const firstSeen = (cached && cached.first_seen) ? cached.first_seen : now;

    let geo = {};
    try {
      // Free public IP Geolocation service (CORS enabled, no API key, zero GPS permission prompts)
      const res = await fetch('https://ipwho.is/');
      if (res.ok) {
        const data = await res.json();
        if (data.success !== false) {
          geo = {
            ip: data.ip || 'Unknown',
            country: data.country || 'Unknown',
            state: data.region || 'Unknown',
            city: data.city || 'Unknown',
            latitude: data.latitude !== undefined ? data.latitude : null,
            longitude: data.longitude !== undefined ? data.longitude : null,
            timezone: (data.timezone && data.timezone.id) || Intl.DateTimeFormat().resolvedOptions().timeZone
          };
        }
      }
    } catch (err) {
      // Fallback to secondary free service if ipwho is blocked
      try {
        const res2 = await fetch('https://api.country.is/');
        if (res2.ok) {
          const data2 = await res2.json();
          geo = {
            ip: data2.ip || 'Unknown',
            country: data2.country || 'Unknown',
            state: 'Unknown',
            city: 'Unknown',
            latitude: null,
            longitude: null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
          };
        }
      } catch (err2) {}
    }

    const visitorRecord = {
      visitor_id: visitorId,
      ip: geo.ip || (cached && cached.ip) || 'Unknown',
      country: geo.country || (cached && cached.country) || 'Unknown',
      state: geo.state || (cached && cached.state) || 'Unknown',
      city: geo.city || (cached && cached.city) || 'Unknown',
      latitude: geo.latitude !== undefined ? geo.latitude : (cached ? cached.latitude : null),
      longitude: geo.longitude !== undefined ? geo.longitude : (cached ? cached.longitude : null),
      timezone: geo.timezone || (cached && cached.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone,
      first_seen: firstSeen,
      last_seen: now
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(visitorRecord));

    // Wait until Firebase is initialized to write record to /visitors/{visitor_id}
    const writeToFirebase = () => {
      if (window.firebase && firebase.apps.length) {
        try {
          firebase.database().ref('visitors/' + visitorId).set(visitorRecord);
        } catch (err) {
          console.error('Failed to write visitor record to Firebase:', err);
        }
      } else {
        setTimeout(writeToFirebase, 800);
      }
    };

    writeToFirebase();
  }

  if (document.readyState === 'complete') {
    logVisitorGeo();
  } else {
    window.addEventListener('load', logVisitorGeo);
  }
})();

