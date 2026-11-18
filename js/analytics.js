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
    const currentDate = new Date();
    const isoNow = currentDate.toISOString();

    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) {}

    const firstSeen = (cached && cached.first_seen) ? cached.first_seen : isoNow;

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

    // Format last seen timestamp in Indian Standard Time (IST)
    const lastSeenIST = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(currentDate);

    const safeCity = geo.city || (cached && cached.city) || 'Unknown';
    const safeLat = (geo.latitude !== undefined && geo.latitude !== null) ? geo.latitude : ((cached && cached.latitude) || null);
    const safeLon = (geo.longitude !== undefined && geo.longitude !== null) ? geo.longitude : ((cached && cached.longitude) || null);

    const visitorRecord = {
      visitor_id: visitorId,
      city: safeCity,
      latitude: safeLat,
      longitude: safeLon,
      last_seen: lastSeenIST
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(visitorRecord));

    // Helper to get or initialize Firebase database instance directly
    function getDb() {
      if (window.firebase && firebase.apps && firebase.apps.length) {
        return firebase.database();
      }
      if (window.firebase && window.APP_CONFIG && window.APP_CONFIG.firebase) {
        try {
          if (!firebase.apps.length) {
            firebase.initializeApp(window.APP_CONFIG.firebase);
          }
          return firebase.database();
        } catch (e) {
          if (firebase.apps && firebase.apps.length) return firebase.database();
        }
      }
      return null;
    }

    // Direct REST fallback in case Firebase SDK is blocked by browser adblocker/client rules
    function writeViaRest() {
      if (window.APP_CONFIG && window.APP_CONFIG.firebase && window.APP_CONFIG.firebase.databaseURL) {
        const dbUrl = window.APP_CONFIG.firebase.databaseURL;
        // 1. Update overview
        fetch(`${dbUrl}/visitors/${visitorId}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(visitorRecord)
        }).then(() => {
          // 2. Append history
          fetch(`${dbUrl}/visitors/${visitorId}/history.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              city: safeCity,
              latitude: safeLat,
              longitude: safeLon,
              last_seen: lastSeenIST,
              timestamp: Date.now()
            })
          }).catch(() => {});
        }).catch((err) => {
          console.error('[Analytics] REST write failed:', err);
        });
      }
    }

    // Write to Firebase Realtime Database
    let attempts = 0;
    const writeToFirebase = () => {
      const db = getDb();
      if (db) {
        try {
          const visitorRef = db.ref('visitors/' + visitorId);

          // 1. Update top-level visitor overview
          visitorRef.update(visitorRecord).then(() => {
            // 2. Append this visit to 7-day history
            const historyRef = visitorRef.child('history');
            historyRef.push({
              city: safeCity,
              latitude: safeLat,
              longitude: safeLon,
              last_seen: lastSeenIST,
              timestamp: Date.now()
            });

            // 3. Remove history entries older than 7 days
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            historyRef.orderByChild('timestamp').endAt(sevenDaysAgo).once('value', (snap) => {
              if (snap && snap.exists()) {
                const updates = {};
                snap.forEach((child) => {
                  updates[child.key] = null;
                });
                historyRef.update(updates).catch(() => {});
              }
            }).catch(() => {});
          }).catch((err) => {
            console.error('[Analytics] Firebase SDK write failed, attempting REST fallback:', err);
            writeViaRest();
          });
        } catch (err) {
          console.error('[Analytics] Firebase SDK exception, attempting REST fallback:', err);
          writeViaRest();
        }
      } else if (attempts < 10) {
        attempts++;
        setTimeout(writeToFirebase, 600);
      } else {
        // SDK not loaded in 6s (e.g. adblocker blocked firebase script) -> use REST API directly
        writeViaRest();
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

