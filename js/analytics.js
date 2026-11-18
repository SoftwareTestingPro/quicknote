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

  // Reverse geocode lat/lng to exact city/district using free client-side API
  async function reverseGeocodeCoords(lat, lon) {
    try {
      const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      if (res.ok) {
        const data = await res.json();
        const city = data.city || data.locality || data.principalSubdivision || '';
        const state = data.principalSubdivision || '';
        const country = data.countryName || '';
        return { city, state, country };
      }
    } catch (e) {}
    return null;
  }

  // Check if browser already has GPS permission or can silently get position
  function getPreciseLocation() {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        return resolve(null);
      }

      // Check permission state first if supported
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then((status) => {
          if (status.state === 'granted') {
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
              () => resolve(null),
              { timeout: 5000, maximumAge: 300000, enableHighAccuracy: true }
            );
          } else {
            // Not granted yet; do not show disruptive prompt unless user triggered
            resolve(null);
          }
        }).catch(() => resolve(null));
      } else {
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

    const visitorRecord = {
      visitor_id: visitorId,
      ip: ipGeo.ip || (cached && cached.ip) || 'Unknown',
      country: finalCountry,
      state: finalState,
      city: finalCity,
      latitude: finalLat,
      longitude: finalLon,
      timezone: ipGeo.timezone || (cached && cached.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone,
      first_seen: firstSeen,
      last_seen: now
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(visitorRecord));

    // Write record to Firebase Realtime Database under /visitors/{visitor_id}
    const writeToFirebase = () => {
      if (window.firebase && firebase.apps.length) {
        try {
          firebase.database().ref('visitors/' + visitorId).set(visitorRecord);
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

