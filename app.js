// ═══════════════════════════════════════════════════════════════════════════
// CERT TRACKER v2 — APP LOGIC
// ═══════════════════════════════════════════════════════════════════════════

// ───── STATE ──────────────────────────────────────────────────────────────
const SK = {
  passes:   'ct2-passes',
  exams:    'ct2-exams',
  cpe:      'ct2-cpe',
  notify:   'ct2-notify',
  openPh:   'ct2-open-phase',
  notes:    'ct2-notes',
  gates:    'ct2-gates',
  study:    'ct2-study',
  filter:   'ct2-filter',
  skipped:  'ct2-skipped',
};

const state = {
  passes: {},        // {certId: 'YYYY-MM-DD'}
  skipped: {},       // {certId: 'YYYY-MM-DD'} — dropped/abandoned/deferred
  exams: {},         // {certId: 'YYYY-MM-DD'}
  activities: [],    // [{id, certId, date, desc, credits}]
  notes: {},         // {certId: {text, link, imageData}}
  gates: {},         // {gateId: true}
  studyLog: [],      // [{id, date, hours, type, certId?, desc}]
  openPhase: 1,
  openCerts: {},     // {certId: true}
  currentTab: 'dashboard',
  filter: 'all',     // all | core | gateway | active | upcoming
  showCPEForm: false,
  cpeFilter: '',
  cpeForm: { certId: '', date: '', desc: '', credits: '' },
  showStudyForm: false,
  studyForm: { date: '', hours: '', type: 'study', certId: '', desc: '' },
};

function loadState() {
  try { state.passes     = JSON.parse(localStorage.getItem(SK.passes)  || '{}'); } catch {}
  try { state.exams      = JSON.parse(localStorage.getItem(SK.exams)   || '{}'); } catch {}
  try { state.activities = JSON.parse(localStorage.getItem(SK.cpe)     || '[]'); } catch {}
  try { state.notes      = JSON.parse(localStorage.getItem(SK.notes)   || '{}'); } catch {}
  try { state.gates      = JSON.parse(localStorage.getItem(SK.gates)   || '{}'); } catch {}
  try { state.studyLog   = JSON.parse(localStorage.getItem(SK.study)   || '[]'); } catch {}
  try { state.openPhase  = parseInt(localStorage.getItem(SK.openPh)    || '1'); } catch {}
  try { state.filter     = localStorage.getItem(SK.filter) || 'all'; } catch {}
  try { state.skipped    = JSON.parse(localStorage.getItem(SK.skipped) || '{}'); } catch {}

  // Migration: drop references to certs no longer in the data
  const validIds = new Set(CERTS.map(c => c.id));
  Object.keys(state.passes).forEach(id => { if (!validIds.has(id)) delete state.passes[id]; });
  Object.keys(state.exams).forEach(id =>  { if (!validIds.has(id)) delete state.exams[id]; });
  Object.keys(state.skipped).forEach(id => { if (!validIds.has(id)) delete state.skipped[id]; });
}
const save = {
  passes: () => localStorage.setItem(SK.passes, JSON.stringify(state.passes)),
  exams:  () => localStorage.setItem(SK.exams,  JSON.stringify(state.exams)),
  cpe:    () => localStorage.setItem(SK.cpe,    JSON.stringify(state.activities)),
  notes:  () => localStorage.setItem(SK.notes,  JSON.stringify(state.notes)),
  gates:  () => localStorage.setItem(SK.gates,  JSON.stringify(state.gates)),
  study:  () => localStorage.setItem(SK.study,  JSON.stringify(state.studyLog)),
  openPh: () => localStorage.setItem(SK.openPh, state.openPhase),
  filter: () => localStorage.setItem(SK.filter, state.filter),
  skipped:() => localStorage.setItem(SK.skipped, JSON.stringify(state.skipped)),
};

// ───── HELPERS ────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().split('T')[0]; }
function formatPassDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
function addMonths(dateStr, months) { const d = new Date(dateStr); d.setMonth(d.getMonth() + months); return d; }
function daysUntil(date) { return Math.floor((new Date(date) - new Date()) / 86400000); }
function fmt(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function escape(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
state.cpeForm.date = today();
state.studyForm.date = today();

function expiryInfo(cert, passDate) {
  if (!passDate) return { status: 'PENDING', days: null, expiry: null };
  if (cert.validity === null) return { status: 'NEVER', days: null, expiry: null };
  if (!cert.validity) return { status: 'NOEXP', days: null, expiry: null };
  const expiry = addMonths(passDate, cert.validity);
  const days = daysUntil(expiry);
  const status = days < 0 ? 'EXPIRED' : days <= 60 ? 'URGENT' : days <= 180 ? 'WARN' : 'OK';
  return { status, days, expiry };
}
function certCpeEarned(certId) {
  return state.activities.filter(a => a.certId === certId).reduce((s, a) => s + (a.credits || 0), 0);
}
function statusBadgeHTML(status, days) {
  if (status === 'PENDING') return `<span class="status-badge status-pending">Not passed</span>`;
  if (status === 'NEVER')   return `<span class="status-badge status-never">Never expires</span>`;
  if (status === 'NOEXP')   return `<span class="status-badge status-noexp">No expiry</span>`;
  if (status === 'EXPIRED') return `<span class="status-badge status-expired">Expired ${Math.abs(days)}d ago</span>`;
  if (status === 'URGENT')  return `<span class="status-badge status-urgent">⚠ ${days}d left</span>`;
  if (status === 'WARN')    return `<span class="status-badge status-warn">${days}d left</span>`;
  return `<span class="status-badge status-ok">${days}d left</span>`;
}
function progressBarHTML(pct, color = 'var(--blue)', height = '6px') {
  return `<div class="progress" style="height:${height}"><div class="progress-bar" style="width:${pct}%;background:${color}"></div></div>`;
}
function examBadgeHTML(certId) {
  const ed = state.exams[certId];
  if (!ed) return `<span class="status-badge status-pending">Not booked</span>`;
  const d = daysUntil(new Date(ed));
  if (d < 0)   return `<span class="status-badge status-expired">Was ${Math.abs(d)}d ago</span>`;
  if (d === 0) return `<span class="status-badge status-urgent">⚠ Today</span>`;
  if (d <= 7)  return `<span class="status-badge status-urgent">⚠ ${d}d away</span>`;
  if (d <= 30) return `<span class="status-badge status-warn">${d}d away</span>`;
  return `<span class="status-badge status-ok">${d}d away</span>`;
}

// ───── PRIORITY SCORING ───────────────────────────────────────────────────
// P1 = must-do gateway · P2 = core spine · P3 = triggered conditional / employer-funded
// P4 = situational conditional · P5 = optional / drop-first
function priorityScore(cert) {
  if (cert.gateway) return 5;                                    // P1
  if (cert.track === 'CORE') return 4;                           // P2
  if (cert.track === 'ROLE-DRIVEN' && cert.employer) return 3;   // P3
  if (cert.track === 'CONDITIONAL' && cert.roi >= 8) return 3;   // P3
  if (cert.track === 'CONDITIONAL' && cert.roi >= 6) return 2;   // P4
  return 1;                                                      // P5
}
function priorityTag(n) { return ({ 5:'P1', 4:'P2', 3:'P3', 2:'P4', 1:'P5' })[n] || 'P5'; }
function priorityLabel(n) { return ({ 5:'MUST', 4:'CORE', 3:'IF TRIGGERED', 2:'SITUATIONAL', 1:'DROP FIRST' })[n] || 'DROP'; }

// Generate 2-3 specific actions for the next-up cert.
// Heuristics combine cert id, exam booking status, deps state, and study log activity.
function weeklyActions(cert) {
  if (!cert) return [];
  const actions = [];
  const id = cert.id;
  const code = cert.code || '';
  const examBooked = !!state.exams[id];
  const examDate = examBooked ? new Date(state.exams[id]) : null;
  const daysToExam = examDate ? Math.floor((examDate - new Date()) / 86400000) : null;
  const depsMet = !cert.deps || cert.deps.every(d => state.passes[d]);

  // Deps not met → first action is unblocking
  if (!depsMet) {
    const blocker = cert.deps.find(d => !state.passes[d]);
    const blockerCert = CERTS.find(c => c.id === blocker);
    if (blockerCert) {
      actions.push(`⚠ Pass ${blockerCert.code || blockerCert.name} first — it's the dependency unlocking ${code || cert.name}.`);
    }
  }

  // Exam already booked, urgent
  if (examBooked && daysToExam !== null && daysToExam >= 0 && daysToExam <= 14) {
    actions.push(`📝 Exam in ${daysToExam} day${daysToExam === 1 ? '' : 's'} — switch from study mode to practice exams. 80%+ on Boson/Dion practice before exam day.`);
  } else if (!examBooked && depsMet) {
    actions.push(`📅 Book the exam window. Picking a date forces commitment and reveals pace gaps early.`);
  }

  // Cert-specific study suggestions
  const studyMap = {
    'security-plus':  ['Watch Professor Messer SY0-701 free YouTube series (~12 hrs total — break into 30-min blocks).', 'Drill subnetting and port memorisation daily — 15 min via subnettingpractice.com.'],
    'cysa-plus':      ['Build one KQL query a day in a free Sentinel tenant — start with sign-in anomalies.', 'Review Jason Dion CySA+ Udemy practice exam questions in 30-min daily blocks.'],
    'secai-plus':     ['Read OWASP LLM Top 10 (~2 hrs total). It is 80% of the exam content.', 'Run one PyRIT probe against your Azure OpenAI sandbox this week.'],
    'az-104':         ['Spin up a free Azure tenant and follow Scott Duffy AZ-104 Udemy Module 1.', 'Build one VNet + subnet + NSG combo from scratch (no GUI — use CLI or Bicep).'],
    'az-400':         ['Set up an Azure DevOps pipeline that deploys a Bicep template via OIDC — 2 hours, covers ~30% of the exam.', 'Watch John Savill AZ-400 Study Cram (~4 hrs, free).'],
    'sc-300':         ['Configure a Conditional Access policy with named locations and break-glass account in your Entra tenant.', 'Document one PIM activation flow as a runbook — exportable portfolio piece.'],
    'sc-500':         ['Spin up Sentinel free trial and connect Defender for Cloud as a data source.', 'Write one custom KQL detection rule — start simple (failed sign-ins from impossible-travel pattern).'],
    'az-305':         ['Watch John Savill AZ-305 Study Cram (~6 hrs, free) — comes right before exam, not at study start.', 'Read 3 Azure Architecture Center reference architectures in detail this week.'],
    'cissp':          ['Listen to one Pete Zerger CISSP Cram episode on commute (free YouTube, ~1 hr each).', 'Drill CISSP MCQs daily — Boson or Wannapractice. Aim for 100/day in final 2 weeks.'],
    'terraform-assoc':['Write one Terraform module for an Azure resource you use at NW Security.', 'Read HashiCorp Terraform Associate study guide section by section, hands-on after each.'],
    'cka':            ['Set up local Kubernetes via kind or minikube. Practise kubectl until muscle memory.', 'Run through Killer.sh CKA simulator — 2 sessions included with exam booking.'],
    'cks':            ['Deploy Falco in your kind cluster. Write one custom rule that catches a privileged container.', 'Read CIS Kubernetes Benchmark — 80% of CKS gotchas come from there.'],
    'sc-200':         ['Build a hunting query in Sentinel that finds first-time sign-ins from a country.', 'Wire a Logic App to auto-isolate a device based on a Defender alert.'],
    'sc-401':         ['Configure 3 sensitivity labels with auto-labelling rules in Purview free trial.', 'Build one DLP policy that detects credit-card numbers in Teams chats.'],
    'az-140':         ['Deploy a 2-host AVD pool in your Azure tenant. Cost it for 25 concurrent users.', 'Configure FSLogix profile containers — covers ~25% of the exam.'],
    'az-700':         ['Build hub-and-spoke topology with Azure Firewall and one peered spoke.', 'Configure Private Endpoint for one PaaS service — covers Private Link section.'],
    'md-102':         ['Decision week: book the exam OR remove from CV and skip. Do not let it drift.', 'If proceeding: deploy one Autopilot enrolment profile in M365 Developer Tenant.'],
    'ai-901':         ['Watch Microsoft Learn AI-901 path (~3 hrs total, free).', 'Call Azure OpenAI from one Python script with a system prompt — commit to GitHub.'],
    'az-900':         ['Watch John Savill AZ-900 Study Cram (~4 hrs, free).', 'Take Microsoft Learn practice assessment — score 80%+ before booking.'],
    'sc-900':         ['Read Microsoft Learn SC-900 path (~6 hrs).', 'Practice questions on Microsoft Learn until 85%+.'],
    'ccna':           ['Set up Cisco Packet Tracer (free) and build a 2-router static-route lab.', 'Watch Jeremy IT Lab CCNA YouTube — Module 1 (free).'],
    'mcit':           ['Complete Milestone XProtect VMS Essentials (free, ~4 hrs) on Axis Academy.', 'Build a small XProtect Express+ test deployment — even just two cameras.'],
    'mcie':           ['Tour the Milestone Integration Tools and document one integration scenario.', 'Practise XProtect troubleshooting flows — the exam tests these heavily.'],
    'acp':            ['Complete the Axis Academy ACP eLearning path (free, ~15 hrs).', 'Configure one Axis camera end-to-end in your home lab — record the steps.'],
    'lca':            ['Complete LenelS2 fundamentals on the partner portal (~6 hrs).', 'Practise OnGuard or Elements navigation — exam tests UI fluency.'],
    'lcp':            ['Build one access-control scenario in OnGuard or Elements — multi-door, schedules.', 'Document a credential lifecycle flow — exportable as runbook for portfolio.'],
    'thm-sec0':       ['Complete TryHackMe Pre-Security learning path (~10 hrs, free with sub).'],
    'thm-sec1':       ['Complete TryHackMe Cyber Security 101 modules — 30 min/day.'],
    'thm-sal1':       ['Run through TryHackMe SOC Analyst Level 1 simulator under timed conditions.'],
    'htb-cdsa':       ['Complete the 15 prerequisite HTB Academy modules — track progress weekly.', 'Practise SOC Analyst-style investigation reports — they are the exam deliverable.'],
    'ukcsc-assoc':    ['Pull together your evidence portfolio — A+, Network+, NW Security role mapped to 5 competency areas.', '⚠ First general intake closes 17 May 2026 — apply this window.'],
  };

  const specific = studyMap[id] || [];
  specific.forEach(s => actions.push(s));

  // Generic fallback if nothing cert-specific
  if (actions.length === 0) {
    actions.push(`📚 Begin study with the official ${code || cert.name} learning path.`);
    actions.push('🛠 Identify one hands-on lab task that mirrors a real exam objective.');
  }

  // Cap at 3 to avoid overwhelm
  return actions.slice(0, 3);
}
function currentPhase() {
  for (let p = 1; p <= 6; p++) {
    if (CERTS.filter(c => c.phase === p && c.track === 'CORE').some(c => !state.passes[c.id])) return p;
  }
  return 6;
}
function nextCoreCert() {
  // Prefer the highest-priority unpassed cert in the current phase whose deps are met.
  // Falls back to any unpassed P1/P2, then any unpassed CORE.
  const ph = currentPhase();
  const depsMet = cert => !cert.deps || cert.deps.every(d => state.passes[d]);

  const candidates = CERTS
    .filter(c => c.phase === ph && !state.passes[c.id] && !state.skipped[c.id])
    .map(c => ({ cert: c, ps: priorityScore(c), depsOK: depsMet(c) }))
    .sort((a, b) => {
      // Prefer deps-met, then highest priority, then lowest difficulty
      if (a.depsOK !== b.depsOK) return a.depsOK ? -1 : 1;
      if (a.ps !== b.ps) return b.ps - a.ps;
      return (a.cert.difficulty || 0) - (b.cert.difficulty || 0);
    });
  return candidates[0]?.cert || null;
}

// ───── NOTIFICATIONS ──────────────────────────────────────────────────────
function shouldShowNotifyBanner() {
  return 'Notification' in window && Notification.permission === 'default';
}
async function requestNotifications() {
  const perm = await Notification.requestPermission();
  if (perm === 'granted') checkAndNotify();
  renderApp();
}
function checkAndNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const lastCheck = localStorage.getItem(SK.notify);
  const todayStr = today();
  if (lastCheck === todayStr) return;
  localStorage.setItem(SK.notify, todayStr);

  const urgent = [], warn = [];
  CERTS.forEach(cert => {
    const pd = state.passes[cert.id];
    if (!pd) return;
    const { status, days, expiry } = expiryInfo(cert, pd);
    if (status === 'EXPIRED') urgent.push(`${cert.name} — expired ${Math.abs(days)}d ago`);
    else if (status === 'URGENT') urgent.push(`${cert.name} — ${days}d left (expires ${fmt(expiry)})`);
    else if (status === 'WARN') warn.push(`${cert.name} — ${days}d left`);
  });
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (urgent.length > 0 && sw) {
    const body = urgent.slice(0, 3).join('\n') + (urgent.length > 3 ? `\n+${urgent.length - 3} more` : '');
    sw.postMessage({ type: 'NOTIFY', title: `⚠ ${urgent.length} cert${urgent.length > 1 ? 's' : ''} expiring`, body, tag: 'urgent' });
  }
  if (warn.length > 0 && urgent.length === 0 && sw) {
    const body = warn.slice(0, 3).join('\n') + (warn.length > 3 ? `\n+${warn.length - 3} more` : '');
    sw.postMessage({ type: 'NOTIFY', title: `${warn.length} cert${warn.length > 1 ? 's' : ''} renewing soon`, body, tag: 'warn' });
  }
}

// ───── DEADLINE BANNERS ───────────────────────────────────────────────────
function renderBanners() {
  const banners = [];
  PERSONAL_DEADLINES.forEach(d => {
    const daysLeft = daysUntil(new Date(d.date));
    if (daysLeft < 0 || daysLeft > 365) return;
    banners.push(`
      <div class="banner ${d.severity}">
        <span>⏱</span>
        <div><strong>${daysLeft}d</strong> · ${escape(d.label)} · ${fmt(d.date)}</div>
      </div>`);
  });
  return banners.join('');
}

// ───── RENDER ─────────────────────────────────────────────────────────────
function renderApp() {
  const total = CERTS.length;
  const passed = CERTS.filter(c => state.passes[c.id]).length;
  const coreTotal = CERTS.filter(c => c.track === 'CORE').length;
  const corePassed = CERTS.filter(c => c.track === 'CORE' && state.passes[c.id]).length;
  const ph = currentPhase();

  document.getElementById('app').innerHTML = `
    <div class="header">
      <div>
        <div class="header-title">Cert Tracker</div>
        <div class="header-sub">Alex · v22 · 70 certs · Phase ${ph}</div>
      </div>
      <div class="header-count">
        ${passed}/${total}
        <small>Core ${corePassed}/${coreTotal}</small>
      </div>
    </div>
    <div class="tabs">
      <button class="tab${state.currentTab === 'dashboard' ? ' active' : ''}" onclick="switchTab('dashboard')">Dashboard</button>
      <button class="tab${state.currentTab === 'certifications' ? ' active' : ''}" onclick="switchTab('certifications')">Certifications</button>
      <button class="tab${state.currentTab === 'gates' ? ' active' : ''}" onclick="switchTab('gates')">Phase Gates</button>
      <button class="tab${state.currentTab === 'study' ? ' active' : ''}" onclick="switchTab('study')">Study Log</button>
      <button class="tab${state.currentTab === 'cpe' ? ' active' : ''}" onclick="switchTab('cpe')">CPE</button>
    </div>
    <div class="content" id="tab-content"></div>
  `;
  renderTabContent();
}

function renderTabContent() {
  const el = document.getElementById('tab-content');
  if (!el) return;
  if (state.currentTab === 'dashboard')      el.innerHTML = renderDashboard();
  if (state.currentTab === 'certifications') el.innerHTML = renderCertifications();
  if (state.currentTab === 'gates')          el.innerHTML = renderGates();
  if (state.currentTab === 'study')          el.innerHTML = renderStudy();
  if (state.currentTab === 'cpe')            el.innerHTML = renderCPE();
}

function switchTab(tab) { state.currentTab = tab; renderApp(); }

// Only re-render the header count (not whole DOM)
function updateHeaderCount() {
  const total = CERTS.length;
  const passed = CERTS.filter(c => state.passes[c.id]).length;
  const coreTotal = CERTS.filter(c => c.track === 'CORE').length;
  const corePassed = CERTS.filter(c => c.track === 'CORE' && state.passes[c.id]).length;
  const hc = document.querySelector('.header-count');
  if (hc) hc.innerHTML = `${passed}/${total}<small>Core ${corePassed}/${coreTotal}</small>`;
  const hs = document.querySelector('.header-sub');
  const ph = currentPhase();
  if (hs) hs.textContent = `Alex · v22 · 70 certs · Phase ${ph}`;
}

// ───── DASHBOARD ──────────────────────────────────────────────────────────
function renderDashboard() {
  const ph = currentPhase();
  const nxt = nextCoreCert();
  const total = CERTS.length;
  const passed = CERTS.filter(c => state.passes[c.id]).length;
  const overallPct = Math.round(passed / total * 100);

  const gatewayCerts = CERTS.filter(c => c.gateway);
  const gatewayPassed = gatewayCerts.filter(c => state.passes[c.id]).length;

  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay()); // Sunday
  thisWeekStart.setHours(0, 0, 0, 0);
  const thisWeekHours = state.studyLog
    .filter(s => new Date(s.date) >= thisWeekStart && s.type === 'study')
    .reduce((sum, s) => sum + (parseFloat(s.hours) || 0), 0);
  const studyTarget = 13;

  const notifyBanner = shouldShowNotifyBanner() ? `
    <div class="notify-banner">
      <span>Enable notifications for expiry alerts</span>
      <button onclick="requestNotifications()">Enable</button>
    </div>` : '';

  const toolsBar = `
    <div class="tools-bar">
      <span class="tools-bar-label">Tools</span>
      <button class="btn-tool" onclick="exportICS()">📅 Calendar (.ics)</button>
      <button class="btn-tool" onclick="exportCV()">📋 CV markdown</button>
      <button class="btn-tool" onclick="exportJSON()">⬇ Backup</button>
      <button class="btn-tool" onclick="importJSON()">⬆ Restore</button>
    </div>`;

  const heroCard = `
    <div class="dash-hero">
      <div class="dash-hero-top">
        <div>
          <div class="dash-hero-eyebrow">You are here</div>
          <div class="dash-hero-title">Phase ${ph} · ${escape(PHASES[ph].name)}</div>
          <div class="dash-hero-sub">${escape(PHASES[ph].window)} · ${escape(PHASES[ph].layer)}</div>
        </div>
        <div style="text-align:right">
          <div class="big-number" style="font-size:32px">${overallPct}<span style="font-size:16px;color:var(--dim)">%</span></div>
          <div style="font-size:10px;color:var(--dim)">${passed} of ${total}</div>
        </div>
      </div>
      ${nxt ? `
        <div class="dash-hero-next">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
            <span class="badge badge-prio badge-prio-${priorityScore(nxt)}">${priorityTag(priorityScore(nxt))} · ${priorityLabel(priorityScore(nxt))}</span>
            ${nxt.gateway ? `<span class="badge badge-gateway">🔑 GATEWAY</span>` : ''}
            ${(nxt.deps || []).length && !nxt.deps.every(d => state.passes[d]) ? `<span class="badge badge-1yr">⚠ Deps not met</span>` : ''}
          </div>
          <strong>🎯 Next up:</strong> ${escape(nxt.name)}${nxt.code ? ` <span style="color:var(--dim);font-family:monospace">(${escape(nxt.code)})</span>` : ''}
          ${nxt.hours[0] > 0 ? `<br><span style="color:var(--dim)">≈ ${nxt.hours[0]}–${nxt.hours[1]} hrs · ${nxt.cost}</span>` : ''}
        </div>
        ${(() => {
          const acts = weeklyActions(nxt);
          if (!acts.length) return '';
          return `
            <div class="dash-hero-week">
              <div class="dash-hero-week-label">📋 What to do this week</div>
              <ul class="dash-hero-week-list">
                ${acts.map(a => `<li>${escape(a)}</li>`).join('')}
              </ul>
            </div>`;
        })()}` : `
        <div class="dash-hero-next" style="background:var(--green-bg);border-color:var(--green)">
          <strong>✓ All Phase ${ph} certs passed.</strong> Move to the next phase or conditional work.
        </div>`}
      <div class="stat-pill-row">
        <div class="stat-pill"><div class="stat-pill-num" style="color:var(--amber)">${gatewayPassed}/${gatewayCerts.length}</div><div class="stat-pill-label">🔑 Gateway</div></div>
        <div class="stat-pill"><div class="stat-pill-num" style="color:${thisWeekHours >= studyTarget ? 'var(--green)' : thisWeekHours >= studyTarget * 0.5 ? 'var(--blue)' : 'var(--amber)'}">${thisWeekHours.toFixed(1)}h</div><div class="stat-pill-label">This week (${studyTarget}h target)</div></div>
        <div class="stat-pill"><div class="stat-pill-num">${CERTS.filter(c => c.phase === ph && state.passes[c.id]).length}/${CERTS.filter(c => c.phase === ph).length}</div><div class="stat-pill-label">Phase ${ph}</div></div>
      </div>
      ${(() => {
        // Capacity pressure gauge — hours-needed vs hours-available for current phase
        const PHASE_END = { 1: '2026-08-31', 2: '2027-03-31', 3: '2027-11-30', 4: '2028-07-31', 5: '2029-03-31' };
        const phaseEnd = PHASE_END[ph];
        if (!phaseEnd) return '';
        const daysLeft = Math.max(0, daysUntil(new Date(phaseEnd)));
        const weeksLeft = daysLeft / 7;
        const hoursAvailable = Math.round(weeksLeft * studyTarget);
        const hoursNeeded = CERTS
          .filter(c => c.phase === ph && !state.passes[c.id] && !state.skipped[c.id] && !c.employer && c.cost !== 'Held')
          .reduce((s, c) => s + c.hours[1], 0);
        if (hoursNeeded === 0) return '';
        const utilPct = hoursAvailable > 0 ? Math.round((hoursNeeded / hoursAvailable) * 100) : 999;
        const overCapacity = utilPct > 100;
        const tight = utilPct > 80 && utilPct <= 100;
        const color = overCapacity ? 'var(--red)' : tight ? 'var(--amber)' : 'var(--green)';
        const bgColor = overCapacity ? 'var(--red-bg)' : tight ? 'var(--amber-bg)' : 'var(--green-bg)';
        return `
          <div class="capacity-gauge" style="margin-top:10px;padding:10px 12px;background:${bgColor};border-left:3px solid ${color};border-radius:8px">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
              <strong style="font-size:11px;color:${color};text-transform:uppercase;letter-spacing:.04em">⏱ Phase ${ph} capacity</strong>
              <span style="font-size:14px;font-weight:800;color:${color}">${utilPct}%</span>
            </div>
            <div style="font-size:11px;color:var(--muted);line-height:1.5">
              <strong>${hoursNeeded}h needed</strong> for unpassed certs · <strong>${hoursAvailable}h available</strong> in ${Math.round(weeksLeft)} wks @ ${studyTarget}h/wk
            </div>
            ${progressBarHTML(Math.min(100, utilPct), color, '5px')}
            ${overCapacity ? `<div style="font-size:10px;color:${color};margin-top:6px;font-weight:600">⚠ Over capacity — skip ${Math.ceil((hoursNeeded - hoursAvailable) / 60)} cert(s) or extend timeline</div>` : ''}
            ${tight ? `<div style="font-size:10px;color:${color};margin-top:6px">Tight — protect gateway certs first</div>` : ''}
          </div>`;
      })()}
    </div>`;

  // Expiry panel
  const expiring = CERTS
    .filter(c => state.passes[c.id] && c.validity)
    .map(c => ({ ...c, ...expiryInfo(c, state.passes[c.id]) }))
    .filter(c => ['OK', 'WARN', 'URGENT', 'EXPIRED'].includes(c.status))
    .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

  const upcomingExams = CERTS
    .filter(c => state.exams[c.id] && !state.passes[c.id])
    .map(c => ({ ...c, examDays: daysUntil(new Date(state.exams[c.id])), examDate: state.exams[c.id] }))
    .sort((a, b) => a.examDays - b.examDays);

  const examsHTML = upcomingExams.length > 0 ? `
    <div style="margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">📝 Upcoming exams</div>
      ${upcomingExams.map(c => `
        <div class="expiry-item ${c.examDays <= 7 ? 'urgent' : c.examDays <= 30 ? 'warn' : ''}">
          <div class="expiry-item-top">
            <div>
              <div class="expiry-item-name">${escape(c.name)}</div>
              <div class="expiry-item-date">${fmt(c.examDate)}</div>
            </div>
            ${examBadgeHTML(c.id)}
          </div>
        </div>`).join('')}
    </div>` : '';

  const expiryHTML = expiring.length === 0 && upcomingExams.length === 0
    ? `<div class="empty">No exams booked or certs with expiry. Set dates in the Certifications tab.</div>`
    : `${examsHTML}
       ${expiring.length > 0 ? `<div style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">🔁 Renewals</div>` : ''}
       ${expiring.map(c => `
         <div class="expiry-item ${c.status.toLowerCase()}">
           <div class="expiry-item-top">
             <div>
               <div class="expiry-item-name">${escape(c.name)}</div>
               <div class="expiry-item-date">${c.expiry ? 'Expires ' + fmt(c.expiry) : ''}</div>
             </div>
             ${statusBadgeHTML(c.status, c.days)}
           </div>
         </div>`).join('')}`;

  // Phase progress
  const phaseHTML = [1, 2, 3, 4, 5, 6].map(p => {
    const all = CERTS.filter(c => c.phase === p);
    const core = all.filter(c => c.track === 'CORE');
    const cpPassed = core.filter(c => state.passes[c.id]).length;
    const allPassed = all.filter(c => state.passes[c.id]).length;
    const pct = core.length ? Math.round(cpPassed / core.length * 100) : 0;
    const done = core.length > 0 && cpPassed === core.length;
    const active = p === ph;
    const color = done ? 'var(--green)' : active ? 'var(--blue)' : 'var(--slate)';
    return `
      <div class="phase-item ph${p} ${active ? 'active' : done ? 'done' : ''}">
        <div class="phase-meta">
          <span class="phase-name ${active ? 'active' : done ? 'done' : 'pending'}">${active ? '▶ ' : done ? '✓ ' : ''}Phase ${p}</span>
          <span class="phase-count">${allPassed}/${all.length}</span>
        </div>
        <div class="phase-sub">${escape(PHASES[p].name)}</div>
        ${progressBarHTML(pct, color, '5px')}
        <div style="font-size:9px;color:var(--dim);margin-top:3px">Core ${cpPassed}/${core.length}</div>
      </div>`;
  }).join('');

  // Track progress
  const trackRows = ['CORE', 'ROLE-DRIVEN', 'CONDITIONAL', 'OPTIONAL', 'POST-PLAN'].map(tr => {
    const tc = CERTS.filter(c => c.track === tr);
    const tp = tc.filter(c => state.passes[c.id]).length;
    const pct = tc.length ? Math.round(tp / tc.length * 100) : 0;
    const info = TRACK_INFO[tr];
    return `
      <div class="track-row">
        <div class="track-row-meta">
          <span class="badge ${info.cls}">${info.label}</span>
          <span style="font-size:10px;color:var(--dim)">${tp}/${tc.length}</span>
        </div>
        ${progressBarHTML(pct, info.bar, '5px')}
      </div>`;
  }).join('');

  // CPE — only passed certs with active CPE cycle
  const cpePassed = CERTS.filter(c => c.cpe > 0 && state.passes[c.id]);
  const cpeRows = cpePassed.length > 0 ? cpePassed.map(c => {
    const earned = certCpeEarned(c.id);
    const pct = Math.min(100, Math.round(earned / c.cpe * 100));
    const color = pct >= 100 ? 'var(--green)' : pct > 50 ? 'var(--blue)' : 'var(--amber)';
    return `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:2px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;padding-right:8px">${escape(c.name)}</span>
          <span style="flex-shrink:0;font-variant-numeric:tabular-nums">${earned}/${c.cpe}</span>
        </div>
        ${progressBarHTML(pct, color, '5px')}
      </div>`;
  }).join('') : '';

  // Priority breakdown — how many P1-P5 passed vs total
  const prioLevels = [5, 4, 3, 2, 1];
  const prioRows = prioLevels.map(lvl => {
    const certsAtLvl = CERTS.filter(c => priorityScore(c) === lvl);
    if (certsAtLvl.length === 0) return '';
    const passedAtLvl = certsAtLvl.filter(c => state.passes[c.id]).length;
    const pct = certsAtLvl.length > 0 ? Math.round(passedAtLvl / certsAtLvl.length * 100) : 0;
    const barColor = lvl === 5 ? 'var(--red)' : lvl === 4 ? 'var(--amber)' : lvl === 3 ? 'var(--blue)' : 'var(--slate)';
    return `
      <div class="track-row">
        <div class="track-row-meta">
          <span class="badge badge-prio badge-prio-${lvl}">${priorityTag(lvl)} · ${priorityLabel(lvl)}</span>
          <span style="font-size:10px;color:var(--dim)">${passedAtLvl}/${certsAtLvl.length}</span>
        </div>
        ${progressBarHTML(pct, barColor, '5px')}
      </div>`;
  }).join('');

  return `
    ${renderBanners()}
    ${notifyBanner}
    ${toolsBar}
    ${heroCard}
    <div class="dash-grid">
      <div class="card">
        <div class="card-title"><span class="dot" style="background:var(--red)"></span>Expiry Timeline</div>
        ${expiryHTML}
      </div>
      <div class="card">
        <div class="card-title"><span class="dot" style="background:var(--blue)"></span>Phase Progress</div>
        ${phaseHTML}
      </div>
      <div class="card">
        <div class="card-title"><span class="dot" style="background:var(--green)"></span>Overall & Tracks</div>
        <div class="big-number">${passed}</div>
        <div class="big-sub">of ${total} certifications passed</div>
        ${progressBarHTML(overallPct, 'var(--blue)', '8px')}
        <div style="margin:10px 0 10px 0;font-size:10px;color:var(--dim);text-align:center">Core: ${CERTS.filter(c => c.track === 'CORE' && state.passes[c.id]).length}/${CERTS.filter(c => c.track === 'CORE').length} · Gateway: ${gatewayPassed}/${gatewayCerts.length}</div>
        <div style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 8px">By Priority</div>
        ${prioRows}
        <div style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px;border-top:1px solid var(--border);padding-top:12px">By Track</div>
        ${trackRows}
        ${cpeRows ? `<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px"><div style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">CPE Progress</div>${cpeRows}</div>` : ''}
      </div>
    </div>`;
}

// ───── CERTIFICATIONS ─────────────────────────────────────────────────────
function renderCertifications() {
  const filters = [
    { id: 'all',      label: 'All', test: () => true },
    { id: 'tier-s',   label: '⭐ Tier S', test: c => c.tier === 'S' },
    { id: 'tier-a',   label: '★ Tier A', test: c => c.tier === 'A' },
    { id: 'tier-sa',  label: 'S+A only', test: c => c.tier === 'S' || c.tier === 'A' },
    { id: 'tier-b',   label: 'Tier B', test: c => c.tier === 'B' },
    { id: 'tier-c',   label: 'Tier C', test: c => c.tier === 'C' },
    { id: 'tier-d',   label: 'Tier D', test: c => c.tier === 'D' },
    { id: 'p1',       label: 'P1 Must', test: c => priorityScore(c) === 5 },
    { id: 'p2',       label: 'P2 Core', test: c => priorityScore(c) === 4 },
    { id: 'gateway',  label: '🔑 Gateway', test: c => c.gateway },
    { id: 'core',     label: 'Core track', test: c => c.track === 'CORE' },
    { id: 'active',   label: 'Active phase', test: c => c.phase === currentPhase() },
    { id: 'upcoming', label: 'Not passed', test: c => !state.passes[c.id] },
    { id: 'passed',   label: 'Passed', test: c => state.passes[c.id] },
  ];
  const activeFilter = filters.find(f => f.id === state.filter) || filters[0];

  const filterBar = `
    <div class="cert-filter-bar">
      ${filters.map(f => `
        <button class="filter-chip${state.filter === f.id ? ' active' : ''}" onclick="setFilter('${f.id}')">
          ${escape(f.label)}
        </button>`).join('')}
    </div>`;

  const blocks = [1, 2, 3, 4, 5, 6].map(ph => {
    const certs = CERTS
      .filter(c => c.phase === ph)
      .filter(activeFilter.test)
      .slice()
      .sort((a, b) => {
        // Tier ranking: S > A > B > C > D
        const tierOrder = { 'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4 };
        const ta = tierOrder[a.tier] ?? 5, tb = tierOrder[b.tier] ?? 5;
        if (ta !== tb) return ta - tb;
        // Then priority DESC, then difficulty ASC (easier as warm-up)
        const pa = priorityScore(a), pb = priorityScore(b);
        if (pa !== pb) return pb - pa;
        return (a.difficulty || 0) - (b.difficulty || 0);
      });
    if (certs.length === 0) return '';
    const totalCerts = CERTS.filter(c => c.phase === ph).length;
    const passed = CERTS.filter(c => c.phase === ph && state.passes[c.id]).length;
    const isOpen = state.openPhase === ph;
    const numClass = passed === totalCerts ? 'done' : passed > 0 ? 'partial' : 'pending';

    // Identify the single recommended "next up" cert globally
    const nextRecommended = nextCoreCert();
    const rows = isOpen ? certs.map(cert => renderCertRow(cert, nextRecommended && cert.id === nextRecommended.id)).join('') : '';

    return `
      <div class="phase-block ph${ph}">
        <button class="phase-header" onclick="togglePhase(${ph})">
          <div class="phase-header-left">
            <span class="phase-num ${numClass}">${ph}</span>
            <div>
              <div class="phase-header-title">Phase ${ph}: ${escape(PHASES[ph].name)}</div>
              <div class="phase-header-meta">${passed}/${totalCerts} passed · ${escape(PHASES[ph].window)}</div>
            </div>
          </div>
          <span class="phase-toggle">${isOpen ? '−' : '+'}</span>
        </button>
        ${rows}
      </div>`;
  }).join('');

  return `
    <p style="font-size:11px;color:var(--dim);margin-bottom:10px">Tap a cert to expand. Enter pass dates for auto-renewal and expiry tracking.</p>
    ${filterBar}
    ${blocks}`;
}

function renderCertRow(cert, isNext = false) {
  const pd = state.passes[cert.id] || '';
  const { status, days, expiry } = expiryInfo(cert, pd);
  const info = TRACK_INFO[cert.track];
  const isOpen = !!state.openCerts[cert.id];
  const certNotes = state.notes[cert.id] || { text: '', link: '', imageData: '' };
  const hasNotes = certNotes.text || certNotes.link || certNotes.imageData;
  const ps = priorityScore(cert);

  const dotClass = pd
    ? 'passed'
    : status === 'URGENT' || status === 'EXPIRED'
      ? 'urgent'
      : status === 'WARN'
        ? 'warn'
        : '';

  const summary = `
    <div class="cert-summary" onclick="toggleCert('${cert.id}')">
      <div class="cert-status-dot ${dotClass}"></div>
      ${certNotes.imageData ? `<img src="${escape(certNotes.imageData)}" class="cert-badge-img" alt="">` : ''}
      <div class="cert-summary-main">
        <div class="cert-name-row">
          ${isNext ? `<span class="badge badge-next">▶ NEXT UP</span>` : ''}
          <span class="cert-name ${pd ? 'passed' : ''}">${escape(cert.name)}</span>
          ${cert.code ? `<span class="cert-code">${escape(cert.code)}</span>` : ''}
        </div>
        <div class="cert-meta-row">
          ${pd ? `<span class="badge badge-held">✓ HELD${state.passes[cert.id] ? ' · ' + formatPassDate(state.passes[cert.id]) : ''}</span>` : ''}
          ${state.skipped[cert.id] ? `<span class="badge badge-skipped">⊘ SKIPPED</span>` : ''}
          <span class="badge badge-prio badge-prio-${ps}" title="${escape(priorityLabel(ps))}">${priorityTag(ps)} · ${escape(priorityLabel(ps))}</span>
          ${cert.gateway ? `<span class="badge badge-gateway">🔑 GATEWAY</span>` : ''}
          ${cert.tier ? `<span class="badge badge-tier badge-tier-${cert.tier}" title="ROI Priority Tier ${cert.tier}">TIER ${cert.tier}</span>` : ''}
          ${cert.roi > 0 ? `<span class="badge badge-roi" title="Career ROI ${cert.roi}/10">ROI ${cert.roi}</span>` : ''}
          ${cert.difficulty > 0 ? `<span class="badge badge-diff" title="Difficulty ${cert.difficulty}/10">DIFF ${cert.difficulty}</span>` : ''}
          <span class="badge ${info.cls}">${info.label}</span>
          ${cert.employer ? `<span class="badge badge-employer">Employer £</span>` : ''}
          ${cert.free ? `<span class="badge badge-free">Free</span>` : ''}
          ${cert.validity === 12 ? `<span class="badge badge-1yr">1yr ⚠</span>` : ''}
          ${cert.cpe > 0 ? `<span class="badge badge-cpe">${cert.cpe} CPE</span>` : ''}
          <span>${escape(cert.cost)}</span>
          ${pd ? statusBadgeHTML(status, days) : ''}
        </div>
      </div>
      <button class="cert-expand-toggle">${isOpen ? '▲' : '▼'}</button>
    </div>`;

  if (!isOpen) return `<div class="cert-row ${pd ? 'passed' : ''} ${cert.gateway ? 'gateway' : ''} ${isNext ? 'is-next' : ''} ${state.skipped[cert.id] ? 'is-skipped' : ''}">${summary}</div>`;

  const deps = (cert.deps || []).map(id => CERTS.find(c => c.id === id)).filter(Boolean);
  const depsPassed = deps.every(d => state.passes[d.id]);

  const details = `
    <div class="cert-details">
      <div class="cert-details-grid">
        ${cert.difficulty > 0 ? `<div class="cert-stat"><div class="cert-stat-label">Difficulty</div><div class="cert-stat-value">${cert.difficulty}/10</div></div>` : ''}
        ${cert.roi > 0 ? `<div class="cert-stat"><div class="cert-stat-label">Career ROI</div><div class="cert-stat-value">${cert.roi}/10</div></div>` : ''}
        ${cert.hours[1] > 0 ? `<div class="cert-stat"><div class="cert-stat-label">Study hours</div><div class="cert-stat-value">${cert.hours[0]}–${cert.hours[1]}</div></div>` : ''}
        ${cert.validity ? `<div class="cert-stat"><div class="cert-stat-label">Validity</div><div class="cert-stat-value">${cert.validity} months</div></div>` : ''}
      </div>
      ${cert.projectRec ? `
        <div class="cert-project">
          <div class="cert-project-label">📦 Portfolio project</div>
          ${escape(cert.projectRec)}
        </div>` : ''}
      ${cert.skills && cert.skills.length ? `
        <div class="cert-skill-tags">
          ${cert.skills.map(s => `<span class="cert-skill-tag">${escape(s)}</span>`).join('')}
        </div>` : ''}
      ${cert.subjects && cert.subjects.length ? `
        <div style="margin-top:8px;padding:8px 10px;background:var(--surface-2);border-left:3px solid #06b6d4;border-radius:4px;font-size:12px;line-height:1.55">
          <strong style="color:#06b6d4;font-size:10px;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">🏷️ Subjects & technical depth</strong>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${cert.subjects.map(s => `<span style="display:inline-block;padding:2px 8px;background:rgba(6,182,212,0.12);color:#0e7490;border-radius:10px;font-size:11px;font-weight:500">${escape(s)}</span>`).join('')}</div>
        </div>` : ''}
      ${deps.length ? `
        <div style="margin-top:8px;font-size:10px;color:var(--dim)">
          <strong>Requires:</strong> ${deps.map(d => `<span style="color:${state.passes[d.id] ? 'var(--green-text)' : 'var(--amber-text)'}">${state.passes[d.id] ? '✓' : '○'} ${escape(d.name)}</span>`).join(' · ')}
          ${!depsPassed ? `<br><span style="color:var(--amber);font-weight:600">⚠ Dependencies not yet complete</span>` : ''}
        </div>` : ''}
      ${cert.examFormat ? `<div class="cert-format" style="margin-top:8px;padding:8px 10px;background:var(--surface-2);border-left:3px solid var(--blue);border-radius:4px;font-size:12px;line-height:1.5"><strong style="color:var(--blue);font-size:10px;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:3px">📋 Exam format</strong>${escape(cert.examFormat)}</div>` : ''}
      ${cert.coverage ? `<div class="cert-coverage" style="margin-top:8px;padding:8px 10px;background:var(--surface-2);border-left:3px solid var(--amber);border-radius:4px;font-size:12px;line-height:1.55"><strong style="color:var(--amber);font-size:10px;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:3px">📚 Subject coverage & depth</strong>${escape(cert.coverage)}</div>` : ''}
      ${cert.prerequisites ? `<div class="cert-prereq" style="margin-top:8px;padding:8px 10px;background:var(--surface-2);border-left:3px solid var(--green);border-radius:4px;font-size:12px;line-height:1.55"><strong style="color:var(--green);font-size:10px;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:3px">🎯 Prerequisite skills</strong>${escape(cert.prerequisites)}</div>` : ''}
      ${cert.studyMaterials ? `<div class="cert-materials" style="margin-top:8px;padding:8px 10px;background:var(--surface-2);border-left:3px solid var(--purple);border-radius:4px;font-size:12px;line-height:1.55"><strong style="color:var(--purple);font-size:10px;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:3px">📖 Recommended study materials</strong>${escape(cert.studyMaterials)}</div>` : ''}
      ${cert.tutorFlag ? `<div class="cert-tutor" style="margin-top:8px;padding:8px 10px;background:#fef3c7;border-left:3px solid #d97706;border-radius:4px;font-size:12px;line-height:1.55;color:#78350f"><strong style="color:#78350f;font-size:10px;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:3px">👨‍🏫 Tutoring flag</strong>${escape(cert.tutorFlag)}</div>` : ''}
      <div class="cert-note" style="margin-top:8px">${escape(cert.note)}</div>
      <div class="cert-inputs">
        <div class="cert-input-block">
          <label class="cert-input-label">Exam booked</label>
          <input type="date" value="${escape(state.exams[cert.id] || '')}" onchange="updateExam('${cert.id}', this.value)">
          <div class="cert-status-row">${examBadgeHTML(cert.id)}</div>
        </div>
        <div class="cert-input-block">
          <label class="cert-input-label">Pass date</label>
          <input type="date" value="${escape(pd)}" onchange="updatePass('${cert.id}', this.value)">
          <div class="cert-status-row">${statusBadgeHTML(status, days)}</div>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="toggleNotes('${cert.id}')" style="flex:1">
          ${state.openCerts[cert.id + '_notes'] ? '▲ Hide notes' : `▼ ${hasNotes ? 'Notes / link / badge' : 'Add notes / link / badge'}`}
        </button>
        <button class="btn btn-secondary btn-sm" onclick="toggleSkip('${cert.id}')" style="flex:0 0 auto" title="${state.skipped[cert.id] ? 'Restore this cert to your plan' : 'Drop this cert from your plan (Lifeboat / Realistic path)'}">
          ${state.skipped[cert.id] ? '↩ Un-skip' : '⊘ Skip'}
        </button>
      </div>
      ${state.openCerts[cert.id + '_notes'] ? renderNotesPanel(cert, certNotes) : ''}
    </div>`;

  return `<div class="cert-row ${pd ? 'passed' : ''} ${cert.gateway ? 'gateway' : ''} ${isNext ? 'is-next' : ''} ${state.skipped[cert.id] ? 'is-skipped' : ''}">${summary}${details}</div>`;
}

function renderNotesPanel(cert, certNotes) {
  return `
    <div class="cert-notes-panel">
      <div class="cert-notes-row">
        <label>Notes</label>
        <textarea class="cert-notes-input" placeholder="Study resources, booking ref, strategy notes..."
          oninput="updateNote('${cert.id}','text',this.value)">${escape(certNotes.text || '')}</textarea>
      </div>
      <div class="cert-notes-row">
        <label>Link (Credly, booking, study material)</label>
        <input type="url" class="cert-link-input" placeholder="https://..." value="${escape(certNotes.link || '')}"
          oninput="updateNote('${cert.id}','link',this.value)">
        ${certNotes.link ? `<a href="${escape(certNotes.link)}" target="_blank" rel="noopener" class="cert-link-open">↗ Open link</a>` : ''}
      </div>
      <div class="cert-notes-row">
        <label>Badge image</label>
        ${certNotes.imageData ? `
          <div class="badge-preview">
            <img src="${escape(certNotes.imageData)}" style="width:48px;height:48px;border-radius:6px;object-fit:contain;background:var(--surface-2);border:1px solid var(--border)">
            <button class="badge-remove-btn" onclick="removeBadgeImage('${cert.id}')">✕ Remove</button>
          </div>` : `
          <label class="badge-upload-btn">
            📁 Upload badge image (PNG, JPG)
            <input type="file" accept="image/*" onchange="uploadBadgeImage('${cert.id}', this)">
          </label>`}
      </div>
    </div>`;
}

function setFilter(f) {
  state.filter = f;
  save.filter();
  rerenderCurrentTab();
}
function toggleCert(id) {
  state.openCerts[id] = !state.openCerts[id];
  rerenderCurrentTab();
}
function toggleNotes(id) {
  state.openCerts[id + '_notes'] = !state.openCerts[id + '_notes'];
  rerenderCurrentTab();
}
function togglePhase(ph) {
  state.openPhase = state.openPhase === ph ? null : ph;
  save.openPh();
  rerenderCurrentTab();
}
function rerenderCurrentTab() {
  renderTabContent();
}

// ───── UPDATE HANDLERS ────────────────────────────────────────────────────
function updateExam(id, date) {
  if (date) state.exams[id] = date; else delete state.exams[id];
  save.exams();
  rerenderCurrentTab();
  updateHeaderCount();
}
function updatePass(id, date) {
  if (date) state.passes[id] = date; else delete state.passes[id];
  // Passing a cert removes any "skipped" status
  if (date && state.skipped[id]) { delete state.skipped[id]; save.skipped(); }
  const renewed = [];
  if (date && RENEWAL_CHAINS[id]) {
    RENEWAL_CHAINS[id].forEach(rid => {
      if (state.passes[rid]) {
        state.passes[rid] = date;
        renewed.push(CERTS.find(c => c.id === rid)?.name);
      }
    });
  }
  save.passes();
  if (renewed.length > 0) showToast(`Auto-renewed: ${renewed.filter(Boolean).join(', ')}`);
  rerenderCurrentTab();
  updateHeaderCount();
}
function toggleSkip(id) {
  if (state.skipped[id]) {
    delete state.skipped[id];
    save.skipped();
    showToast('Cert un-skipped');
  } else {
    if (state.passes[id]) {
      showToast('Cert is already passed — cannot skip');
      return;
    }
    state.skipped[id] = today();
    save.skipped();
    showToast('Cert marked skipped — will not appear in next-up');
  }
  rerenderCurrentTab();
}
function updateNote(certId, field, value) {
  if (!state.notes[certId]) state.notes[certId] = { text: '', link: '', imageData: '' };
  state.notes[certId][field] = value;
  save.notes();
}
function uploadBadgeImage(certId, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 500000) showToast('Large image — consider smaller file');
  const reader = new FileReader();
  reader.onload = e => {
    if (!state.notes[certId]) state.notes[certId] = { text: '', link: '', imageData: '' };
    state.notes[certId].imageData = e.target.result;
    save.notes();
    rerenderCurrentTab();
    showToast('Badge saved');
  };
  reader.readAsDataURL(file);
}
function removeBadgeImage(certId) {
  if (!state.notes[certId]) return;
  state.notes[certId].imageData = '';
  save.notes();
  rerenderCurrentTab();
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ───── PHASE GATES ────────────────────────────────────────────────────────
function renderGates() {
  const blocks = [1, 2, 3, 4, 5].map(ph => {
    const gates = PHASE_GATES[ph] || [];
    if (gates.length === 0) return '';
    const done = gates.filter(g => state.gates[g.id]).length;
    const pct = Math.round(done / gates.length * 100);
    const allDone = done === gates.length;
    const phaseInfo = PHASES[ph];

    return `
      <div class="gate-block ph${ph}">
        <div class="gate-header">
          <div>
            <div class="gate-title">Phase ${ph}: ${escape(phaseInfo.name)}</div>
            <div class="gate-sub">${escape(phaseInfo.window)}</div>
          </div>
          <div class="gate-progress">${done}/${gates.length} ${allDone ? '✓' : ''}</div>
        </div>
        ${progressBarHTML(pct, allDone ? 'var(--green)' : 'var(--blue)', '5px')}
        <div style="margin-top:12px">
          ${gates.map(g => `
            <div class="gate-item ${state.gates[g.id] ? 'checked' : ''}" onclick="toggleGate('${g.id}')">
              <div class="gate-checkbox ${state.gates[g.id] ? 'checked' : ''}"></div>
              <div class="gate-text">${escape(g.text)}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');

  const overallGates = Object.values(PHASE_GATES).flat();
  const overallDone = overallGates.filter(g => state.gates[g.id]).length;

  return `
    <div class="card">
      <div class="card-title"><span class="dot" style="background:var(--green)"></span>Phase completion gates</div>
      <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Each phase gate is a portfolio artefact. These are what employers actually screen for. Tick items when the artefact is committed to GitHub or evidenced.</p>
      <div class="big-number">${overallDone}<span style="font-size:18px;color:var(--dim)"> / ${overallGates.length}</span></div>
      <div class="big-sub">gates completed across all phases</div>
      ${progressBarHTML(Math.round(overallDone / overallGates.length * 100), 'var(--green)', '8px')}
    </div>
    ${blocks}`;
}

function toggleGate(id) {
  state.gates[id] = !state.gates[id];
  save.gates();
  rerenderCurrentTab();
}

// ───── STUDY LOG ──────────────────────────────────────────────────────────
function renderStudy() {
  // Week calendar
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekHTML = dayNames.map((name, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().split('T')[0];
    const hrs = state.studyLog
      .filter(s => s.date === ds && s.type === 'study')
      .reduce((sum, s) => sum + (parseFloat(s.hours) || 0), 0);
    const isToday = ds === today();
    return `
      <div class="study-day ${isToday ? 'today' : ''}" title="${fmt(ds)}: ${hrs}h">
        <div class="study-day-name">${name}</div>
        <div class="study-day-hrs" style="color:${hrs >= 2 ? 'var(--green)' : hrs > 0 ? 'var(--blue)' : 'var(--dim)'}">${hrs.toFixed(1)}</div>
      </div>`;
  }).join('');

  const weekHours = state.studyLog
    .filter(s => new Date(s.date) >= weekStart && s.type === 'study')
    .reduce((sum, s) => sum + (parseFloat(s.hours) || 0), 0);

  // Monthly total
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthHours = state.studyLog
    .filter(s => new Date(s.date) >= monthStart && s.type === 'study')
    .reduce((sum, s) => sum + (parseFloat(s.hours) || 0), 0);

  // 30-day trend chart
  const days30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const ds = d.toISOString().split('T')[0];
    const hrs = state.studyLog
      .filter(s => s.date === ds && s.type === 'study')
      .reduce((sum, s) => sum + (parseFloat(s.hours) || 0), 0);
    days30.push({ date: ds, hrs });
  }
  const maxHrs = Math.max(4, ...days30.map(d => d.hrs));
  const chartSvg = `
    <svg viewBox="0 0 300 100" style="width:100%;height:100px" preserveAspectRatio="none">
      <line x1="0" y1="25" x2="300" y2="25" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2,2"/>
      <line x1="0" y1="50" x2="300" y2="50" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2,2"/>
      <line x1="0" y1="75" x2="300" y2="75" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2,2"/>
      ${days30.map((d, i) => {
        const x = (i / 29) * 300;
        const h = (d.hrs / maxHrs) * 90;
        const y = 100 - h;
        return `<rect x="${x - 3}" y="${y}" width="6" height="${h}" fill="${d.hrs >= 2 ? '#35c776' : d.hrs > 0 ? '#4f8cff' : '#2a3650'}" rx="1"/>`;
      }).join('')}
    </svg>`;

  // Recent entries
  const recent = [...state.studyLog].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  const recentHTML = recent.length === 0
    ? `<div class="empty">No study time logged yet. Hit "Log time" to start.</div>`
    : `<table class="log-table">
        <thead><tr><th>Date</th><th>Type</th><th>Cert</th><th>Desc</th><th class="right">Hours</th><th></th></tr></thead>
        <tbody>
          ${recent.map(s => {
            const cert = state.studyLog.length ? CERTS.find(c => c.id === s.certId) : null;
            return `<tr>
              <td style="white-space:nowrap">${fmt(s.date)}</td>
              <td><span class="badge ${s.type === 'study' ? 'badge-cond' : s.type === 'lab' ? 'badge-role' : 'badge-opt'}">${escape(s.type)}</span></td>
              <td>${cert ? escape(cert.code || cert.name) : '—'}</td>
              <td>${escape(s.desc || '—')}</td>
              <td class="right credit">${s.hours}h</td>
              <td><button class="del-btn" onclick="deleteStudy('${s.id}')">×</button></td>
            </tr>`;
          }).join('')}
        </tbody>
       </table>`;

  const formHTML = state.showStudyForm ? `
    <div class="study-form">
      <div>
        <label class="form-label">Date *</label>
        <input type="date" class="form-input" value="${escape(state.studyForm.date)}" onchange="updateStudyForm('date', this.value)">
      </div>
      <div>
        <label class="form-label">Hours *</label>
        <input type="number" step="0.25" min="0" class="form-input" value="${escape(state.studyForm.hours)}" placeholder="e.g. 1.5" oninput="updateStudyForm('hours', this.value)">
      </div>
      <div>
        <label class="form-label">Type</label>
        <select class="form-input" onchange="updateStudyForm('type', this.value)">
          <option value="study" ${state.studyForm.type === 'study' ? 'selected' : ''}>Study</option>
          <option value="lab" ${state.studyForm.type === 'lab' ? 'selected' : ''}>Lab</option>
          <option value="writeup" ${state.studyForm.type === 'writeup' ? 'selected' : ''}>Write-up</option>
        </select>
      </div>
      <div>
        <label class="form-label">Cert (optional)</label>
        <select class="form-input" onchange="updateStudyForm('certId', this.value)">
          <option value="">—</option>
          ${CERTS.map(c => `<option value="${c.id}" ${state.studyForm.certId === c.id ? 'selected' : ''}>${escape(c.code || c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="full">
        <label class="form-label">Notes</label>
        <input type="text" class="form-input" value="${escape(state.studyForm.desc)}" oninput="updateStudyForm('desc', this.value)" placeholder="e.g. Professor Messer N+ videos 1–10">
      </div>
      <div class="full" style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="submitStudy()" ${!state.studyForm.date || !state.studyForm.hours ? 'disabled' : ''}>Save</button>
        <button class="btn btn-secondary" onclick="toggleStudyForm()">Cancel</button>
      </div>
    </div>` : '';

  const weekTarget = 13;
  const weekPct = Math.min(100, Math.round(weekHours / weekTarget * 100));
  const weekColor = weekHours >= weekTarget ? 'var(--green)' : weekHours >= weekTarget * 0.5 ? 'var(--blue)' : 'var(--amber)';

  return `
    <div class="study-hero">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div class="dash-hero-eyebrow">This Week</div>
          <div class="big-number" style="text-align:left">${weekHours.toFixed(1)}<span style="font-size:16px;color:var(--dim)">h</span></div>
          <div style="font-size:11px;color:var(--muted)">Target: ${weekTarget}h · Min: 6h</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:var(--dim)">This month</div>
          <div style="font-size:20px;font-weight:700">${monthHours.toFixed(1)}h</div>
        </div>
      </div>
      ${progressBarHTML(weekPct, weekColor, '6px')}
      <div class="study-week">${weekHTML}</div>
      <div style="font-size:10px;color:var(--dim);margin-top:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Last 30 days</div>
      <div class="study-chart">${chartSvg}</div>
    </div>
    <div class="card">
      <div class="log-header">
        <span style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em">Study log</span>
        <button class="btn btn-primary btn-sm" onclick="toggleStudyForm()">${state.showStudyForm ? 'Cancel' : '+ Log time'}</button>
      </div>
      ${formHTML}
      ${recentHTML}
    </div>`;
}

function toggleStudyForm() {
  state.showStudyForm = !state.showStudyForm;
  if (!state.showStudyForm) state.studyForm = { date: today(), hours: '', type: 'study', certId: '', desc: '' };
  rerenderCurrentTab();
}
function updateStudyForm(field, value) {
  state.studyForm[field] = value;
  const btn = document.querySelector('.study-form .btn-primary');
  if (btn) btn.disabled = !state.studyForm.date || !state.studyForm.hours;
}
function submitStudy() {
  if (!state.studyForm.date || !state.studyForm.hours) return;
  state.studyLog.push({
    id: Date.now().toString(),
    date: state.studyForm.date,
    hours: parseFloat(state.studyForm.hours),
    type: state.studyForm.type,
    certId: state.studyForm.certId || null,
    desc: state.studyForm.desc,
  });
  save.study();
  state.showStudyForm = false;
  state.studyForm = { date: today(), hours: '', type: 'study', certId: '', desc: '' };
  rerenderCurrentTab();
  showToast('Logged');
}
function deleteStudy(id) {
  state.studyLog = state.studyLog.filter(s => s.id !== id);
  save.study();
  rerenderCurrentTab();
}

// ───── CPE ────────────────────────────────────────────────────────────────
function renderCPE() {
  const cpeCerts = CERTS.filter(c => c.cpe > 0);
  const cards = cpeCerts.map(cert => {
    const earned = certCpeEarned(cert.id);
    const pct = Math.min(100, Math.round(earned / cert.cpe * 100));
    const isPassed = !!state.passes[cert.id];
    const { status, days } = expiryInfo(cert, state.passes[cert.id]);
    const approaching = isPassed && ['WARN', 'URGENT'].includes(status) && earned < cert.cpe;
    const cardClass = !isPassed ? 'not-passed' : approaching ? 'approaching' : pct >= 100 ? 'complete' : '';
    const numClass = pct >= 100 ? 'done' : pct > 50 ? 'mid' : 'low';
    const color = pct >= 100 ? 'var(--green)' : pct > 50 ? 'var(--blue)' : 'var(--amber)';
    return `
      <div class="cpe-card ${cardClass}">
        <div class="cpe-card-top">
          <div class="cpe-card-name">${escape(cert.name)}<br><span style="font-size:9px;color:var(--dim);font-weight:500">${TRACK_INFO[cert.track].label} · ${cert.cpePeriod}mo cycle</span></div>
          <div>
            <div class="cpe-big ${numClass}">${earned}</div>
            <div class="cpe-of">of ${cert.cpe}</div>
          </div>
        </div>
        ${progressBarHTML(pct, color, '6px')}
        <div class="cpe-bottom">
          <span class="cpe-needed">${cert.cpe - earned > 0 ? `${cert.cpe - earned} needed` : 'Complete ✓'}</span>
          ${isPassed && status !== 'NEVER' && status !== 'NOEXP' ? statusBadgeHTML(status, days) : ''}
        </div>
        ${approaching ? `<div class="cpe-warn">⚠ Renewal approaching — log CPE now</div>` : ''}
        ${!isPassed ? `<div style="font-size:9px;color:var(--dim);margin-top:4px">Not yet passed</div>` : ''}
      </div>`;
  }).join('');

  const filtered = state.cpeFilter ? state.activities.filter(a => a.certId === state.cpeFilter) : state.activities;
  const total = filtered.reduce((s, a) => s + (a.credits || 0), 0);

  const formHTML = state.showCPEForm ? `
    <div class="log-form">
      <div class="form-grid">
        <div class="full">
          <label class="form-label">Certification *</label>
          <select class="form-input" onchange="updateCPEForm('certId', this.value)">
            <option value="">Select...</option>
            ${cpeCerts.map(c => `<option value="${c.id}" ${state.cpeForm.certId === c.id ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">Date *</label>
          <input type="date" class="form-input" value="${escape(state.cpeForm.date)}" onchange="updateCPEForm('date', this.value)">
        </div>
        <div>
          <label class="form-label">Credits *</label>
          <input type="number" step="0.5" min="0" class="form-input" value="${escape(state.cpeForm.credits)}" placeholder="e.g. 1" oninput="updateCPEForm('credits', this.value)">
        </div>
        <div class="full">
          <label class="form-label">Activity</label>
          <input type="text" class="form-input" value="${escape(state.cpeForm.desc)}" placeholder="e.g. BSides Liverpool" oninput="updateCPEForm('desc', this.value)">
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" onclick="submitCPE()" ${!state.cpeForm.certId || !state.cpeForm.date || !state.cpeForm.credits ? 'disabled' : ''}>Save</button>
        <button class="btn btn-secondary" onclick="toggleCPEForm()">Cancel</button>
      </div>
    </div>` : '';

  const tableRows = filtered.length === 0
    ? `<div class="empty">No CPE activities logged yet.</div>`
    : `<div style="overflow-x:auto">
        <table class="log-table">
          <thead><tr><th>Date</th><th>Cert</th><th>Activity</th><th class="right">Credits</th><th></th></tr></thead>
          <tbody>
            ${filtered.map(a => {
              const cert = cpeCerts.find(c => c.id === a.certId);
              return `<tr>
                <td style="white-space:nowrap">${fmt(a.date)}</td>
                <td>${cert ? escape(cert.code || cert.name) : '—'}</td>
                <td>${escape(a.desc || '—')}</td>
                <td class="right credit">+${a.credits}</td>
                <td><button class="del-btn" onclick="deleteCPE('${a.id}')">×</button></td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="3" style="color:var(--muted);font-weight:600">${state.cpeFilter ? `Total — ${escape(cpeCerts.find(c => c.id === state.cpeFilter)?.name || '')}` : 'Total'}</td>
            <td class="right credit" style="font-size:13px;font-weight:900">+${total}</td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>`;

  return `
    <div class="cpe-grid">${cards}</div>
    <div class="card">
      <div class="log-header">
        <span style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em">CPE Activity Log</span>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select class="form-input" style="font-size:11px;padding:5px 8px;width:auto" onchange="setCPEFilter(this.value)">
            <option value="">All certs</option>
            ${cpeCerts.map(c => `<option value="${c.id}" ${state.cpeFilter === c.id ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" onclick="toggleCPEForm()">${state.showCPEForm ? 'Cancel' : '+ Log CPE'}</button>
        </div>
      </div>
      ${formHTML}
      ${tableRows}
    </div>`;
}

function toggleCPEForm() {
  state.showCPEForm = !state.showCPEForm;
  if (!state.showCPEForm) state.cpeForm = { certId: '', date: today(), desc: '', credits: '' };
  rerenderCurrentTab();
}
function updateCPEForm(field, value) {
  state.cpeForm[field] = value;
  const btn = document.querySelector('.log-form .btn-primary');
  if (btn) btn.disabled = !state.cpeForm.certId || !state.cpeForm.date || !state.cpeForm.credits;
}
function submitCPE() {
  if (!state.cpeForm.certId || !state.cpeForm.date || !state.cpeForm.credits) return;
  state.activities.push({
    id: Date.now().toString(),
    certId: state.cpeForm.certId,
    date: state.cpeForm.date,
    desc: state.cpeForm.desc,
    credits: parseFloat(state.cpeForm.credits) || 0,
  });
  state.activities.sort((a, b) => b.date.localeCompare(a.date));
  save.cpe();
  state.showCPEForm = false;
  state.cpeForm = { certId: '', date: today(), desc: '', credits: '' };
  rerenderCurrentTab();
}
function deleteCPE(id) {
  state.activities = state.activities.filter(a => a.id !== id);
  save.cpe();
  rerenderCurrentTab();
}
function setCPEFilter(v) { state.cpeFilter = v; rerenderCurrentTab(); }

// ───── EXPORTS ────────────────────────────────────────────────────────────
function exportICS() {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CertTracker//Alex Taylor//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  let count = 0;
  CERTS.forEach(cert => {
    const ed = state.exams[cert.id];
    if (!ed) return;
    const d = new Date(ed).toISOString().replace(/[-:]/g, '').split('.')[0].slice(0, 8);
    lines.push('BEGIN:VEVENT', `UID:cert-${cert.id}-exam@certtracker`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d}`,
      `SUMMARY:📝 EXAM: ${cert.name}`, `DESCRIPTION:${cert.name} exam day.`,
      'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', `DESCRIPTION:⚠ ${cert.name} exam in 7 days`, 'END:VALARM',
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:⚠ ${cert.name} exam tomorrow`, 'END:VALARM',
      'END:VEVENT');
    count++;
  });
  CERTS.forEach(cert => {
    const pd = state.passes[cert.id];
    if (!pd || !cert.validity) return;
    const expiry = addMonths(pd, cert.validity);
    const d = expiry.toISOString().replace(/[-:]/g, '').split('.')[0].slice(0, 8);
    lines.push('BEGIN:VEVENT', `UID:cert-${cert.id}-expiry@certtracker`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d}`,
      `SUMMARY:🔴 EXPIRES: ${cert.name}`, `DESCRIPTION:${cert.name} expires today.`,
      'BEGIN:VALARM', 'TRIGGER:-P90D', 'ACTION:DISPLAY', `DESCRIPTION:⚠ ${cert.name} expires in 90 days`, 'END:VALARM',
      'BEGIN:VALARM', 'TRIGGER:-P30D', 'ACTION:DISPLAY', `DESCRIPTION:⚠ ${cert.name} expires in 30 days`, 'END:VALARM',
      'END:VEVENT');
    count++;
  });
  lines.push('END:VCALENDAR');
  if (count === 0) { showToast('No dates to export'); return; }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cert-tracker-calendar.ics';
  a.click();
  showToast(`Exported ${count} events`);
}

function exportJSON() {
  const data = {
    version: 2,
    exported: new Date().toISOString(),
    passes: state.passes,
    exams: state.exams,
    activities: state.activities,
    notes: state.notes,
    gates: state.gates,
    studyLog: state.studyLog,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cert-tracker-backup-${today()}.json`;
  a.click();
  showToast('Backup downloaded');
}

function exportCV() {
  // Generate CV-ready markdown grouping passed certs by CV-friendly domain.
  // Vendor-agnostic groupings that hiring managers actually scan for.
  const passed = CERTS.filter(c => state.passes[c.id]);
  if (passed.length === 0) {
    showToast('No passed certs yet — pass some first');
    return;
  }

  const groupOf = c => {
    const id = c.id, code = (c.code || '').toUpperCase();
    if (id === 'cissp' || id === 'cism' || id.includes('ukcsc') || id === 'aigp' || id === 'aaism' || id === 'caisp') return 'Security · Governance & Management';
    if (id.includes('security-plus') || id.includes('cysa') || id.includes('secai') || id.includes('sc-') || id === 'ccsp' || code.startsWith('SC-')) return 'Security · Cloud, Identity & Operations';
    if (id.includes('htb') || id.includes('thm') || id === 'oscp') return 'Security · Defensive & Offensive Practical';
    if (id.includes('cka') || id.includes('cks')) return 'Cloud · Containers';
    if (code.startsWith('AZ-') || id === 'ai-901' || code === 'TA-004' || id === 'saa-c03') return 'Cloud · Azure & Multi-cloud';
    if (id === 'ms-721' || id === 'md-102' || id === 'ab-900' || id === 'sc-900' || id === 'az-900') return 'Cloud · Microsoft Fundamentals & M365';
    if (id === 'network-plus' || id === 'ccna' || id === 'cmss' || id === 'a-plus' || id === 'linux-plus') return 'Foundations · IT & Networking';
    if (id === 'acp' || id.startsWith('mc') || id.startsWith('lc') || id.includes('paxton') || id.includes('honeywell') || id.includes('elements') || id.includes('netbox')) return 'Physical Security · VMS, Access Control & Cameras';
    if (id === 'pcep' || id === 'pcap') return 'Programming · Python';
    return 'Other';
  };

  // Group order matters — most senior signals first
  const groupOrder = [
    'Security · Governance & Management',
    'Security · Cloud, Identity & Operations',
    'Security · Defensive & Offensive Practical',
    'Cloud · Azure & Multi-cloud',
    'Cloud · Containers',
    'Cloud · Microsoft Fundamentals & M365',
    'Physical Security · VMS, Access Control & Cameras',
    'Foundations · IT & Networking',
    'Programming · Python',
    'Other',
  ];

  const grouped = {};
  passed.forEach(c => {
    const g = groupOf(c);
    (grouped[g] = grouped[g] || []).push(c);
  });

  // Sort each group: gateway first, then by ROI desc
  Object.keys(grouped).forEach(g => {
    grouped[g].sort((a, b) => (b.gateway ? 1 : 0) - (a.gateway ? 1 : 0) || (b.roi || 0) - (a.roi || 0));
  });

  let md = `# Certifications\n\n_Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} from cert tracker · ${passed.length} certs held_\n\n`;

  groupOrder.forEach(g => {
    if (!grouped[g] || !grouped[g].length) return;
    md += `## ${g}\n\n`;
    grouped[g].forEach(c => {
      const passDate = state.passes[c.id];
      const dateStr = passDate ? new Date(passDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
      const codePart = c.code ? ` (${c.code})` : '';
      md += `- **${c.name}**${codePart}${dateStr ? ` — ${dateStr}` : ''}\n`;
    });
    md += '\n';
  });

  // Strip trailing whitespace
  md = md.replace(/\n+$/, '\n');

  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `certifications-${today()}.md`;
  a.click();
  showToast(`Exported ${passed.length} certs to markdown`);
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.version || !data.passes) throw new Error();
        state.passes     = data.passes || {};
        state.exams      = data.exams || {};
        state.activities = data.activities || [];
        state.notes      = data.notes || {};
        state.gates      = data.gates || {};
        state.studyLog   = data.studyLog || [];
        save.passes(); save.exams(); save.cpe(); save.notes(); save.gates(); save.study();
        renderApp();
        showToast('Backup restored');
      } catch {
        showToast('Error: invalid backup');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ───── INIT ───────────────────────────────────────────────────────────────
loadState();
renderApp();
checkAndNotify();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
