/**
 * BÉNIN CONNECT — MODULE JDS PARTENAIRES & SERVICES COMMUNAUTAIRES
 * Connecté à la base de données unique Supabase (ftgdgigvxjekpevujbdi.supabase.co)
 * Synchronisé en temps réel avec Marché d'Aujourd'hui via les tables jds_* et le bus Cloud (__JDS_CLOUD_V1__: / __REFERRAL__:)
 * Gère :
 *  1. Portail de connexion JDS PARTENAIRES (Brand Ambassadors, Superviseurs BA, Influenceurs)
 *  2. Tableaux de bord complets par rôle (Superviseur BA, BA, Influenceur)
 *  3. Recrutement BA par le Superviseur avec client Supabase secondaire isolé + persistance Cloud garantie
 *  4. Attribution des codes partenaires et synchronisation inter-domaines (benin-connect.com <-> marche.benin-connect.com)
 */

(function () {
  const SUPABASE_URL = 'https://ftgdgigvxjekpevujbdi.supabase.co';
  const JDS_CLOUD_PREFIX = '__JDS_CLOUD_V1__:';
  const JDS_STORAGE_KEY = 'bc_jds_partner_state_v1';
  const FALLBACK_SYSTEM_ANCHOR_ID = '9a36b08d-4eef-4445-a055-558120665790';
  let cachedAnchorId = null;

  function getSb() {
    return window.sb;
  }

  function createIsolatedClient() {
    if (!window.supabase || !window.BC_SUPABASE_KEY) return null;
    return window.supabase.createClient(SUPABASE_URL, window.BC_SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'jds-isolated-' + Date.now()
      }
    });
  }

  async function sha256Hex(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(String(text || '').trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function sha256Salted(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode('jds_salt_v1_' + String(text || '').trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizePhone(phone) {
    return String(phone || '').replace(/[^0-9+]/g, '');
  }

  function cleanPrefix(name) {
    const first = String(name || 'PARTENAIRE')
      .trim()
      .split(/\s+/)[0]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
    return (first || 'JDS').slice(0, 10);
  }

  function buildPartnerShareLink(partnerCode) {
    const cleanCode = String(partnerCode || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    return `https://marche.benin-connect.com/?ref=${encodeURIComponent(cleanCode)}`;
  }

  function isPartnerActive(status) {
    const s = String(status || 'actif').toLowerCase();
    return s === 'actif' || s === 'active';
  }

  function isPartnerSuspended(status) {
    const s = String(status || '').toLowerCase();
    return s === 'suspendu' || s === 'suspended';
  }

  function isPartnerInactive(status) {
    const s = String(status || '').toLowerCase();
    return s === 'inactif' || s === 'inactive';
  }

  async function resolveAnchorId() {
    if (cachedAnchorId) return cachedAnchorId;
    const sb = getSb();
    try {
      if (window.currentUser?.id) {
        cachedAnchorId = window.currentUser.id;
        return cachedAnchorId;
      }
      if (sb) {
        const { data: firstProf } = await sb.from('profiles').select('id').limit(1).maybeSingle();
        if (firstProf?.id) {
          cachedAnchorId = firstProf.id;
          return cachedAnchorId;
        }
      }
    } catch (e) {}
    cachedAnchorId = FALLBACK_SYSTEM_ANCHOR_ID;
    return cachedAnchorId;
  }

  async function pushJdsCloudEvent(eventType, payload) {
    const sb = getSb();
    if (!sb) return;
    try {
      const envelope = JSON.stringify({
        type: eventType,
        payload,
        ts: new Date().toISOString()
      });
      const commentText = `${JDS_CLOUD_PREFIX}${envelope}`;
      const anchorId = await resolveAnchorId();
      const { error } = await sb.from('reviews').insert([
        {
          vendor_id: null,
          reviewer_id: anchorId,
          comment: commentText,
          rating: 5
        }
      ]);
      if (error) {
        await sb.from('reviews').insert([
          {
            vendor_id: FALLBACK_SYSTEM_ANCHOR_ID,
            reviewer_id: FALLBACK_SYSTEM_ANCHOR_ID,
            comment: commentText,
            rating: 5
          }
        ]);
      }
    } catch (e) {}
  }

  async function getDefaultDemoState() {
    const defaultPassHash = await sha256Salted('Jds2026!');
    const now = new Date();
    const daysAgo = (n) => {
      const d = new Date(now);
      d.setDate(now.getDate() - n);
      return d.toISOString();
    };
    const sup1Id = 'jds-sup-cotonou-01';
    const sup2Id = 'jds-sup-parakou-02';
    const ba1Id = 'jds-ba-koffi-01';
    const ba2Id = 'jds-ba-marcel-02';
    const ba3Id = 'jds-ba-grace-03';
    const ba4Id = 'jds-ba-ulrich-04';
    const inf1Id = 'jds-inf-tiktok-01';
    const inf2Id = 'jds-inf-insta-02';

    return {
      partners: [
        {
          id: sup1Id,
          user_id: null,
          username: 'sylvain.sup01',
          first_name: 'Sylvain',
          last_name: 'Hounkpatin',
          full_name: 'Sylvain Hounkpatin',
          phone: '2290197001101',
          email: 'sylvain.sup01@jds.benin-connect.com',
          role: 'ba_supervisor',
          partner_code: 'SYLVAIN-JDSSUP01',
          referral_link: buildPartnerShareLink('SYLVAIN-JDSSUP01'),
          region: 'Littoral (Cotonou)',
          city: 'Cotonou',
          supervisor_id: null,
          regional_admin_id: 'reg-admin-littoral',
          status: 'actif',
          password_hash: defaultPassHash,
          recruited_at: daysAgo(30),
          last_activity_at: daysAgo(0),
          created_at: daysAgo(30)
        },
        {
          id: sup2Id,
          user_id: null,
          username: 'nadia.sup02',
          first_name: 'Nadia',
          last_name: 'Bio Tchané',
          full_name: 'Nadia Bio Tchané',
          phone: '2290197002202',
          email: 'nadia.sup02@jds.benin-connect.com',
          role: 'ba_supervisor',
          partner_code: 'NADIA-JDSSUP02',
          referral_link: buildPartnerShareLink('NADIA-JDSSUP02'),
          region: 'Borgou (Parakou)',
          city: 'Parakou',
          supervisor_id: null,
          regional_admin_id: 'reg-admin-borgou',
          status: 'actif',
          password_hash: defaultPassHash,
          recruited_at: daysAgo(25),
          last_activity_at: daysAgo(0),
          created_at: daysAgo(25)
        },
        {
          id: ba1Id,
          user_id: null,
          username: 'koffi.ba01',
          first_name: 'Koffi',
          last_name: 'Adéoti',
          full_name: 'Koffi Adéoti',
          phone: '2290196110001',
          email: 'koffi.ba01@jds.benin-connect.com',
          role: 'brand_ambassador',
          partner_code: 'KOFFI-JDSBA01',
          referral_link: buildPartnerShareLink('KOFFI-JDSBA01'),
          region: 'Littoral (Cotonou)',
          city: 'Cotonou (Dantokpa)',
          supervisor_id: sup1Id,
          regional_admin_id: 'reg-admin-littoral',
          status: 'actif',
          password_hash: defaultPassHash,
          recruited_at: daysAgo(20),
          last_activity_at: daysAgo(0),
          created_at: daysAgo(20)
        },
        {
          id: ba2Id,
          user_id: null,
          username: 'marcel.ba02',
          first_name: 'Marcel',
          last_name: 'Dossou',
          full_name: 'Marcel Dossou',
          phone: '2290196110002',
          email: 'marcel.ba02@jds.benin-connect.com',
          role: 'brand_ambassador',
          partner_code: 'MARCEL-JDSBA02',
          referral_link: buildPartnerShareLink('MARCEL-JDSBA02'),
          region: 'Littoral (Cotonou)',
          city: 'Cotonou (Akpakpa)',
          supervisor_id: sup1Id,
          regional_admin_id: 'reg-admin-littoral',
          status: 'actif',
          password_hash: defaultPassHash,
          recruited_at: daysAgo(18),
          last_activity_at: daysAgo(1),
          created_at: daysAgo(18)
        },
        {
          id: ba3Id,
          user_id: null,
          username: 'grace.ba03',
          first_name: 'Grace',
          last_name: 'Soglo',
          full_name: 'Grace Soglo',
          phone: '2290196110003',
          email: 'grace.ba03@jds.benin-connect.com',
          role: 'brand_ambassador',
          partner_code: 'GRACE-JDSBA03',
          referral_link: buildPartnerShareLink('GRACE-JDSBA03'),
          region: 'Littoral (Cotonou)',
          city: 'Cotonou (Fidjrossè)',
          supervisor_id: sup1Id,
          regional_admin_id: 'reg-admin-littoral',
          status: 'inactif',
          password_hash: defaultPassHash,
          recruited_at: daysAgo(6),
          last_activity_at: daysAgo(5),
          created_at: daysAgo(6)
        },
        {
          id: ba4Id,
          user_id: null,
          username: 'ulrich.ba04',
          first_name: 'Ulrich',
          last_name: 'Yarou',
          full_name: 'Ulrich Yarou',
          phone: '2290196110004',
          email: 'ulrich.ba04@jds.benin-connect.com',
          role: 'brand_ambassador',
          partner_code: 'ULRICH-JDSBA04',
          referral_link: buildPartnerShareLink('ULRICH-JDSBA04'),
          region: 'Borgou (Parakou)',
          city: 'Parakou (Marché Arzeke)',
          supervisor_id: sup2Id,
          regional_admin_id: 'reg-admin-borgou',
          status: 'actif',
          password_hash: defaultPassHash,
          recruited_at: daysAgo(15),
          last_activity_at: daysAgo(0),
          created_at: daysAgo(15)
        },
        {
          id: inf1Id,
          user_id: null,
          username: 'tiktok.inf01',
          first_name: 'TikTok',
          last_name: 'Créateur Bénin',
          full_name: 'TikTok Créateur Bénin',
          phone: '2290195001101',
          email: 'tiktok.inf01@jds.benin-connect.com',
          role: 'influencer',
          partner_code: 'TIKTOK-JDS01',
          referral_link: buildPartnerShareLink('TIKTOK-JDS01'),
          region: 'Littoral (Cotonou)',
          city: 'Cotonou',
          supervisor_id: null,
          regional_admin_id: 'reg-admin-littoral',
          campaign_id: 'camp-rentree-jds',
          status: 'actif',
          password_hash: defaultPassHash,
          recruited_at: daysAgo(22),
          last_activity_at: daysAgo(0),
          created_at: daysAgo(22)
        },
        {
          id: inf2Id,
          user_id: null,
          username: 'kemi.inf02',
          first_name: 'Kémi',
          last_name: 'Influence Nord',
          full_name: 'Kémi Influence Nord',
          phone: '2290195002202',
          email: 'kemi.inf02@jds.benin-connect.com',
          role: 'influencer',
          partner_code: 'KEMI-JDS02',
          referral_link: buildPartnerShareLink('KEMI-JDS02'),
          region: 'Borgou (Parakou)',
          city: 'Parakou',
          supervisor_id: null,
          regional_admin_id: 'reg-admin-borgou',
          campaign_id: 'camp-rentree-jds',
          status: 'actif',
          password_hash: defaultPassHash,
          recruited_at: daysAgo(14),
          last_activity_at: daysAgo(1),
          created_at: daysAgo(14)
        }
      ],
      referrals: [],
      commissions: [],
      payouts: []
    };
  }

  async function syncJdsStateFromCloud() {
    let state = await getDefaultDemoState();
    try {
      const raw = localStorage.getItem(JDS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.partners)) {
          const map = new Map(state.partners.map(p => [p.id, p]));
          parsed.partners.forEach(p => {
            if (p && p.id) map.set(p.id, { ...(map.get(p.id) || {}), ...p });
          });
          state.partners = Array.from(map.values());
        }
        if (Array.isArray(parsed.referrals)) state.referrals = parsed.referrals;
        if (Array.isArray(parsed.commissions)) state.commissions = parsed.commissions;
        if (Array.isArray(parsed.payouts)) state.payouts = parsed.payouts;
      }
    } catch (e) {}

    const sb = getSb();
    if (!sb) return state;

    // 1. Tenter de lire les tables SQL jds_* si elles existent (sans jamais lever d'erreur bloquante)
    try {
      const [pRes, rRes, cRes, payRes] = await Promise.all([
        sb.from('jds_partners').select('*'),
        sb.from('jds_partner_referrals').select('*'),
        sb.from('jds_partner_commissions').select('*'),
        sb.from('jds_partner_payouts').select('*')
      ]);
      if (!pRes.error && Array.isArray(pRes.data)) {
        pRes.data.forEach(p => {
          const idx = state.partners.findIndex(x => x.id === p.id || (p.partner_code && x.partner_code === p.partner_code));
          if (idx >= 0) state.partners[idx] = { ...state.partners[idx], ...p };
          else state.partners.unshift(p);
        });
      }
      if (!rRes.error && Array.isArray(rRes.data)) {
        rRes.data.forEach(r => {
          const idx = state.referrals.findIndex(x => x.id === r.id || x.referred_user_id === r.referred_user_id);
          if (idx >= 0) state.referrals[idx] = { ...state.referrals[idx], ...r };
          else state.referrals.unshift(r);
        });
      }
      if (!cRes.error && Array.isArray(cRes.data)) {
        cRes.data.forEach(c => {
          const idx = state.commissions.findIndex(x => x.id === c.id || (c.source_transaction_key && x.source_transaction_key === c.source_transaction_key));
          if (idx >= 0) state.commissions[idx] = { ...state.commissions[idx], ...c };
          else state.commissions.unshift(c);
        });
      }
      if (!payRes.error && Array.isArray(payRes.data)) {
        payRes.data.forEach(pay => {
          const idx = state.payouts.findIndex(x => x.id === pay.id);
          if (idx >= 0) state.payouts[idx] = { ...state.payouts[idx], ...pay };
          else state.payouts.unshift(pay);
        });
      }
    } catch (e) {}

    // 2. Lire le bus Cloud temps réel __JDS_CLOUD_V1__: dans public.reviews
    try {
      const { data: cloudEvents } = await sb
        .from('reviews')
        .select('comment, created_at')
        .like('comment', `${JDS_CLOUD_PREFIX}%`)
        .order('created_at', { ascending: true })
        .limit(400);

      if (Array.isArray(cloudEvents)) {
        cloudEvents.forEach(row => {
          try {
            const evt = JSON.parse(row.comment.slice(JDS_CLOUD_PREFIX.length));
            if (!evt || !evt.type || !evt.payload) return;
            if (evt.type === 'UPSERT_PARTNER') {
              const p = evt.payload;
              const idx = state.partners.findIndex(
                item => item.id === p.id || (p.partner_code && String(item.partner_code).toUpperCase() === String(p.partner_code).toUpperCase())
              );
              if (idx >= 0) state.partners[idx] = { ...state.partners[idx], ...p };
              else state.partners.unshift(p);
            } else if (evt.type === 'UPSERT_REFERRAL') {
              const r = evt.payload;
              const idx = state.referrals.findIndex(
                item => item.id === r.id || item.referred_user_id === r.referred_user_id
              );
              if (idx >= 0) state.referrals[idx] = { ...state.referrals[idx], ...r };
              else state.referrals.unshift(r);
            } else if (evt.type === 'UPSERT_COMMISSION') {
              const c = evt.payload;
              const idx = state.commissions.findIndex(
                item => item.id === c.id || (c.source_transaction_key && item.source_transaction_key === c.source_transaction_key)
              );
              if (idx >= 0) state.commissions[idx] = { ...state.commissions[idx], ...c };
              else state.commissions.unshift(c);
            } else if (evt.type === 'UPSERT_PAYOUT') {
              const pay = evt.payload;
              const idx = state.payouts.findIndex(item => item.id === pay.id);
              if (idx >= 0) state.payouts[idx] = { ...state.payouts[idx], ...pay };
              else state.payouts.unshift(pay);
            }
          } catch (err) {}
        });
      }
    } catch (e) {}

    // 3. Lire également les inscriptions issues de __REFERRAL__: dans public.reviews
    try {
      const { data: refRows } = await sb
        .from('reviews')
        .select('comment, created_at')
        .like('comment', '__REFERRAL__:%')
        .order('created_at', { ascending: false })
        .limit(300);

      if (Array.isArray(refRows) && state.partners.length > 0) {
        const partnerByCode = new Map();
        state.partners.forEach(p => {
          if (p?.partner_code) partnerByCode.set(String(p.partner_code).toUpperCase(), p);
        });
        refRows.forEach(row => {
          try {
            const parsed = JSON.parse(row.comment.slice('__REFERRAL__:'.length));
            const code = String(parsed?.referrerCode || '').trim().toUpperCase();
            const partner = partnerByCode.get(code);
            if (!partner || !parsed?.referredId) return;
            const exists = state.referrals.some(r => r.referred_user_id === parsed.referredId);
            if (!exists) {
              state.referrals.unshift({
                id: `ref-cloud-${parsed.referredId}`,
                referred_user_id: parsed.referredId,
                referred_name: parsed.referredName || 'Utilisateur Bénin Connect',
                referred_phone: '',
                referred_email: parsed.referredEmail || '',
                referred_user_type: parsed.referredRole === 'client' || parsed.referredRole === 'buyer' ? 'buyer' : 'vendor',
                partner_id: partner.id,
                partner_name: partner.full_name,
                partner_code: partner.partner_code,
                partner_role: partner.role,
                supervisor_id: partner.supervisor_id || null,
                regional_admin_id: partner.regional_admin_id || null,
                region: partner.region,
                city: partner.city || partner.region,
                has_paid: false,
                registered_at: parsed.date || row.created_at || new Date().toISOString()
              });
            }
          } catch (e) {}
        });
      }
    } catch (e) {}

    try {
      localStorage.setItem(JDS_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}

    return state;
  }

  // État courant du portail partenaire
  let currentPartner = null;
  let supervisorTab = 'overview';
  let cachedCloudState = null;

  // Génère un code unique au format MARCEL-JDSBA01 / TIKTOK-JDS01
  async function generatePartnerCode(fullName, role) {
    const state = await syncJdsStateFromCloud();
    const prefix = cleanPrefix(fullName);
    const tag = role === 'influencer' ? 'JDS' : role === 'ba_supervisor' ? 'JDSSUP' : 'JDSBA';
    const existingCodes = new Set(state.partners.map(p => String(p.partner_code || '').toUpperCase()));
    let seq = state.partners.filter(p => p.role === role).length + 1;
    let candidate = `${prefix}-${tag}${String(seq).padStart(2, '0')}`;
    while (existingCodes.has(candidate)) {
      seq += 1;
      candidate = `${prefix}-${tag}${String(seq).padStart(2, '0')}`;
    }
    return candidate;
  }

  // Applique un code partenaire lors d'une inscription sur Bénin Connect
  window.applyJdsReferralOnSignup = async function (rawCode, newUser) {
    const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!code || !newUser || !newUser.id) return null;
    try {
      const state = await syncJdsStateFromCloud();
      const existingRef = state.referrals.find(r => r.referred_user_id === newUser.id);
      if (existingRef) return existingRef;

      const partner = state.partners.find(
        p => String(p.partner_code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '') === code
      );
      if (!partner || isPartnerSuspended(partner.status)) return null;
      if (partner.user_id && String(partner.user_id) === String(newUser.id)) return null;

      const userType = newUser.role || 'client';
      const isVendor = ['vendeur', 'prestataire', 'revendeur', 'vendor'].includes(String(userType).toLowerCase());
      const nowIso = new Date().toISOString();

      const newReferral = {
        id: 'ref-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        referred_user_id: newUser.id,
        referred_name: newUser.full_name || newUser.email || 'Utilisateur Bénin Connect',
        referred_phone: newUser.phone || '',
        referred_email: newUser.email || '',
        referred_user_type: isVendor ? 'vendor' : 'buyer',
        partner_id: partner.id,
        partner_name: partner.full_name,
        partner_code: partner.partner_code,
        partner_role: partner.role,
        supervisor_id: partner.supervisor_id || null,
        regional_admin_id: partner.regional_admin_id || null,
        region: partner.region || 'Littoral (Cotonou)',
        city: newUser.city || partner.city || 'Cotonou',
        has_paid: false,
        is_locked: true,
        registered_at: nowIso
      };

      state.referrals.unshift(newReferral);
      try {
        localStorage.setItem(JDS_STORAGE_KEY, JSON.stringify(state));
      } catch (e) {}

      await pushJdsCloudEvent('UPSERT_REFERRAL', newReferral);
      return partner;
    } catch (err) {
      console.warn('Info code partenaire:', err);
      return null;
    }
  };

  // Ouvrir le portail JDS PARTENAIRES
  window.openJdsPartnerPortal = async function () {
    if (window.trackBcEvent) window.trackBcEvent('partner_portal_open', 'espace_partenaires');
    const modal = document.getElementById('jds-partner-modal');
    if (!modal) return;
    modal.classList.add('open');

    const savedPartnerId = sessionStorage.getItem('jds_active_partner_id');
    if (savedPartnerId) {
      const state = await syncJdsStateFromCloud();
      cachedCloudState = state;
      const p = state.partners.find(x => x.id === savedPartnerId);
      if (p && !isPartnerSuspended(p.status)) {
        currentPartner = p;
        await renderPartnerDashboard();
        return;
      }
    }

    if (window.currentUser) {
      const state = await syncJdsStateFromCloud();
      cachedCloudState = state;
      const p = state.partners.find(
        x => x.user_id === window.currentUser.id || (x.email && String(x.email).toLowerCase() === String(window.currentUser.email || '').toLowerCase())
      );
      if (p && !isPartnerSuspended(p.status)) {
        currentPartner = p;
        sessionStorage.setItem('jds_active_partner_id', p.id);
        await renderPartnerDashboard();
        return;
      }
    }

    renderPartnerLoginView();
  };

  function renderPartnerLoginView(errorMsg = '') {
    const container = document.getElementById('jds-portal-body');
    if (!container) return;

    container.innerHTML = `
      <div style="max-width:460px; margin:0 auto; padding:8px 4px;">
        <div style="text-align:center; margin-bottom:22px;">
          <span style="display:inline-flex; align-items:center; gap:6px; background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe; padding:5px 14px; border-radius:99px; font-size:12px; font-weight:700;">
            🤝 JDS PARTENAIRES • BÉNIN CONNECT
          </span>
          <h3 style="font-size:22px; font-weight:900; color:#0f172a; margin-top:10px;">Connexion Espace Partenaires</h3>
          <p style="font-size:13px; color:#64748b; margin-top:4px;">
            Brand Ambassadors (BA), Superviseurs BA et Influenceurs partenaires : connectez-vous pour accéder automatiquement à votre tableau de bord.
          </p>
        </div>

        ${errorMsg ? `
          <div style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; padding:12px; border-radius:12px; font-size:13px; font-weight:600; margin-bottom:14px;">
            ⚠️ ${esc(errorMsg)}
          </div>
        ` : ''}

        <form onsubmit="event.preventDefault(); window.submitJdsPartnerLogin();" style="display:flex; flex-direction:column; gap:14px;">
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:#334155; margin-bottom:5px;">
              Identifiant partenaire, Code, Téléphone ou Email
            </label>
            <input id="jds-login-identifier" type="text" required class="bc-input" placeholder="Ex: KOFFI-JDSBA01, sylvain.sup01 ou +229 01..." />
          </div>
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:#334155; margin-bottom:5px;">
              Mot de passe
            </label>
            <input id="jds-login-password" type="password" required class="bc-input" placeholder="Votre mot de passe sécurisé" />
          </div>
          <button id="jds-login-submit" type="submit" class="btn bc-btn-violet" style="width:100%; justify-content:center; padding:13px; font-size:14px;">
            🔐 Se connecter à mon espace
          </button>
        </form>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; font-size:12px;">
          <button type="button" onclick="window.openJdsForgotPassword()" style="background:none; border:none; color:#6d28d9; font-weight:700; cursor:pointer;">
            Mot de passe oublié ?
          </button>
          <a href="https://marche.benin-connect.com" target="_blank" rel="noopener" style="color:#0f4c81; font-weight:700;">
            Admin Régional / Super Admin →
          </a>
        </div>

        <div style="margin-top:20px; padding:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; font-size:12px; color:#475569;">
          <div style="font-weight:800; color:#0f172a; margin-bottom:6px;">🎯 Rôles pris en charge automatiquement :</div>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; text-align:center; margin-top:8px;">
            <div style="background:white; padding:8px; border-radius:8px; border:1px solid #e2e8f0;">
              <div style="font-size:16px;">👔</div>
              <div style="font-weight:700; font-size:11px; color:#0f172a;">Superviseur BA</div>
            </div>
            <div style="background:white; padding:8px; border-radius:8px; border:1px solid #e2e8f0;">
              <div style="font-size:16px;">🎖️</div>
              <div style="font-weight:700; font-size:11px; color:#0f172a;">Brand Ambassador</div>
            </div>
            <div style="background:white; padding:8px; border-radius:8px; border:1px solid #e2e8f0;">
              <div style="font-size:16px;">🌟</div>
              <div style="font-weight:700; font-size:11px; color:#0f172a;">Influenceur</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  window.openJdsForgotPassword = function () {
    const idVal = document.getElementById('jds-login-identifier')?.value || '';
    const subject = 'Réinitialisation mot de passe — JDS Partenaires (Bénin Connect)';
    const body = `Bonjour Bénin Connect,\n\nJe souhaite réinitialiser mon mot de passe partenaire JDS.\nIdentifiant / Code : ${idVal || '(à préciser)'}`;
    window.location.href = `mailto:digitaljds34@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  window.submitJdsPartnerLogin = async function () {
    const rawId = (document.getElementById('jds-login-identifier')?.value || '').trim();
    const password = (document.getElementById('jds-login-password')?.value || '').trim();
    const btn = document.getElementById('jds-login-submit');
    if (!rawId || !password) return;

    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Vérification en cours...';
    }

    try {
      const state = await syncJdsStateFromCloud();
      cachedCloudState = state;
      const upper = rawId.toUpperCase();
      const lower = rawId.toLowerCase();
      const normPhone = normalizePhone(rawId);

      const partner = state.partners.find(p =>
        String(p.username || '').toLowerCase() === lower ||
        String(p.login_identifier || '').toLowerCase() === lower ||
        String(p.email || '').toLowerCase() === lower ||
        String(p.partner_code || '').toUpperCase() === upper ||
        (normPhone.length >= 8 && normalizePhone(p.phone).endsWith(normPhone.slice(-8)))
      );

      if (!partner) {
        renderPartnerLoginView('Aucun compte partenaire JDS trouvé avec cet identifiant, code ou numéro de téléphone.');
        return;
      }

      if (isPartnerSuspended(partner.status)) {
        renderPartnerLoginView('Votre compte partenaire est actuellement suspendu. Veuillez contacter votre superviseur ou votre administration régionale.');
        return;
      }

      const saltedHash = await sha256Salted(password);
      const unsaltedHash = await sha256Hex(password);
      let authenticated = false;

      if (
        partner.password_hash &&
        (partner.password_hash === saltedHash ||
          partner.password_hash === unsaltedHash ||
          partner.password_hash === password)
      ) {
        authenticated = true;
      }

      const sb = getSb();
      if (!authenticated && partner.email && sb) {
        try {
          const { data: authData, error: authErr } = await sb.auth.signInWithPassword({
            email: partner.email,
            password
          });
          if (!authErr && authData?.user) {
            authenticated = true;
          }
        } catch (e) {}
      }

      if (!authenticated) {
        renderPartnerLoginView('Mot de passe incorrect. Vérifiez vos identifiants ou cliquez sur « Mot de passe oublié ».');
        return;
      }

      partner.last_activity_at = new Date().toISOString();
      try {
        localStorage.setItem(JDS_STORAGE_KEY, JSON.stringify(state));
      } catch (e) {}

      currentPartner = partner;
      sessionStorage.setItem('jds_active_partner_id', partner.id);
      await renderPartnerDashboard();
    } catch (err) {
      renderPartnerLoginView(err.message || 'Erreur lors de la connexion au portail partenaire.');
    }
  };

  window.logoutJdsPartner = async function () {
    currentPartner = null;
    cachedCloudState = null;
    sessionStorage.removeItem('jds_active_partner_id');
    renderPartnerLoginView();
  };

  window.openChangePartnerPasswordModal = async function () {
    if (!currentPartner) return;
    const newPass = prompt('Entrez votre nouveau mot de passe partenaire (minimum 6 caractères) :');
    if (!newPass) return;
    if (newPass.trim().length < 6) {
      alert('⚠️ Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    const newHash = await sha256Salted(newPass.trim());
    currentPartner.password_hash = newHash;
    currentPartner.updated_at = new Date().toISOString();

    const state = cachedCloudState || (await syncJdsStateFromCloud());
    const idx = state.partners.findIndex(p => p.id === currentPartner.id);
    if (idx >= 0) state.partners[idx] = currentPartner;
    try {
      localStorage.setItem(JDS_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}

    await pushJdsCloudEvent('UPSERT_PARTNER', currentPartner);
    alert('✅ Votre mot de passe partenaire a été mis à jour et synchronisé avec succès !');
  };

  async function renderPartnerDashboard() {
    if (!currentPartner) {
      renderPartnerLoginView();
      return;
    }
    const role = currentPartner.role;
    if (role === 'ba_supervisor') {
      await renderSupervisorDashboard();
    } else if (role === 'influencer') {
      await renderInfluencerDashboard();
    } else {
      await renderBaDashboard();
    }
  }

  // ============================================================================
  // 1. TABLEAU DE BORD SUPERVISEUR BA
  // ============================================================================
  window.switchSupervisorTab = function (tab) {
    supervisorTab = tab;
    renderSupervisorDashboard(false);
  };

  async function renderSupervisorDashboard(reload = true) {
    const container = document.getElementById('jds-portal-body');
    if (!container || !currentPartner) return;

    if (reload || !cachedCloudState) {
      container.innerHTML = `<div style="padding:40px; text-align:center; color:#64748b;">⏳ Chargement du tableau de bord Superviseur BA...</div>`;
      cachedCloudState = await syncJdsStateFromCloud();
    }

    const bas = cachedCloudState.partners.filter(
      p => p.role === 'brand_ambassador' && p.supervisor_id === currentPartner.id
    );
    const baIds = new Set(bas.map(b => b.id));
    const referrals = cachedCloudState.referrals.filter(
      r => r.supervisor_id === currentPartner.id || baIds.has(r.partner_id) || r.partner_id === currentPartner.id
    );
    const commissions = cachedCloudState.commissions.filter(
      c => (c.supervisor_id === currentPartner.id || baIds.has(c.partner_id) || c.partner_id === currentPartner.id) &&
           c.status !== 'annulee' && c.status !== 'cancelled'
    );

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const totalBas = bas.length;
    const activeBas = bas.filter(b => isPartnerActive(b.status)).length;
    const inactiveBas = bas.filter(b => isPartnerInactive(b.status)).length;
    const suspendedBas = bas.filter(b => isPartnerSuspended(b.status)).length;

    const getRefDate = (r) => new Date(r.registered_at || r.created_at || now);
    const regsToday = referrals.filter(r => getRefDate(r) >= startOfDay).length;
    const regsWeek = referrals.filter(r => getRefDate(r) >= startOfWeek).length;
    const regsMonth = referrals.filter(r => getRefDate(r) >= startOfMonth).length;
    const vendorsReg = referrals.filter(r => r.referred_user_type === 'vendor' || r.is_vendor).length;
    const vendorsPaid = referrals.filter(r => r.has_paid).length;
    const subsValidated = commissions.filter(c => c.status === 'validee' || c.status === 'payee' || c.status === 'validated' || c.status === 'paid').length;
    const totalSales = commissions.reduce((s, c) => s + Number(c.sale_amount || 0), 0);
    const totalComms = commissions.reduce((s, c) => s + Number(c.commission_amount || 0), 0);

    const enrichedBas = bas.map(ba => {
      const baRefs = referrals.filter(r => r.partner_id === ba.id);
      const baComms = commissions.filter(c => c.partner_id === ba.id);
      const totalInscriptions = baRefs.length;
      const vReg = baRefs.filter(r => r.referred_user_type === 'vendor' || r.is_vendor).length;
      const vPaid = baRefs.filter(r => r.has_paid).length;
      const commSum = baComms.reduce((s, c) => s + Number(c.commission_amount || 0), 0);
      const score = totalInscriptions * 10 + vReg * 20 + vPaid * 50;
      return { ...ba, totalInscriptions, vReg, vPaid, commSum, score };
    }).sort((a, b) => b.score - a.score);

    const dailyTarget = Math.max(5, totalBas * 2);
    const weeklyTarget = dailyTarget * 6;
    const monthlyTarget = dailyTarget * 25;
    const monthPct = Math.min(100, Math.round((regsMonth / Math.max(1, monthlyTarget)) * 100));

    let tabHtml = '';
    if (supervisorTab === 'overview') {
      tabHtml = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin-bottom:18px;">
          <div class="jds-kpi"><div class="jds-kpi-val">${totalBas}</div><div class="jds-kpi-lbl">BA recrutés (${activeBas} actifs / ${inactiveBas} inactifs / ${suspendedBas} susp.)</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${regsToday} / ${regsWeek} / ${regsMonth}</div><div class="jds-kpi-lbl">Inscriptions (Jour / Sem. / Mois)</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${vendorsReg} (${vendorsPaid} payants)</div><div class="jds-kpi-lbl">Vendeurs inscrits & payants</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${subsValidated}</div><div class="jds-kpi-lbl">Souscriptions validées</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${totalSales.toLocaleString('fr-FR')} F</div><div class="jds-kpi-lbl">Ventes générées par l'équipe</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val" style="color:#6d28d9;">${totalComms.toLocaleString('fr-FR')} F</div><div class="jds-kpi-lbl">Commissions équipe</div></div>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:16px; margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:800; margin-bottom:8px;">
            <span>🎯 Progression Objectif Collectif Mensuel (${regsMonth} / ${monthlyTarget} inscriptions)</span>
            <span style="color:#6d28d9;">${monthPct}%</span>
          </div>
          <div style="height:10px; background:#e2e8f0; border-radius:99px; overflow:hidden;">
            <div style="width:${monthPct}%; height:100%; background:linear-gradient(90deg, #0f4c81, #6d28d9);"></div>
          </div>
        </div>
      `;
    } else if (supervisorTab === 'team') {
      tabHtml = `
        <div style="background:#f5f3ff; border:1px solid #ddd6fe; border-radius:14px; padding:16px; margin-bottom:18px;">
          <h4 style="font-size:15px; font-weight:800; color:#4c1d95; margin-bottom:10px;">➕ Recruter un nouveau Brand Ambassador (BA)</h4>
          <form onsubmit="event.preventDefault(); window.submitRecruitBa();" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px;">
            <input id="ba-rec-name" type="text" required class="bc-input" placeholder="Nom et prénom du BA" />
            <input id="ba-rec-phone" type="text" required class="bc-input" placeholder="Téléphone (+229...)" />
            <input id="ba-rec-city" type="text" required class="bc-input" value="${esc(currentPartner.city || 'Parakou')}" placeholder="Ville" />
            <input id="ba-rec-pass" type="text" required class="bc-input" placeholder="Mot de passe initial" />
            <button id="ba-rec-btn" type="submit" class="btn bc-btn-violet" style="justify-content:center; padding:10px 16px;">
              ✅ Créer le compte BA
            </button>
          </form>
          <div id="ba-rec-result" style="margin-top:10px; font-size:12px;"></div>
        </div>

        <h4 style="font-size:15px; font-weight:800; margin-bottom:10px;">👥 Mon Équipe (${enrichedBas.length} Brand Ambassadors)</h4>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${enrichedBas.length === 0 ? `<p style="color:#64748b; font-size:13px;">Aucun BA recruté pour le moment.</p>` : enrichedBas.map(ba => `
            <div style="background:white; border:1px solid #e2e8f0; border-radius:12px; padding:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <div>
                <div style="font-weight:800; font-size:14px; color:#0f172a;">
                  🎖️ ${esc(ba.full_name)}
                  <span style="background:#f5f3ff; color:#6d28d9; padding:2px 8px; border-radius:99px; font-size:11px; margin-left:6px;">${esc(ba.partner_code)}</span>
                </div>
                <div style="font-size:12px; color:#64748b; margin-top:3px;">
                  📞 ${esc(ba.phone)} • 📍 ${esc(ba.city)} • Recruté le ${new Date(ba.recruited_at || ba.created_at).toLocaleDateString('fr-FR')}
                </div>
              </div>
              <div style="display:flex; gap:12px; align-items:center; font-size:12px; font-weight:700;">
                <span>📝 ${ba.totalInscriptions} inscr.</span>
                <span>🏪 ${ba.vReg} vend. (${ba.vPaid} payants)</span>
                <span style="color:#15803d;">💰 ${ba.commSum.toLocaleString('fr-FR')} F</span>
                <span style="padding:3px 8px; border-radius:99px; background:${isPartnerActive(ba.status) ? '#dcfce7' : '#fee2e2'}; color:${isPartnerActive(ba.status) ? '#166534' : '#991b1b'};">
                  ${isPartnerActive(ba.status) ? 'Actif' : ba.status}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } else if (supervisorTab === 'ranking') {
      const top3 = enrichedBas.slice(0, 3);
      tabHtml = `
        <h4 style="font-size:15px; font-weight:800; margin-bottom:12px;">🏆 Podium & Classement Automatique de l'Équipe</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:16px;">
          ${[0, 1, 2].map(idx => {
            const b = top3[idx];
            const medals = ['🥇 1er — Meilleur BA', '🥈 2e — Deuxième', '🥉 3e — Troisième'];
            return `
              <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:14px; padding:14px; text-align:center;">
                <div style="font-size:12px; font-weight:800; color:#6d28d9; margin-bottom:6px;">${medals[idx]}</div>
                ${b ? `
                  <div style="font-size:15px; font-weight:900; color:#0f172a;">${esc(b.full_name)}</div>
                  <div style="font-size:11px; color:#64748b; margin:4px 0;">Code : ${esc(b.partner_code)}</div>
                  <div style="font-size:13px; font-weight:800; color:#15803d;">${b.totalInscriptions} inscr. • ${b.vPaid} payants</div>
                ` : `<div style="font-size:12px; color:#94a3b8;">En attente de résultats</div>`}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      const zeroBa = enrichedBas.filter(b => b.totalInscriptions === 0);
      tabHtml = `
        <h4 style="font-size:15px; font-weight:800; margin-bottom:10px;">🎯 Objectifs Collectifs & Accompagnement</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-bottom:16px;">
          <div class="jds-kpi"><div class="jds-kpi-val">${regsToday} / ${dailyTarget}</div><div class="jds-kpi-lbl">Objectif Journalier</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${regsWeek} / ${weeklyTarget}</div><div class="jds-kpi-lbl">Objectif Hebdomadaire</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${regsMonth} / ${monthlyTarget} (${monthPct}%)</div><div class="jds-kpi-lbl">Objectif Mensuel</div></div>
        </div>
        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:14px; font-size:13px;">
          <strong>🤝 Accompagnement prioritaire (${zeroBa.length} BA à 0 inscription) :</strong>
          <div style="margin-top:6px; color:#92400e;">
            ${zeroBa.length === 0 ? 'Tous vos BA ont déjà réalisé au moins une inscription !' : zeroBa.map(b => `${esc(b.full_name)} (${esc(b.partner_code)})`).join(' • ')}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding-bottom:14px; border-bottom:1px solid #e2e8f0; margin-bottom:16px;">
          <div>
            <span style="background:#6d28d9; color:white; padding:3px 10px; border-radius:99px; font-size:11px; font-weight:800;">👔 SUPERVISEUR BA</span>
            <h3 style="font-size:19px; font-weight:900; color:#0f172a; margin-top:4px;">${esc(currentPartner.full_name)}</h3>
            <div style="font-size:12px; color:#64748b;">Code : <strong>${esc(currentPartner.partner_code)}</strong> • Région : ${esc(currentPartner.region || currentPartner.city)}</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn bc-btn-outline" style="padding:7px 12px; font-size:12px;" onclick="window.openChangePartnerPasswordModal()">🔑 Mot de passe</button>
            <button class="btn" style="background:#fee2e2; color:#dc2626; padding:7px 12px; font-size:12px;" onclick="window.logoutJdsPartner()">🚪 Déconnexion</button>
          </div>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
          <button class="btn ${supervisorTab === 'overview' ? 'bc-btn-violet' : 'bc-btn-outline'}" style="padding:8px 14px; font-size:12px;" onclick="window.switchSupervisorTab('overview')">📊 Tableau de bord</button>
          <button class="btn ${supervisorTab === 'team' ? 'bc-btn-violet' : 'bc-btn-outline'}" style="padding:8px 14px; font-size:12px;" onclick="window.switchSupervisorTab('team')">👥 Mon Équipe (${totalBas})</button>
          <button class="btn ${supervisorTab === 'ranking' ? 'bc-btn-violet' : 'bc-btn-outline'}" style="padding:8px 14px; font-size:12px;" onclick="window.switchSupervisorTab('ranking')">🏆 Classement</button>
          <button class="btn ${supervisorTab === 'goals' ? 'bc-btn-violet' : 'bc-btn-outline'}" style="padding:8px 14px; font-size:12px;" onclick="window.switchSupervisorTab('goals')">🎯 Objectifs & Suivi</button>
        </div>

        ${tabHtml}
      </div>
    `;
  }

  window.submitRecruitBa = async function () {
    if (!currentPartner || currentPartner.role !== 'ba_supervisor') return;
    const fullName = (document.getElementById('ba-rec-name')?.value || '').trim();
    const phone = (document.getElementById('ba-rec-phone')?.value || '').trim();
    const city = (document.getElementById('ba-rec-city')?.value || 'Parakou').trim();
    const password = (document.getElementById('ba-rec-pass')?.value || '').trim();
    const btn = document.getElementById('ba-rec-btn');
    const resBox = document.getElementById('ba-rec-result');

    if (!fullName || !phone || !password) return;
    btn.disabled = true;
    btn.textContent = '⏳ Création...';

    try {
      const state = await syncJdsStateFromCloud();
      const normPhone = normalizePhone(phone);
      const existingPhone = state.partners.find(
        p => normPhone.length >= 8 && normalizePhone(p.phone).endsWith(normPhone.slice(-8))
      );

      if (existingPhone) {
        resBox.innerHTML = `<span style="color:#dc2626; font-weight:700;">⚠️ Ce numéro appartient déjà à un partenaire (${esc(existingPhone.full_name)}).</span>`;
        btn.disabled = false;
        btn.textContent = '✅ Créer le compte BA';
        return;
      }

      const partnerCode = await generatePartnerCode(fullName, 'brand_ambassador');
      const syntheticEmail = `${partnerCode.toLowerCase().replace(/[^a-z0-9]/g, '')}@jds.benin-connect.com`;
      const passwordHash = await sha256Salted(password);

      let newUserId = null;
      const iso = createIsolatedClient();
      if (iso) {
        try {
          const { data: signUpData } = await iso.auth.signUp({
            email: syntheticEmail,
            password,
            options: { data: { full_name: fullName, phone, role: 'brand_ambassador' } }
          });
          if (signUpData?.user?.id) newUserId = signUpData.user.id;
        } catch (e) {}
      }

      const parts = fullName.split(/\s+/);
      const nowIso = new Date().toISOString();
      const newBa = {
        id: 'jds-ba-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        user_id: newUserId,
        username: partnerCode.toLowerCase(),
        login_identifier: partnerCode,
        first_name: parts[0] || fullName,
        last_name: parts.slice(1).join(' '),
        full_name: fullName,
        phone,
        email: syntheticEmail,
        password_hash: passwordHash,
        role: 'brand_ambassador',
        partner_code: partnerCode,
        referral_link: buildPartnerShareLink(partnerCode),
        supervisor_id: currentPartner.id,
        regional_admin_id: currentPartner.regional_admin_id || null,
        region: currentPartner.region || 'Borgou (Parakou)',
        city,
        status: 'actif',
        recruited_by_id: currentPartner.id,
        recruited_at: nowIso,
        last_activity_at: nowIso,
        created_at: nowIso
      };

      state.partners.unshift(newBa);
      cachedCloudState = state;
      try {
        localStorage.setItem(JDS_STORAGE_KEY, JSON.stringify(state));
      } catch (e) {}

      await pushJdsCloudEvent('UPSERT_PARTNER', newBa);

      await renderSupervisorDashboard(false);
      alert(`✅ BA recruté et synchronisé avec succès !\nNom : ${fullName}\nIdentifiant / Code : ${partnerCode}\nMot de passe : ${password}`);
    } catch (err) {
      if (resBox) resBox.innerHTML = `<span style="color:#dc2626; font-weight:700;">❌ ${esc(err.message)}</span>`;
      btn.disabled = false;
      btn.textContent = '✅ Créer le compte BA';
    }
  };

  // ============================================================================
  // 2. TABLEAU DE BORD BRAND AMBASSADOR
  // ============================================================================
  async function renderBaDashboard() {
    const container = document.getElementById('jds-portal-body');
    if (!container || !currentPartner) return;
    container.innerHTML = `<div style="padding:40px; text-align:center; color:#64748b;">⏳ Chargement de votre espace Brand Ambassador...</div>`;

    const state = await syncJdsStateFromCloud();
    cachedCloudState = state;

    const refs = state.referrals.filter(
      r => r.partner_id === currentPartner.id || String(r.partner_code || '').toUpperCase() === String(currentPartner.partner_code || '').toUpperCase()
    );
    const comms = state.commissions.filter(
      c => (c.partner_id === currentPartner.id || String(c.partner_code || '').toUpperCase() === String(currentPartner.partner_code || '').toUpperCase()) &&
           c.status !== 'annulee' && c.status !== 'cancelled'
    );
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const getRefDate = (r) => new Date(r.registered_at || r.created_at || now);
    const regsToday = refs.filter(r => getRefDate(r) >= startOfDay).length;
    const regsWeek = refs.filter(r => getRefDate(r) >= startOfWeek).length;
    const regsMonth = refs.filter(r => getRefDate(r) >= startOfMonth).length;
    const vendorsReg = refs.filter(r => r.referred_user_type === 'vendor' || r.is_vendor).length;
    const vendorsPaid = refs.filter(r => r.has_paid).length;
    const subsDone = comms.length;

    const pendingAmt = comms.filter(c => c.status === 'en_attente' || c.status === 'pending').reduce((s, c) => s + Number(c.commission_amount || 0), 0);
    const validatedAmt = comms.filter(c => c.status === 'validee' || c.status === 'validated').reduce((s, c) => s + Number(c.commission_amount || 0), 0);
    const paidAmt = comms.filter(c => c.status === 'payee' || c.status === 'paid').reduce((s, c) => s + Number(c.commission_amount || 0), 0);
    const acquiredGains = validatedAmt + paidAmt;
    const shareUrl = buildPartnerShareLink(currentPartner.partner_code);

    const dailyGoal = 5;
    const monthlyGoal = 120;
    const monthPct = Math.min(100, Math.round((regsMonth / monthlyGoal) * 100));
    const expectedDayOfMonth = Math.round((now.getDate() / 30) * monthlyGoal);
    const isAhead = regsMonth >= expectedDayOfMonth;

    container.innerHTML = `
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding-bottom:14px; border-bottom:1px solid #e2e8f0; margin-bottom:16px;">
          <div>
            <span style="background:#0f4c81; color:white; padding:3px 10px; border-radius:99px; font-size:11px; font-weight:800;">🎖️ BRAND AMBASSADOR</span>
            <h3 style="font-size:19px; font-weight:900; color:#0f172a; margin-top:4px;">${esc(currentPartner.full_name)}</h3>
            <div style="font-size:12px; color:#64748b;">📍 ${esc(currentPartner.city || 'Parakou')} (${esc(currentPartner.region || 'Borgou')})</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn bc-btn-outline" style="padding:7px 12px; font-size:12px;" onclick="window.openChangePartnerPasswordModal()">🔑 Mot de passe</button>
            <button class="btn" style="background:#fee2e2; color:#dc2626; padding:7px 12px; font-size:12px;" onclick="window.logoutJdsPartner()">🚪 Déconnexion</button>
          </div>
        </div>

        <!-- Mon Code Partenaire -->
        <div style="background:linear-gradient(135deg, #0f4c81 0%, #6d28d9 100%); color:white; border-radius:16px; padding:18px; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="font-size:11px; text-transform:uppercase; opacity:0.85; font-weight:700;">Mon Code Partenaire Personnel</div>
            <div style="font-size:26px; font-weight:900; letter-spacing:1px; margin:4px 0;">${esc(currentPartner.partner_code)}</div>
            <div style="font-size:12px; opacity:0.9;">Lien : ${esc(shareUrl)}</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn" style="background:white; color:#0f4c81; padding:9px 14px; font-size:12px;" onclick="navigator.clipboard.writeText('${esc(currentPartner.partner_code)}'); alert('✅ Code copié : ${esc(currentPartner.partner_code)}');">📋 Copier le code</button>
            <button class="btn" style="background:#25D366; color:white; padding:9px 14px; font-size:12px;" onclick="window.open('https://wa.me/?text=' + encodeURIComponent('Rejoignez Bénin Connect et Marché d\\'Aujourd\\'hui avec mon code partenaire ${esc(currentPartner.partner_code)} : ${esc(shareUrl)}'), '_blank')">📲 Partager WhatsApp</button>
          </div>
        </div>

        <!-- Mes Statistiques -->
        <h4 style="font-size:14px; font-weight:800; margin-bottom:10px;">📊 Mes Statistiques (${refs.length} inscrits au total)</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; margin-bottom:18px;">
          <div class="jds-kpi"><div class="jds-kpi-val">${regsToday}</div><div class="jds-kpi-lbl">Inscriptions du jour</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${regsWeek}</div><div class="jds-kpi-lbl">Inscriptions semaine</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${regsMonth}</div><div class="jds-kpi-lbl">Inscriptions du mois</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${vendorsReg}</div><div class="jds-kpi-lbl">Vendeurs inscrits</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${vendorsPaid}</div><div class="jds-kpi-lbl">Vendeurs payants</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${subsDone}</div><div class="jds-kpi-lbl">Souscriptions réalisées</div></div>
        </div>

        <!-- Mes Commissions (Acquis vs Prévisionnels) -->
        <h4 style="font-size:14px; font-weight:800; margin-bottom:10px;">💰 Mes Commissions & Gains</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px; margin-bottom:18px;">
          <div class="jds-kpi" style="border-color:#fde68a; background:#fffbeb;">
            <div class="jds-kpi-val" style="color:#d97706;">${pendingAmt.toLocaleString('fr-FR')} F</div>
            <div class="jds-kpi-lbl">En attente (Gains prévisionnels)</div>
          </div>
          <div class="jds-kpi" style="border-color:#bbf7d0; background:#f0fdf4;">
            <div class="jds-kpi-val" style="color:#15803d;">${acquiredGains.toLocaleString('fr-FR')} F</div>
            <div class="jds-kpi-lbl">Gains acquis (${validatedAmt.toLocaleString('fr-FR')} F validés + ${paidAmt.toLocaleString('fr-FR')} F payés)</div>
          </div>
        </div>

        <!-- Mes Objectifs -->
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <span style="font-size:13px; font-weight:800;">🎯 Objectif Mensuel (${regsMonth} / ${monthlyGoal}) • Jour : ${regsToday} / ${dailyGoal}</span>
            <span style="font-size:11px; font-weight:800; padding:3px 10px; border-radius:99px; background:${isAhead ? '#dcfce7' : '#fef3c7'}; color:${isAhead ? '#166534' : '#92400e'};">
              ${isAhead ? '🚀 En avance sur votre objectif' : '⚡ En retard — continuez vos partages !'}
            </span>
          </div>
          <div style="height:10px; background:#e2e8f0; border-radius:99px; overflow:hidden;">
            <div style="width:${monthPct}%; height:100%; background:#0f4c81;"></div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // 3. TABLEAU DE BORD INFLUENCEUR PARTENAIRE
  // ============================================================================
  async function renderInfluencerDashboard() {
    const container = document.getElementById('jds-portal-body');
    if (!container || !currentPartner) return;
    container.innerHTML = `<div style="padding:40px; text-align:center; color:#64748b;">⏳ Chargement de votre espace Influenceur Partenaire...</div>`;

    const state = await syncJdsStateFromCloud();
    cachedCloudState = state;

    const refs = state.referrals.filter(
      r => r.partner_id === currentPartner.id || String(r.partner_code || '').toUpperCase() === String(currentPartner.partner_code || '').toUpperCase()
    );
    const comms = state.commissions.filter(
      c => (c.partner_id === currentPartner.id || String(c.partner_code || '').toUpperCase() === String(currentPartner.partner_code || '').toUpperCase()) &&
           c.status !== 'annulee' && c.status !== 'cancelled'
    );
    const paidClients = refs.filter(r => r.has_paid).length;
    const subs = comms.length;
    const totalComms = comms.reduce((s, c) => s + Number(c.commission_amount || 0), 0);
    const refLink = buildPartnerShareLink(currentPartner.partner_code);

    container.innerHTML = `
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding-bottom:14px; border-bottom:1px solid #e2e8f0; margin-bottom:16px;">
          <div>
            <span style="background:#7c3aed; color:white; padding:3px 10px; border-radius:99px; font-size:11px; font-weight:800;">🌟 INFLUENCEUR PARTENAIRE</span>
            <h3 style="font-size:19px; font-weight:900; color:#0f172a; margin-top:4px;">${esc(currentPartner.full_name)}</h3>
            <div style="font-size:12px; color:#64748b;">Campagne : ${esc(currentPartner.campaign_name || 'Campagne Nationale Bénin Connect')}</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn bc-btn-outline" style="padding:7px 12px; font-size:12px;" onclick="window.openChangePartnerPasswordModal()">🔑 Mot de passe</button>
            <button class="btn" style="background:#fee2e2; color:#dc2626; padding:7px 12px; font-size:12px;" onclick="window.logoutJdsPartner()">🚪 Déconnexion</button>
          </div>
        </div>

        <div style="background:linear-gradient(135deg, #6d28d9 0%, #4c1d95 100%); color:white; border-radius:16px; padding:18px; margin-bottom:18px;">
          <div style="font-size:11px; text-transform:uppercase; opacity:0.85; font-weight:700;">Code Promotionnel & Lien de Parrainage</div>
          <div style="font-size:26px; font-weight:900; margin:4px 0;">${esc(currentPartner.partner_code)}</div>
          <div style="font-size:12px; opacity:0.9; word-break:break-all; margin-bottom:12px;">🔗 ${esc(refLink)}</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn" style="background:white; color:#4c1d95; padding:8px 14px; font-size:12px;" onclick="navigator.clipboard.writeText('${esc(refLink)}'); alert('✅ Lien de parrainage copié !');">📋 Copier mon lien</button>
            <button class="btn" style="background:#25D366; color:white; padding:8px 14px; font-size:12px;" onclick="window.open('https://wa.me/?text=' + encodeURIComponent('Découvrez Bénin Connect avec mon code promo ${esc(currentPartner.partner_code)} : ${esc(refLink)}'), '_blank')">📲 Partager à ma communauté</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px;">
          <div class="jds-kpi"><div class="jds-kpi-val">${refs.length}</div><div class="jds-kpi-lbl">Inscriptions générées</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${paidClients}</div><div class="jds-kpi-lbl">Clients payants</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val">${subs}</div><div class="jds-kpi-lbl">Souscriptions obtenues</div></div>
          <div class="jds-kpi"><div class="jds-kpi-val" style="color:#6d28d9;">${totalComms.toLocaleString('fr-FR')} F</div><div class="jds-kpi-lbl">Commissions cumulées</div></div>
        </div>
      </div>
    `;
  }
})();
