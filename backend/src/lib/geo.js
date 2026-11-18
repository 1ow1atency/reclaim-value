// City presets so users don't have to type coordinates. Distances are
// straight-line (haversine), which is fine for a 25-50 km matching radius.
const CITIES = {
  Patiala: { lat: 30.3398, lng: 76.3869 },
  Rajpura: { lat: 30.4840, lng: 76.5940 },
  Chandigarh: { lat: 30.7333, lng: 76.7794 },
  Mohali: { lat: 30.7046, lng: 76.7179 },
  Panchkula: { lat: 30.6942, lng: 76.8606 },
  Ludhiana: { lat: 30.9010, lng: 75.8573 },
  Amritsar: { lat: 31.6340, lng: 74.8723 },
  Ambala: { lat: 30.3782, lng: 76.7767 },
  Delhi: { lat: 28.6139, lng: 77.2090 },
  Gurugram: { lat: 28.4595, lng: 77.0266 },
  Noida: { lat: 28.5355, lng: 77.3910 },
  Jaipur: { lat: 26.9124, lng: 75.7873 },
  Dehradun: { lat: 30.3165, lng: 78.0322 },
  Lucknow: { lat: 26.8467, lng: 80.9462 },
  Mumbai: { lat: 19.0760, lng: 72.8777 },
  Pune: { lat: 18.5204, lng: 73.8567 },
  Ahmedabad: { lat: 23.0225, lng: 72.5714 },
  Bengaluru: { lat: 12.9716, lng: 77.5946 },
  Hyderabad: { lat: 17.3850, lng: 78.4867 },
  Chennai: { lat: 13.0827, lng: 80.2707 },
  Kolkata: { lat: 22.5726, lng: 88.3639 },
};

function cityLocation(city) {
  if (!city) return null;
  const key = Object.keys(CITIES).find((c) => c.toLowerCase() === String(city).trim().toLowerCase());
  return key ? { city: key, ...CITIES[key] } : null;
}

function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

module.exports = { CITIES, cityLocation, haversineKm };
