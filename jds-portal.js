/**
 * BÉNIN CONNECT — MODULE JDS PARTENAIRES & SERVICES COMMUNAUTAIRES
 * Connecté à la base de données unique Supabase (ftgdgigvxjekpevujbdi.supabase.co)
 * Gère :
 *  1. Portail de connexion JDS PARTENAIRES (Brand Ambassadors, Superviseurs BA, Influenceurs)
 *  2. Tableaux de bord complets par rôle (Superviseur BA, BA, Influenceur)
 *  3. Recrutement BA par le Superviseur avec client Supabase secondaire isolé
 *  4. Attribution des codes partenaires lors de l'inscription sur Bénin Connect
 */

(function () {
  const SUPABASE_URL = 'https://ftgdgigvxjekpevujbdi.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_IA8Uc-RxIMLzhXPPDqg80g_0gHsp8jk';

  // Utilise le client Supabase principal déjà initialisé dans index.html (window.sb)
  function getSb() {
    return window.sb;
  }

  // Client secondaire isolé pour créer un compte BA sans déconnecter le Superviseur
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
    const data = encoder.encode(String(text || ''));
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

  // État courant du portail partenaire
  let currentPartner = null;
  let supervisorTab = 'overview';
  let supervisorTeamData = null;

  // Génère un code unique au format MARCEL-JDSBA01 / TIKTOK-JDS01
  async function generatePartnerCode(fullName, role) {
    const sb = getSb();
    const prefix = cleanPrefix(fullName);
    const tag = role === 'influencer' ? 'JDS' : role === 'ba_supervisor' ? 'JDSSUP' : 'JDSBA';
    let count = 1;
    try {
      const { count: c } = await sb
        .from('jds_partners')
        .select('*', { count: 'exact', head: true })
        .eq('role', role);
      if (typeof c === 'number') count = c + 1;
    } catch (e) {}

    for (let i = 0; i < 30; i++) {
      const num = String(count + i).padStart(2, '0');
      const candidate = `${prefix}-${tag}${num}`;
      const { data: exists } = await sb
        .from('jds_partners')
        .select('id')
        .eq('partner_code', candidate)
        .maybeSingle();
      if (!exists) return candidate;
    }
    return `${prefix}-${tag}${Date.now().toString().slice(-3)}`;
  }

  // Applique un code partenaire lors d'une inscription sur Bénin Connect
  window.applyJdsReferralOnSignup = async function (rawCode, newUser) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code || !newUser || !newUser.id) return null;
    const sb = getSb();
    try {
      // Vérifie si déjà attribué (anti-double attribution)
      const { data: existingRef } = await sb
        .from('jds_referrals')
        .select('id')
        .eq('referred_user_id', newUser.id)
        .maybeSingle();
      if (existingRef) return null;

      // Recherche du partenaire référent
      const { data: partner } = await sb
        .from('jds_partners')
        .select('*')
        .eq('partner_code', code)
        .eq('status', 'active')
        .maybeSingle();

      if (!partner) return null;
      if (partner.user_id && String(partner.user_id) === String(newUser.id)) return null;

      const userType = newUser.role || 'client';
      const isVendor = ['vendeur', 'prestataire', 'revendeur'].includes(String(userType).toLowerCase());

      const { data: referral, error: refErr } = await sb
        .from('jds_referrals')
        .insert({
          referred_user_id: newUser.id,
          referred_name: newUser.full_name || newUser.email || 'Utilisateur',
          referred_phone: newUser.phone || '',
          referred_email: newUser.email || '',
          referred_user_type: userType,
          referred_city: newUser.city || partner.city || 'Parakou',
          referred_region: newUser.region || partner.region || 'Borgou (Parakou)',
          partner_id: partner.id,
          partner_code: partner.partner_code,
          partner_role: partner.role,
          supervisor_id: partner.supervisor_id || null,
          regional_admin_id: partner.regional_admin_id || null,
          is_vendor: isVendor,
          has_paid: false,
          locked: true
        })
        .select('*')
        .single();

      if (refErr || !referral) return null;

      // Mettre à jour le profil avec le code utilisé
      await sb
        .from('profiles')
        .update({
          partner_code_used: partner.partner_code,
          referred_by_partner_id: partner.id
        })
        .eq('id', newUser.id);

      // Créer la commission d'inscription en attente de validation
      const commAmount = isVendor ? 500 : 200;
      await sb.from('jds_commissions').insert({
        partner_id: partner.id,
        supervisor_id: partner.supervisor_id || null,
        referral_id: referral.id,
        source_type: isVendor ? 'vendor_signup' : 'user_signup',
        source_reference: `SIGNUP-${newUser.id}`,
        description: `Inscription ${isVendor ? 'Vendeur' : 'Utilisateur'} (${newUser.full_name || newUser.email}) via ${partner.partner_code}`,
        sale_amount: 0,
        commission_amount: commAmount,
        status: 'pending',
        region: partner.region || 'Borgou (Parakou)'
      });

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

    // Vérifier si une session partenaire est déjà active
    const savedPartnerId = sessionStorage.getItem('jds_active_partner_id');
    if (savedPartnerId) {
      const sb = getSb();
      const { data: p } = await sb.from('jds_partners').select('*').eq('id', savedPartnerId).maybeSingle();
      if (p && p.status === 'active') {
        currentPartner = p;
        await renderPartnerDashboard();
        return;
      }
    }

    // Si l'utilisateur est déjà connecté sur Bénin Connect, vérifier s'il a un profil jds_partners
    if (window.currentUser) {
      const sb = getSb();
      const { data: p } = await sb
        .from('jds_partners')
        .select('*')
        .or(`user_id.eq.${window.currentUser.id},email.eq.${window.currentUser.email}`)
        .maybeSingle();
      if (p && p.status === 'active') {
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
            <input id="jds-login-identifier" type="text" required class="bc-input" placeholder="Ex: MARCEL-JDSBA02 ou +229 01..." />
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
    const password = document.getElementById('jds-login-password')?.value || '';
    const btn = document.getElementById('jds-login-submit');
    if (!rawId || !password) return;

    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Vérification en cours...';
    }

    try {
      const sb = getSb();
      const upper = rawId.toUpperCase();
      const lower = rawId.toLowerCase();
      const digits = rawId.replace(/\s+/g, '');

      // Recherche du partenaire par identifiant, code, téléphone ou email
      const { data: candidates, error: searchErr } = await sb
        .from('jds_partners')
        .select('*')
        .or(`login_identifier.ilike.${rawId},partner_code.eq.${upper},email.ilike.${lower},phone.ilike.%${digits}%`)
        .limit(5);

      if (searchErr) throw searchErr;

      const partner = (candidates || [])[0];
      if (!partner) {
        // Tenter une connexion Supabase Auth directe au cas où c'est un email Auth
        if (rawId.includes('@')) {
          const { data: authData, error: authErr } = await sb.auth.signInWithPassword({
            email: lower,
            password
          });
          if (!authErr && authData?.user) {
            const { data: pByUser } = await sb
              .from('jds_partners')
              .select('*')
              .eq('user_id', authData.user.id)
              .maybeSingle();
            if (pByUser) {
              if (pByUser.status === 'suspended') {
                renderPartnerLoginView('Ce compte partenaire est actuellement suspendu. Contactez votre superviseur ou administrateur régional.');
                return;
              }
              currentPartner = pByUser;
              sessionStorage.setItem('jds_active_partner_id', pByUser.id);
              await renderPartnerDashboard();
              return;
            }
          }
        }
        renderPartnerLoginView('Aucun compte partenaire trouvé avec cet identifiant, code ou numéro de téléphone.');
        return;
      }

      if (partner.status === 'suspended') {
        renderPartnerLoginView('Votre compte partenaire est suspendu. Veuillez contacter votre administration régionale.');
        return;
      }

      // Vérifier le hash SHA-256 du mot de passe ou l'authentification Supabase
      const hashedInput = await sha256Hex(password);
      let authenticated = false;

      if (partner.password_hash && partner.password_hash === hashedInput) {
        authenticated = true;
      }

      if (partner.email) {
        const { data: authData, error: authErr } = await sb.auth.signInWithPassword({
          email: partner.email,
          password
        });
        if (!authErr && authData?.user) {
          authenticated = true;
        }
      }

      if (!authenticated) {
        renderPartnerLoginView('Mot de passe incorrect. Vérifiez votre saisie ou cliquez sur « Mot de passe oublié ».');
        return;
      }

      // Mettre à jour la dernière activité
      await sb
        .from('jds_partners')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', partner.id);

      currentPartner = partner;
      sessionStorage.setItem('jds_active_partner_id', partner.id);
      await renderPartnerDashboard();
    } catch (err) {
      renderPartnerLoginView(err.message || 'Erreur lors de la connexion au portail partenaire.');
    }
  };

  window.logoutJdsPartner = async function () {
    currentPartner = null;
    supervisorTeamData = null;
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
    const sb = getSb();
    const newHash = await sha256Hex(newPass.trim());
    const { error } = await sb
      .from('jds_partners')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', currentPartner.id);

    if (error) {
      alert('❌ Erreur : ' + error.message);
      return;
    }
    try {
      await sb.auth.updateUser({ password: newPass.trim() });
    } catch (e) {}
    alert('✅ Votre mot de passe partenaire a été mis à jour avec succès !');
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
  // 1. TABLEAU DE BORD SUPERVISEUR BA (Section 6 du cahier JDS PARTENAIRES)
  // ============================================================================
  window.switchSupervisorTab = function (tab) {
    supervisorTab = tab;
    renderSupervisorDashboard(false);
  };

  async function renderSupervisorDashboard(reload = true) {
    const container = document.getElementById('jds-portal-body');
    if (!container || !currentPartner) return;

    if (reload || !supervisorTeamData) {
      container.innerHTML = `<div style="padding:40px; text-align:center; color:#64748b;">⏳ Chargement du tableau de bord Superviseur BA...</div>`;
      const sb = getSb();
      const [
        { data: teamBas },
        { data: referrals },
        { data: commissions },
        { data: objectives }
      ] = await Promise.all([
        sb.from('jds_partners').select('*').eq('supervisor_id', currentPartner.id).eq('role', 'brand_ambassador').order('created_at', { ascending: false }),
        sb.from('jds_referrals').select('*').eq('supervisor_id', currentPartner.id).order('created_at', { ascending: false }),
        sb.from('jds_commissions').select('*').eq('supervisor_id', currentPartner.id).order('created_at', { ascending: false }),
        sb.from('jds_objectives').select('*').eq('supervisor_id', currentPartner.id)
      ]);
      supervisorTeamData = {
        bas: teamBas || [],
        referrals: referrals || [],
        commissions: commissions || [],
        objectives: objectives || []
      };
    }

    const { bas, referrals, commissions } = supervisorTeamData;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const totalBas = bas.length;
    const activeBas = bas.filter(b => b.status === 'active').length;
    const inactiveBas = bas.filter(b => b.status === 'inactive').length;
    const suspendedBas = bas.filter(b => b.status === 'suspended').length;

    const regsToday = referrals.filter(r => new Date(r.created_at) >= startOfDay).length;
    const regsWeek = referrals.filter(r => new Date(r.created_at) >= startOfWeek).length;
    const regsMonth = referrals.filter(r => new Date(r.created_at) >= startOfMonth).length;
    const vendorsReg = referrals.filter(r => r.is_vendor).length;
    const vendorsPaid = referrals.filter(r => r.has_paid).length;
    const subsValidated = commissions.filter(c => c.source_type === 'subscription_sale' && c.status !== 'cancelled').length;
    const totalSales = commissions.filter(c => c.status !== 'cancelled').reduce((s, c) => s + Number(c.sale_amount || 0), 0);
    const totalComms = commissions.filter(c => c.status !== 'cancelled').reduce((s, c) => s + Number(c.commission_amount || 0), 0);

    // Enrichir chaque BA avec ses performances réelles
    const enrichedBas = bas.map(ba => {
      const baRefs = referrals.filter(r => r.partner_id === ba.id);
      const baComms = commissions.filter(c => c.partner_id === ba.id && c.status !== 'cancelled');
      const totalInscriptions = baRefs.length;
      const vReg = baRefs.filter(r => r.is_vendor).length;
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
                <span style="padding:3px 8px; border-radius:99px; background:${ba.status === 'active' ? '#dcfce7' : '#fee2e2'}; color:${ba.status === 'active' ? '#166534' : '#991b1b'};">
                  ${ba.status === 'active' ? 'Actif' : ba.status}
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
      const sb = getSb();
      // Empêcher qu'un BA soit rattaché simultanément à plusieurs superviseurs
      const { data: existingPhone } = await sb
        .from('jds_partners')
        .select('id, full_name, supervisor_id')
        .eq('phone', phone)
        .maybeSingle();

      if (existingPhone) {
        resBox.innerHTML = `<span style="color:#dc2626; font-weight:700;">⚠️ Ce numéro appartient déjà à un partenaire (${esc(existingPhone.full_name)}).</span>`;
        btn.disabled = false;
        btn.textContent = '✅ Créer le compte BA';
        return;
      }

      const partnerCode = await generatePartnerCode(fullName, 'brand_ambassador');
      const loginId = partnerCode;
      const syntheticEmail = `${partnerCode.toLowerCase().replace(/[^a-z0-9]/g, '')}@jds.benin-connect.com`;
      const passwordHash = await sha256Hex(password);

      let newUserId = null;
      const iso = createIsolatedClient();
      if (iso) {
        const { data: signUpData } = await iso.auth.signUp({
          email: syntheticEmail,
          password,
          options: { data: { full_name: fullName, phone, role: 'brand_ambassador' } }
        });
        if (signUpData?.user?.id) newUserId = signUpData.user.id;
      }

      const { data: createdBa, error } = await sb
        .from('jds_partners')
        .insert({
          user_id: newUserId,
          full_name: fullName,
          phone,
          email: syntheticEmail,
          login_identifier: loginId,
          password_hash: passwordHash,
          role: 'brand_ambassador',
          partner_code: partnerCode,
          supervisor_id: currentPartner.id,
          regional_admin_id: currentPartner.regional_admin_id || null,
          region: currentPartner.region || 'Borgou (Parakou)',
          city,
          status: 'active',
          recruited_by_id: currentPartner.id
        })
        .select('*')
        .single();

      if (error) throw error;

      await sb.from('jds_partner_codes').insert({
        code: partnerCode,
        partner_id: createdBa.id,
        role: 'brand_ambassador',
        supervisor_id: currentPartner.id,
        regional_admin_id: currentPartner.regional_admin_id || null,
        region: currentPartner.region || 'Borgou (Parakou)',
        city,
        is_active: true
      });

      supervisorTeamData = null;
      await renderSupervisorDashboard(true);
      alert(`✅ BA recruté avec succès !\nNom : ${fullName}\nIdentifiant / Code : ${partnerCode}\nMot de passe : ${password}`);
    } catch (err) {
      if (resBox) resBox.innerHTML = `<span style="color:#dc2626; font-weight:700;">❌ ${esc(err.message)}</span>`;
      btn.disabled = false;
      btn.textContent = '✅ Créer le compte BA';
    }
  };

  // ============================================================================
  // 2. TABLEAU DE BORD BRAND AMBASSADOR (Section 7 du cahier JDS PARTENAIRES)
  // ============================================================================
  async function renderBaDashboard() {
    const container = document.getElementById('jds-portal-body');
    if (!container || !currentPartner) return;
    container.innerHTML = `<div style="padding:40px; text-align:center; color:#64748b;">⏳ Chargement de votre espace Brand Ambassador...</div>`;

    const sb = getSb();
    const [
      { data: referrals },
      { data: commissions },
      { data: payouts }
    ] = await Promise.all([
      sb.from('jds_referrals').select('*').eq('partner_id', currentPartner.id).order('created_at', { ascending: false }),
      sb.from('jds_commissions').select('*').eq('partner_id', currentPartner.id).order('created_at', { ascending: false }),
      sb.from('jds_payouts').select('*').eq('partner_id', currentPartner.id).order('created_at', { ascending: false })
    ]);

    const refs = referrals || [];
    const comms = (commissions || []).filter(c => c.status !== 'cancelled');
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const regsToday = refs.filter(r => new Date(r.created_at) >= startOfDay).length;
    const regsWeek = refs.filter(r => new Date(r.created_at) >= startOfWeek).length;
    const regsMonth = refs.filter(r => new Date(r.created_at) >= startOfMonth).length;
    const vendorsReg = refs.filter(r => r.is_vendor).length;
    const vendorsPaid = refs.filter(r => r.has_paid).length;
    const subsDone = comms.filter(c => c.source_type === 'subscription_sale').length;

    const pendingAmt = comms.filter(c => c.status === 'pending').reduce((s, c) => s + Number(c.commission_amount || 0), 0);
    const validatedAmt = comms.filter(c => c.status === 'validated').reduce((s, c) => s + Number(c.commission_amount || 0), 0);
    const paidAmt = comms.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.commission_amount || 0), 0);
    const acquiredGains = validatedAmt + paidAmt;
    const shareUrl = `${window.location.origin}/?ref=${encodeURIComponent(currentPartner.partner_code)}`;

    const dailyGoal = 2;
    const monthlyGoal = 50;
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
        <h4 style="font-size:14px; font-weight:800; margin-bottom:10px;">📊 Mes Statistiques</h4>
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
  // 3. TABLEAU DE BORD INFLUENCEUR PARTENAIRE (Section 8 du cahier JDS PARTENAIRES)
  // ============================================================================
  async function renderInfluencerDashboard() {
    const container = document.getElementById('jds-portal-body');
    if (!container || !currentPartner) return;
    container.innerHTML = `<div style="padding:40px; text-align:center; color:#64748b;">⏳ Chargement de votre espace Influenceur Partenaire...</div>`;

    const sb = getSb();
    const [
      { data: referrals },
      { data: commissions }
    ] = await Promise.all([
      sb.from('jds_referrals').select('*').eq('partner_id', currentPartner.id).order('created_at', { ascending: false }),
      sb.from('jds_commissions').select('*').eq('partner_id', currentPartner.id).order('created_at', { ascending: false })
    ]);

    const refs = referrals || [];
    const comms = (commissions || []).filter(c => c.status !== 'cancelled');
    const paidClients = refs.filter(r => r.has_paid).length;
    const subs = comms.filter(c => c.source_type === 'subscription_sale').length;
    const totalComms = comms.reduce((s, c) => s + Number(c.commission_amount || 0), 0);
    const refLink = `${window.location.origin}/?ref=${encodeURIComponent(currentPartner.partner_code)}`;

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
