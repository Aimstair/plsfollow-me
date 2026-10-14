'use strict';
// Paid bots: a player pays $5 (Stripe Checkout) and a bot plays as their profile for 30 days.
// Orders and active bots are saved to DATA_DIR so restarts and deploys keep them.
// Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET; without them the purchase button explains
// that payments aren't set up yet.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRICE_CENTS = 500;
const DAYS = 30;
const PENDING_TTL_MS = 3 * 60 * 60 * 1000; // unpaid checkouts are forgotten after 3 hours
const STRIPE_API = process.env.STRIPE_API_BASE || 'https://api.stripe.com';

class Paid {
  constructor(dir) {
    this.file = dir ? path.join(dir, 'paid-bots.json') : null;
    this.orders = new Map(); // id -> { id, handle, platform, img(base64), status, createdAt, paidAt, expiresAt }
    this.load();
  }

  load() {
    if (!this.file) return;
    try { for (const o of JSON.parse(fs.readFileSync(this.file, 'utf8'))) this.orders.set(o.id, o); } catch { /* first run */ }
  }
  save() {
    if (!this.file) return;
    const tmp = this.file + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify([...this.orders.values()])); fs.renameSync(tmp, this.file); } catch (e) { console.error('paid save failed:', e.message); }
  }

  get enabled() { return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET); }

  active(now = Date.now()) { return [...this.orders.values()].filter(o => o.status === 'active' && o.expiresAt > now); }
  findActive(handle, platform, now = Date.now()) {
    const h = handle.toLowerCase();
    return this.active(now).find(o => o.handle.toLowerCase() === h && o.platform === platform);
  }

  // Start a checkout: remember the order, ask Stripe for a payment page
  async createCheckout({ handle, platform, img }, origin) {
    this.prune();
    const id = crypto.randomBytes(9).toString('base64url');
    this.orders.set(id, { id, handle, platform, img: img || null, status: 'pending', createdAt: Date.now() });
    this.save();
    const extend = !!this.findActive(handle, platform);
    const form = new URLSearchParams({
      mode: 'payment',
      client_reference_id: id,
      'metadata[order]': id,
      success_url: `${origin}/?bot=success&order=${id}`,
      cancel_url: `${origin}/?bot=cancel`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(PRICE_CENTS),
      'line_items[0][price_data][product_data][name]': `plsfollow.me bot for @${handle} (${DAYS} days${extend ? ', extension' : ''})`,
      'line_items[0][price_data][product_data][description]': `A bot plays as your ${platformName(platform)} profile in the snake for ${DAYS} days. Shown with a ✦ promoted tag.`,
    });
    const res = await fetch(`${STRIPE_API}/v1/checkout/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error((data.error && data.error.message) || `Stripe error ${res.status}`);
    return { id, url: data.url };
  }

  // Stripe calls us when a payment completes. Returns the order that became active (or null).
  handleWebhook(rawBody, sigHeader) {
    if (!verifySignature(rawBody, sigHeader, process.env.STRIPE_WEBHOOK_SECRET)) throw new Error('bad signature');
    const evt = JSON.parse(rawBody);
    if (evt.type !== 'checkout.session.completed') return null;
    const sess = evt.data && evt.data.object;
    if (!sess || sess.payment_status !== 'paid') return null;
    const id = (sess.metadata && sess.metadata.order) || sess.client_reference_id;
    const o = this.orders.get(id);
    if (!o || o.status === 'active' || o.status === 'merged') return null; // unknown or already handled
    const now = Date.now(), existing = this.findActive(o.handle, o.platform, now);
    if (existing) {
      // Same profile bought again: add 30 days to the bot that's already running
      existing.expiresAt += DAYS * 86400000;
      if (o.img) existing.img = o.img;
      o.status = 'merged'; o.paidAt = now; o.into = existing.id;
      this.save();
      return existing;
    }
    o.status = 'active'; o.paidAt = now; o.expiresAt = now + DAYS * 86400000; o.session = sess.id;
    this.save();
    return o;
  }

  status(id) {
    const o = this.orders.get(id); if (!o) return null;
    const target = o.status === 'merged' ? this.orders.get(o.into) : o;
    return { status: o.status === 'merged' ? 'active' : o.status, handle: o.handle, platform: o.platform, expiresAt: target && target.expiresAt };
  }

  remove(id) { const o = this.orders.get(id); if (!o) return null; o.status = 'removed'; this.save(); return o; }

  prune() {
    const now = Date.now(); let changed = false;
    for (const [id, o] of this.orders) if (o.status === 'pending' && now - o.createdAt > PENDING_TTL_MS) { this.orders.delete(id); changed = true; }
    if (changed) this.save();
  }
}

// Stripe-Signature: "t=timestamp,v1=hex[,v1=hex...]"; HMAC-SHA256 of `${t}.${body}`, within 5 minutes
function verifySignature(body, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.create(null), v1 = [];
  for (const kv of String(header).split(',')) { const [k, v] = kv.split('='); if (k === 'v1') v1.push(v); else parts[k] = v; }
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest();
  return v1.some(h => { try { const got = Buffer.from(h, 'hex'); return got.length === want.length && crypto.timingSafeEqual(got, want); } catch { return false; } });
}

const platformName = p => ({ ig: 'Instagram', tt: 'TikTok', x: 'X', th: 'Threads', yt: 'YouTube', tw: 'Twitch' })[p] || 'social';

module.exports = { Paid, PRICE_CENTS, DAYS, verifySignature };
