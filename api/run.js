const nodemailer = require('nodemailer');
const E = process.env;
const CITIES = {US:['Austin','Dallas','Phoenix','Tampa','Atlanta','Denver','Charlotte'],UK:['Manchester','Leeds','Glasgow','Liverpool','Sheffield','Nottingham'],AU:['Sydney','Melbourne','Brisbane','Perth','Adelaide']};
const NICHES = {hvac:'["craft"="hvac"]',roofing:'["craft"="roofer"]',landscaping:'["craft"="gardener"]',dentist:'["amenity"="dentist"]',gym:'["leisure"="fitness_centre"]',lawyer:'["office"="lawyer"]',realestate:'["office"="estate_agent"]',salon:'["shop"="beauty"]'};
const MIRRORS = ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter'];
const CHAT = ['tawk.to','intercom','drift.com','livechat','tidio','crisp.chat','hubspot','zendesk','leadconnector','podium','birdeye'];
const BOOK = ['calendly','acuity','book online','book now','book an appointment','schedule online','booksy','jobber','housecallpro','servicetitan','setmore','simplybook','zocdoc'];
const GHL = ['gohighlevel','leadconnectorhq','msgsndr','highlevel'];
const MAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const BAD = /sentry|wixpress|example\.|domain\.|\.png|\.jpg|\.webp|\.svg|godaddy|schema\.org/i;
const get = async (u, ms = 8000) => { try { const r = await fetch(u, {headers:{'User-Agent':'Mozilla/5.0 (compatible; LeadHunter/1.0)'},signal:AbortSignal.timeout(ms),redirect:'follow'}); return r.ok ? await r.text() : ''; } catch { return ''; } };

async function leads({country, niche, cityIdx}) {
  const city = (CITIES[country] || [])[cityIdx];
  if (!city || !NICHES[niche]) return {leads:[], more:false, city:''};
  const q = `[out:json][timeout:20];area["name"="${city}"]["boundary"="administrative"]->.a;nwr(area.a)${NICHES[niche]}["website"];out tags 40;`;
  let els = null;
  for (const m of MIRRORS) {
    try {
      const r = await fetch(m, {method:'POST',body:new URLSearchParams({data:q}),headers:{'User-Agent':'GHLLeadHunter/1.0 (freelance research)'},signal:AbortSignal.timeout(17000)});
      const t = await r.text();
      if (r.ok && t.trim().startsWith('{')) { els = JSON.parse(t).elements; break; }
    } catch {}
  }
  if (!els) throw new Error(`${city}: free map server busy, agla shehar try ho raha hai`);
  const out = [];
  for (const el of els) {
    const t = el.tags || {};
    let site = t.website || t['contact:website'];
    if (!site || !t.name) continue;
    if (!/^http/.test(site)) site = 'http://' + site;
    out.push({business:t.name, city, country, niche, website:site, phone:t.phone || '', osm_email:t.email || t['contact:email'] || ''});
  }
  return {leads:out, more:cityIdx + 1 < CITIES[country].length, city};
}

async function audit({lead:l}) {
  const html = await get(l.website);
  if (!html) return {lead:null};
  const low = html.toLowerCase();
  let blob = html;
  const m = html.match(/href=["']([^"']*contact[^"']*)["']/i);
  if (m) { try { blob += await get(new URL(m[1], l.website).href, 6000); } catch {} }
  if (GHL.some(g => blob.toLowerCase().includes(g))) return {lead:null};
  const email = l.osm_email || (blob.match(MAIL) || []).filter(e => !BAD.test(e))[0] || '';
  let s = 0; const p = [];
  if (!CHAT.some(c => low.includes(c))) { s += 3; p.push('no chatbot / instant reply on website'); }
  if (!BOOK.some(b => low.includes(b))) { s += 3; p.push('no online booking'); }
  if (!/<form/i.test(html)) { s += 1; p.push('no lead capture form'); }
  if (!/fbq\(|gtag\(|googletagmanager|facebook\.net/.test(low)) { s += 1; p.push('no tracking/retargeting pixel'); }
  if (!low.includes('name="viewport"')) { s += 1; p.push('not mobile friendly'); }
  if (/^(info|contact|hello|office|admin)@/i.test(email)) { s += 1; p.push('generic inbox (slow lead follow-up likely)'); }
  return {lead:{...l, email, score:Math.min(s, 10), pains:p.join('; ')}};
}

async function email({lead:l}) {
  const me = E.SENDER_NAME || 'Muhammad';
  const pain = (l.pains || '').split(';')[0] || 'manual follow-up';
  const fb = {
    subject:`Quick idea for ${l.business}`,
    d1:`Hi,\n\nI had a look at ${l.website} and noticed ${pain}. Many ${l.niche} businesses lose enquiries this way, because leads go cold within minutes.\n\nI set up automated systems (instant text-back, online booking, follow-up) in GoHighLevel. Happy to send a short 2-minute video showing how it would work for ${l.business}. Worth a look?\n\nBest,\n${me}`,
    d3:`Hi, just following up on my note about ${l.business}. Would a short video be useful?\n\n${me}`,
    d7:`Hi, one more idea: an automatic missed-call text-back usually recovers several enquiries per month. Want me to show you?\n\n${me}`,
    d14:`Hi, I'll close this thread now. If automating enquiries becomes a priority, I'm one reply away.\n\n${me}`};
  if (!E.GEMINI_API_KEY) return {...fb, ai:false, note:'GEMINI_API_KEY set nahi'};
  const prompt = `Write a cold email sequence for a GoHighLevel (CRM/automation) freelancer named ${me}. Target: ${l.business} (${l.niche}, ${l.city}, ${l.country}). Website: ${l.website}. Problems found on their site: ${l.pains}. Rules: formal but friendly English, plain text, no hype, no emojis, no fake claims or stats. Email 1 (d1): max 90 words, mention ONE specific problem found on their site, offer a short free video, soft CTA question. Follow-ups d3, d7, d14: max 45 words each, new angle each, last is a polite close. ${l.country !== 'US' ? 'Use British spelling.' : ''} Return JSON only: {"subject":"","d1":"","d3":"","d7":"","d14":""}. Sign each as ${me}.`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${E.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent`, {method:'POST',headers:{'content-type':'application/json','x-goog-api-key':E.GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json'}}),signal:AbortSignal.timeout(40000)});
    const j = await r.json();
    const t = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!t) throw new Error(j.error?.message || 'empty reply');
    return {...fb, ...JSON.parse(t), ai:true};
  } catch (e) { return {...fb, ai:false, note:String(e.message).slice(0, 160)}; }
}

async function send({to, subject, text}) {
  if (!E.GMAIL_USER || !E.GMAIL_APP_PASSWORD) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD set nahi');
  const t = nodemailer.createTransport({service:'gmail', auth:{user:E.GMAIL_USER, pass:E.GMAIL_APP_PASSWORD}});
  await t.sendMail({from:`${E.SENDER_NAME || ''} <${E.GMAIL_USER}>`, to, subject, text:`${text}\n\n--\n${E.SENDER_ADDRESS || ''}\nNot interested? Reply "unsubscribe" and I won't contact you again.`});
  return {ok:true};
}

const ACTIONS = {leads, audit, email, send};
module.exports = async (req, res) => {
  const b = req.body || {};
  if (!E.APP_PASSWORD || b.pw !== E.APP_PASSWORD) return res.status(401).json({error:'Password galat hai (ya APP_PASSWORD set nahi)'});
  try { res.json(await ACTIONS[b.action](b)); }
  catch (e) { res.status(500).json({error:String(e.message || e)}); }
};
