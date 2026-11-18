// IP & Precise Geolocation & Visitor Analytics Module
// Prioritizes precise city detection with silent fallback to IP geolocation

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

  // Reverse geocode lat/lng to exact city/district using multiple free APIs
  async function reverseGeocodeCoords(lat, lon) {
    // 1. Try BigDataCloud
    try {
      const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      if (res.ok) {
        const data = await res.json();
        let city = data.city || data.locality || '';
        
        // In India and many countries, districts (e.g. Unnao) are in localityInfo.administrative
        if (!city && data.localityInfo && Array.isArray(data.localityInfo.administrative)) {
          // Look for district or county level (adminLevel 6 or 5)
          const adminItem = data.localityInfo.administrative.find(a => 
            (a.adminLevel >= 5 && a.adminLevel <= 8) || 
            (a.description && (a.description.includes('district') || a.description.includes('city') || a.description.includes('county')))
          );
          if (adminItem && adminItem.name) {
            city = adminItem.name.replace(/\s+District$/i, '');
          }
        }

        const state = data.principalSubdivision || '';
        const country = data.countryName || '';
        if (city) {
          return { city, state, country };
        }
      }
    } catch (e) {}

    // 2. Try OpenStreetMap Nominatim
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.address) {
          const addr = data.address;
          const city = addr.city || addr.town || addr.district || addr.county || addr.state_district || addr.suburb || '';
          const state = addr.state || '';
          const country = addr.country || '';
          if (city) {
            return { city, state, country };
          }
        }
      }
    } catch (e) {}

    return null;
  }

  // Strictly check if location permission has ALREADY been granted.
  // NEVER triggers a permission dialog or prompt to the user.
  function getPreciseLocation() {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        return resolve(null);
      }

      // Check permission state first
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then((status) => {
          if (status.state === 'granted') {
            // Already granted: silently get position (use cached if available)
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
              () => resolve(null),
              { timeout: 5000, maximumAge: 600000, enableHighAccuracy: false }
            );
          } else {
            // State is 'prompt' or 'denied' - DO NOT call getCurrentPosition to prevent prompt
            resolve(null);
          }
        }).catch(() => resolve(null));
      } else {
        // If Permissions API not supported, do not risk prompting
        resolve(null);
      }
    });
  }

  // Fetch IP-based location from best available providers
  async function fetchIPLocation() {
    let geo = {};

    // Provider 1: ipwho.is
    try {
      const res = await fetch('https://ipwho.is/');
      if (res.ok) {
        const data = await res.json();
        if (data.success !== false) {
          return {
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
    } catch (e) {}

    // Provider 2: ipapi.co
    try {
      const res = await fetch('https://ipapi.co/json/');
      if (res.ok) {
        const data = await res.json();
        return {
          ip: data.ip || 'Unknown',
          country: data.country_name || 'Unknown',
          state: data.region || 'Unknown',
          city: data.city || 'Unknown',
          latitude: data.latitude || null,
          longitude: data.longitude || null,
          timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
        };
      }
    } catch (e) {}

    // Provider 3: country.is fallback
    try {
      const res = await fetch('https://api.country.is/');
      if (res.ok) {
        const data = await res.json();
        return {
          ip: data.ip || 'Unknown',
          country: data.country || 'Unknown',
          state: 'Unknown',
          city: 'Unknown',
          latitude: null,
          longitude: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
      }
    } catch (e) {}

    return geo;
  }

  async function logVisitorGeo() {
    const visitorId = getOrCreateVisitorId();
    const now = new Date().toISOString();

    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) {}

    const firstSeen = (cached && cached.first_seen) ? cached.first_seen : now;

    // 1. First get IP location for baseline and public IP address
    const ipGeo = await fetchIPLocation();

    let finalLat = ipGeo.latitude !== undefined ? ipGeo.latitude : (cached ? cached.latitude : null);
    let finalLon = ipGeo.longitude !== undefined ? ipGeo.longitude : (cached ? cached.longitude : null);
    let finalCity = ipGeo.city && ipGeo.city !== 'Unknown' ? ipGeo.city : (cached ? cached.city : 'Unknown');
    let finalState = ipGeo.state && ipGeo.state !== 'Unknown' ? ipGeo.state : (cached ? cached.state : 'Unknown');
    let finalCountry = ipGeo.country && ipGeo.country !== 'Unknown' ? ipGeo.country : (cached ? cached.country : 'Unknown');

    // 2. Check if device has precise GPS location available
    const preciseCoords = await getPreciseLocation();
    if (preciseCoords && preciseCoords.lat && preciseCoords.lon) {
      finalLat = preciseCoords.lat;
      finalLon = preciseCoords.lon;
      const reverse = await reverseGeocodeCoords(preciseCoords.lat, preciseCoords.lon);
      if (reverse) {
        if (reverse.city) finalCity = reverse.city;
        if (reverse.state) finalState = reverse.state;
        if (reverse.country) finalCountry = reverse.country;
      }
    }

    // Format last seen timestamp in Indian Standard Time (IST)
    const now = new Date();
    const lastSeenIST = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(now);

    const visitEntry = {
      city: finalCity,
      latitude: finalLat,
      longitude: finalLon,
      last_seen: lastSeenIST,
      timestamp: Date.now()
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(visitEntry));

    // Write record to Firebase Realtime Database
    // 1. Updates current status at /visitors/{visitor_id}
    // 2. Appends to /visitors/{visitor_id}/history and prunes entries older than 7 days
    const writeToFirebase = () => {
      if (window.firebase && firebase.apps.length) {
        try {
          const visitorRef = firebase.database().ref('visitors/' + visitorId);
          
          // Update current overview
          visitorRef.update({
            city: finalCity,
            latitude: finalLat,
            longitude: finalLon,
            last_seen: lastSeenIST
          });

          // Append to 7-day visit history
          const historyRef = visitorRef.child('history');
          historyRef.push(visitEntry);

          // Clean up history older than 7 days (7 * 24 * 60 * 60 * 1000 ms)
          const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
          historyRef.orderByChild('timestamp').endAt(sevenDaysAgo).once('value', (snap) => {
            if (snap.exists()) {
              const updates = {};
              snap.forEach((child) => {
                updates[child.key] = null;
              });
              historyRef.update(updates);
            }
          });
        } catch (err) {
          console.error('Failed to write visitor record to Firebase:', err);
        }
      } else {
        setTimeout(writeToFirebase, 600);
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
})();

