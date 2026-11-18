// IP Geolocation & Visitor Analytics Module
// Silent, permission-free tracking using IP lookup (zero browser location prompts)

(function() {
  const STORAGE_KEY = 'qn_visitor_info';
  let lastLoggedTime = 0;
  const MIN_LOG_INTERVAL_MS = 15000; // Throttle 15 seconds to avoid double logging on rapid app switching

  function getOrCreateVisitorId() {
    let id = localStorage.getItem('qn_visitor_id');
    if (!id) {
      id = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('qn_visitor_id', id);
    }
    return id;
  }

  async function logVisitorGeo() {
    const nowTime = Date.now();
    if (nowTime - lastLoggedTime < MIN_LOG_INTERVAL_MS) {
      return;
    }
    lastLoggedTime = nowTime;

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
    const nowEpoch = Date.now();

    const visitEntry = {
      city: safeCity,
      latitude: safeLat,
      longitude: safeLon,
      last_seen: lastSeenIST,
      timestamp: nowEpoch
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(visitEntry));

    // Inverted timestamp key so the most recent visit is always sorted at the TOP in Firebase console
    const historyKey = String(9999999999999 - nowEpoch);

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
        // Append history entry directly under /visitors/{visitorId}/history/{historyKey}
        fetch(`${dbUrl}/visitors/${visitorId}/history/${historyKey}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(visitEntry)
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
          const historyRef = db.ref('visitors/' + visitorId + '/history');

          // Save under inverted key (newest at the very top)
          historyRef.child(historyKey).set(visitEntry).then(() => {
            // Clean up history entries older than 7 days
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
        writeViaRest();
      }
    };

    writeToFirebase();
  }

  // Run on page load
  if (document.readyState === 'complete') {
    logVisitorGeo();
  } else {
    window.addEventListener('load', logVisitorGeo);
  }

  // Trigger when returning from background (PWA / Mobile Home Button resume)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      logVisitorGeo();
    }
  });

  window.addEventListener('pageshow', (event) => {
    // If restored from bfcache or reopened
    if (event.persisted) {
      logVisitorGeo();
    }
  });
})();

