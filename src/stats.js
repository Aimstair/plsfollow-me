'use strict';
// Traffic stats: where visitors come from and what they do, per day. No cookies, no IPs stored.
// The page sends one beacon per visit (/api/hit) with the referrer, utm tags, timezone, language and a
// random visitor id kept in the browser, then small beacons when that visitor joins, spectates, opens
// the share sheet or the "Become a bot" sheet. Saved to DATA_DIR/stats.json; 120 days are kept.
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 120;
const MAX_KEYS = 300;            // per table per day, so junk referrers can't grow the file forever
const MAX_VISITORS = 50000;      // per day
const TZ = process.env.STATS_TZ || 'Asia/Manila';
const EVENTS = ['join', 'spectate', 'share', 'bot'];

const dayOf = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

class Stats {
  constructor(dir) {
    this.file = dir ? path.join(dir, 'stats.json') : null;
    this.days = {}; // day -> { visits, visitors:{vid:flags}, sources, campaigns, invites, countries, devices, langs }
    this.dirty = false;
    try { if (this.file) this.days = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { /* first run */ }
    this.timer = setInterval(() => this.save(), 60000); this.timer.unref();
  }
  save() {
    if (!this.file || !this.dirty) return;
    const keep = Object.keys(this.days).sort().slice(-KEEP_DAYS), out = {};
    for (const d of keep) out[d] = this.days[d];
    this.days = out;
    const tmp = this.file + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, this.file); this.dirty = false; } catch (e) { console.error('stats save failed:', e.message); }
  }
  day() {
    const d = dayOf();
    return (this.days[d] ||= { visits: 0, visitors: {}, sources: {}, campaigns: {}, invites: {}, countries: {}, devices: {}, langs: {} });
  }

  // A page view. b: { vid, ref, utm:{source,medium,campaign}, invite, tz, lang, ret }
  hit(b, ua, ownHost) {
    if (!b || typeof b !== 'object' || isBot(ua)) return;
    const vid = clean(b.vid, 24); if (!vid) return;
    const d = this.day();
    if (b.e) { // a later action by a visitor already counted today
      if (!EVENTS.includes(b.e) || !(vid in d.visitors)) return;
      const bit = 1 << EVENTS.indexOf(b.e);
      if (!(d.visitors[vid] & bit)) { d.visitors[vid] |= bit; this.dirty = true; }
      return;
    }
    d.visits++; this.dirty = true;
    if (vid in d.visitors) return; // same visitor again today: counts as a visit, not a new visitor
    if (Object.keys(d.visitors).length >= MAX_VISITORS) return;
    d.visitors[vid] = b.ret ? 16 : 0; // bit 16 = came back on another day
    const src = sourceOf(clean(b.ref, 300), ua, ownHost);
    bump(d.sources, src);
    const u = b.utm || {};
    const camp = [clean(u.source, 40), clean(u.medium, 40), clean(u.campaign, 60)].filter(Boolean).join(' / ');
    if (camp) bump(d.campaigns, camp);
    const inv = clean(b.invite, 31); if (inv) bump(d.invites, '@' + inv);
    bump(d.countries, countryOf(clean(b.tz, 60)));
    bump(d.devices, deviceOf(ua));
    const lang = clean(b.lang, 12); if (lang) bump(d.langs, lang.split('-')[0].toLowerCase());
  }

  // Totals over the last n days (newest first per-day rows plus merged tables)
  report(n = 30) {
    const days = Object.keys(this.days).sort().slice(-n).reverse();
    const sum = { visits: 0, visitors: 0, returning: 0, sources: {}, campaigns: {}, invites: {}, countries: {}, devices: {}, langs: {} };
    for (const e of EVENTS) sum[e] = 0;
    const rows = days.map(day => {
      const d = this.days[day], v = Object.values(d.visitors);
      const row = { day, visits: d.visits, visitors: v.length, returning: v.filter(f => f & 16).length };
      EVENTS.forEach((e, i) => { row[e] = v.filter(f => f & (1 << i)).length; });
      row.bounced = v.filter(f => !(f & 3)).length; // neither joined nor spectated
      for (const k of ['visits', 'visitors', 'returning', ...EVENTS]) sum[k] += row[k];
      for (const t of ['sources', 'campaigns', 'invites', 'countries', 'devices', 'langs']) for (const [k, c] of Object.entries(d[t])) sum[t][k] = (sum[t][k] || 0) + c;
      return row;
    });
    sum.bounced = rows.reduce((a, r) => a + r.bounced, 0);
    return { tz: TZ, days: n, rows, sum };
  }
}

function bump(table, key) {
  if (!key) return;
  if (!(key in table) && Object.keys(table).length >= MAX_KEYS) key = 'other';
  table[key] = (table[key] || 0) + 1;
}
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isBot = ua => !ua || /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|curl|wget/i.test(ua);

// Where a visit came from: the referring site, or the app whose in-app browser opened the link
// (Instagram, TikTok and friends often send no referrer at all), or "direct"
const APPS = [[/Instagram/, 'instagram (app)'], [/musical_ly|TikTok|BytedanceWebview|trill_/i, 'tiktok (app)'], [/Barcelona/, 'threads (app)'],
  [/FBAN|FBAV|FB_IAB/, 'facebook (app)'], [/Messenger|FBMS/, 'messenger (app)'], [/Twitter/, 'x (app)'], [/Snapchat/, 'snapchat (app)'],
  [/Line\//, 'line (app)'], [/Discord/, 'discord (app)'], [/Telegram/i, 'telegram (app)'], [/WhatsApp/i, 'whatsapp (app)'], [/LinkedInApp/, 'linkedin (app)'],
  [/Pinterest/, 'pinterest (app)'], [/Reddit/i, 'reddit (app)']];
const ALIASES = { 't.co': 'x.com', 'twitter.com': 'x.com', 'lm.facebook.com': 'facebook.com', 'l.facebook.com': 'facebook.com', 'm.facebook.com': 'facebook.com',
  'l.instagram.com': 'instagram.com', 'l.threads.net': 'threads.net', 'out.reddit.com': 'reddit.com', 'old.reddit.com': 'reddit.com', 'com.google.android.gm': 'gmail (app)',
  'com.google.android.googlequicksearchbox': 'google (app)', 'youtu.be': 'youtube.com', 'm.youtube.com': 'youtube.com', 'vm.tiktok.com': 'tiktok.com' };
function sourceOf(ref, ua, ownHost) {
  let host = '';
  try { const u = new URL(ref); host = (u.protocol === 'android-app:' ? u.hostname : u.hostname.replace(/^www\./, '')).toLowerCase(); } catch { /* none */ }
  if (host && host !== ownHost && host !== 'localhost') {
    host = ALIASES[host] || host;
    if (/^(www\.)?google\.[a-z.]+$/.test(host)) host = 'google';
    if (/^(.+\.)?bing\.com$/.test(host)) host = 'bing';
    return host;
  }
  for (const [re, name] of APPS) if (re.test(ua)) return name;
  return 'direct';
}
function deviceOf(ua) {
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'other';
  const mobile = /Mobi|iPhone|Android(?!.*Tablet)/.test(ua) && !/iPad/.test(ua);
  return `${mobile ? 'mobile' : /iPad|Tablet/.test(ua) ? 'tablet' : 'desktop'} · ${os}`;
}

// Rough country from the browser's timezone (no IP lookups). Unknown zones show the zone itself.
const TZ_COUNTRY = {
  'Asia/Manila': 'Philippines', 'Asia/Singapore': 'Singapore', 'Asia/Kuala_Lumpur': 'Malaysia', 'Asia/Kuching': 'Malaysia', 'Asia/Jakarta': 'Indonesia',
  'Asia/Makassar': 'Indonesia', 'Asia/Jayapura': 'Indonesia', 'Asia/Pontianak': 'Indonesia', 'Asia/Bangkok': 'Thailand', 'Asia/Ho_Chi_Minh': 'Vietnam', 'Asia/Saigon': 'Vietnam',
  'Asia/Hanoi': 'Vietnam', 'Asia/Phnom_Penh': 'Cambodia', 'Asia/Vientiane': 'Laos', 'Asia/Yangon': 'Myanmar', 'Asia/Rangoon': 'Myanmar', 'Asia/Brunei': 'Brunei',
  'Asia/Dili': 'Timor-Leste', 'Asia/Hong_Kong': 'Hong Kong', 'Asia/Macau': 'Macau', 'Asia/Taipei': 'Taiwan', 'Asia/Shanghai': 'China', 'Asia/Chongqing': 'China',
  'Asia/Urumqi': 'China', 'Asia/Tokyo': 'Japan', 'Asia/Seoul': 'South Korea', 'Asia/Pyongyang': 'North Korea', 'Asia/Ulaanbaatar': 'Mongolia',
  'Asia/Kolkata': 'India', 'Asia/Calcutta': 'India', 'Asia/Karachi': 'Pakistan', 'Asia/Dhaka': 'Bangladesh', 'Asia/Kathmandu': 'Nepal', 'Asia/Katmandu': 'Nepal',
  'Asia/Colombo': 'Sri Lanka', 'Indian/Maldives': 'Maldives', 'Asia/Thimphu': 'Bhutan', 'Asia/Kabul': 'Afghanistan', 'Asia/Tashkent': 'Uzbekistan', 'Asia/Almaty': 'Kazakhstan',
  'Asia/Bishkek': 'Kyrgyzstan', 'Asia/Dubai': 'UAE', 'Asia/Riyadh': 'Saudi Arabia', 'Asia/Qatar': 'Qatar', 'Asia/Kuwait': 'Kuwait', 'Asia/Bahrain': 'Bahrain',
  'Asia/Muscat': 'Oman', 'Asia/Tehran': 'Iran', 'Asia/Baghdad': 'Iraq', 'Asia/Jerusalem': 'Israel', 'Asia/Tel_Aviv': 'Israel', 'Asia/Amman': 'Jordan', 'Asia/Beirut': 'Lebanon',
  'Asia/Damascus': 'Syria', 'Asia/Baku': 'Azerbaijan', 'Asia/Tbilisi': 'Georgia', 'Asia/Yerevan': 'Armenia', 'Europe/Istanbul': 'Turkey', 'Asia/Istanbul': 'Turkey',
  'Australia/Sydney': 'Australia', 'Australia/Melbourne': 'Australia', 'Australia/Brisbane': 'Australia', 'Australia/Perth': 'Australia', 'Australia/Adelaide': 'Australia',
  'Australia/Hobart': 'Australia', 'Australia/Darwin': 'Australia', 'Pacific/Auckland': 'New Zealand', 'Pacific/Guam': 'Guam', 'Pacific/Port_Moresby': 'Papua New Guinea',
  'Pacific/Fiji': 'Fiji', 'Pacific/Honolulu': 'United States',
  'America/New_York': 'United States', 'America/Chicago': 'United States', 'America/Denver': 'United States', 'America/Phoenix': 'United States',
  'America/Los_Angeles': 'United States', 'America/Anchorage': 'United States', 'America/Detroit': 'United States', 'America/Indiana/Indianapolis': 'United States',
  'America/Boise': 'United States', 'America/Toronto': 'Canada', 'America/Vancouver': 'Canada', 'America/Edmonton': 'Canada', 'America/Winnipeg': 'Canada',
  'America/Halifax': 'Canada', 'America/St_Johns': 'Canada', 'America/Regina': 'Canada', 'America/Mexico_City': 'Mexico', 'America/Monterrey': 'Mexico',
  'America/Tijuana': 'Mexico', 'America/Cancun': 'Mexico', 'America/Guatemala': 'Guatemala', 'America/El_Salvador': 'El Salvador', 'America/Tegucigalpa': 'Honduras',
  'America/Managua': 'Nicaragua', 'America/Costa_Rica': 'Costa Rica', 'America/Panama': 'Panama', 'America/Havana': 'Cuba', 'America/Jamaica': 'Jamaica',
  'America/Santo_Domingo': 'Dominican Republic', 'America/Puerto_Rico': 'Puerto Rico', 'America/Bogota': 'Colombia', 'America/Caracas': 'Venezuela', 'America/Lima': 'Peru',
  'America/Guayaquil': 'Ecuador', 'America/La_Paz': 'Bolivia', 'America/Santiago': 'Chile', 'America/Argentina/Buenos_Aires': 'Argentina', 'America/Buenos_Aires': 'Argentina',
  'America/Montevideo': 'Uruguay', 'America/Asuncion': 'Paraguay', 'America/Sao_Paulo': 'Brazil', 'America/Manaus': 'Brazil', 'America/Fortaleza': 'Brazil',
  'America/Recife': 'Brazil', 'America/Bahia': 'Brazil', 'America/Belem': 'Brazil',
  'Europe/London': 'United Kingdom', 'Europe/Dublin': 'Ireland', 'Europe/Lisbon': 'Portugal', 'Europe/Madrid': 'Spain', 'Atlantic/Canary': 'Spain', 'Europe/Paris': 'France',
  'Europe/Brussels': 'Belgium', 'Europe/Amsterdam': 'Netherlands', 'Europe/Luxembourg': 'Luxembourg', 'Europe/Berlin': 'Germany', 'Europe/Zurich': 'Switzerland',
  'Europe/Vienna': 'Austria', 'Europe/Rome': 'Italy', 'Europe/Malta': 'Malta', 'Europe/Copenhagen': 'Denmark', 'Europe/Oslo': 'Norway', 'Europe/Stockholm': 'Sweden',
  'Europe/Helsinki': 'Finland', 'Europe/Tallinn': 'Estonia', 'Europe/Riga': 'Latvia', 'Europe/Vilnius': 'Lithuania', 'Europe/Warsaw': 'Poland', 'Europe/Prague': 'Czechia',
  'Europe/Bratislava': 'Slovakia', 'Europe/Budapest': 'Hungary', 'Europe/Ljubljana': 'Slovenia', 'Europe/Zagreb': 'Croatia', 'Europe/Belgrade': 'Serbia',
  'Europe/Sarajevo': 'Bosnia', 'Europe/Skopje': 'North Macedonia', 'Europe/Tirane': 'Albania', 'Europe/Athens': 'Greece', 'Europe/Sofia': 'Bulgaria',
  'Europe/Bucharest': 'Romania', 'Europe/Chisinau': 'Moldova', 'Europe/Kiev': 'Ukraine', 'Europe/Kyiv': 'Ukraine', 'Europe/Minsk': 'Belarus', 'Europe/Moscow': 'Russia',
  'Asia/Yekaterinburg': 'Russia', 'Asia/Novosibirsk': 'Russia', 'Asia/Vladivostok': 'Russia', 'Atlantic/Reykjavik': 'Iceland', 'Asia/Nicosia': 'Cyprus', 'Europe/Nicosia': 'Cyprus',
  'Africa/Cairo': 'Egypt', 'Africa/Casablanca': 'Morocco', 'Africa/Algiers': 'Algeria', 'Africa/Tunis': 'Tunisia', 'Africa/Lagos': 'Nigeria', 'Africa/Accra': 'Ghana',
  'Africa/Abidjan': "Côte d'Ivoire", 'Africa/Dakar': 'Senegal', 'Africa/Nairobi': 'Kenya', 'Africa/Addis_Ababa': 'Ethiopia', 'Africa/Kampala': 'Uganda',
  'Africa/Dar_es_Salaam': 'Tanzania', 'Africa/Kigali': 'Rwanda', 'Africa/Johannesburg': 'South Africa', 'Africa/Harare': 'Zimbabwe', 'Africa/Lusaka': 'Zambia',
  'Africa/Maputo': 'Mozambique', 'Africa/Luanda': 'Angola', 'Africa/Kinshasa': 'DR Congo', 'Africa/Khartoum': 'Sudan', 'Indian/Mauritius': 'Mauritius',
};
const countryOf = tz => (!tz ? 'unknown' : TZ_COUNTRY[tz] || (tz.startsWith('Etc/') || tz === 'UTC' ? 'unknown' : tz));

module.exports = { Stats, sourceOf, deviceOf, countryOf };
