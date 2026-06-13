/**
 * app.js — Minerva Connect
 */

import { CONFIG } from './jsconfig.js';
import { populateCountries } from './countries.js';

// ============================================================
// State & Clients
// ============================================================

let supabase; 

const state = {
  user: null,
  profile: null,
  questions: [],
  answered: [],
  allQuestions: [],
  currentTab: 'open',
  currentThread: null,
  messages: [],
  messageSubscription: null
};

// ============================================================
// Initialization
// ============================================================

async function init() {
  console.log('[Minerva Connect] initializing...');
  
  try {
    if (!window.supabase) throw new Error('Supabase library not loaded.');
    
    supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        state.user = session.user;
        await loadProfile();
    }

    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN') {
            state.user = session.user;
            loadProfile();
        } else if (event === 'SIGNED_OUT') {
            state.user = null;
            state.profile = null;
            location.reload();
        }
    });

    // Event Listeners
    document.getElementById('applicant-form')?.addEventListener('submit', handleFormSubmit);
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('profile-form')?.addEventListener('submit', handleProfileUpdate);
    document.getElementById('chat-form')?.addEventListener('submit', handleSendMessage);

    // Populate country dropdowns
    populateCountries('country');
    populateCountries('profile-country');

    renderUI();
  } catch (err) {
    showError('Initialization Error: ' + err.message);
  }
}

// ============================================================
// Auth & Profile Actions
// ============================================================

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;

    // ============================================================
    // DEV LOGIN BYPASS  --  REMOVE BEFORE / DO NOT RELY ON IN PRODUCTION
    // Lets contributors sign in as a test Minervan WITHOUT a magic link.
    // Safety: only runs on localhost, so it does nothing on the live site
    // even if this block is committed or deployed by accident.
    // One-time Supabase setup (see CONTRIBUTING / the PR notes):
    //   1. Auth > Users > Add user: login@login.com / a dev password, "Auto Confirm User" ON
    //   2. Make that user a Minervan so RLS lets them see the dashboard:
    //      update public.profiles set role = 'minervan', is_verified = true
    //      where id = (select id from auth.users where email = 'login@login.com');
    const DEV_LOGIN = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (DEV_LOGIN && email === 'login@login.com') {
        const { error } = await supabase.auth.signInWithPassword({
            email: 'login@login.com',
            password: 'devpassword123' // local-only test credential; never a real account
        });
        if (error) { showError('Dev login failed: ' + error.message); return; }
        hideLogin();
        return;
    }
    // END DEV LOGIN BYPASS
    // ============================================================

    // Allowed: any @uni.minerva.edu student, plus two explicit exceptions.
    const normalized = email.trim().toLowerCase();
    const ALLOWED_EXCEPTIONS = ['ben.wilkoff@minerva.edu', 'minerva.connect@proton.me'];
    const allowed = normalized.endsWith('@uni.minerva.edu') || ALLOWED_EXCEPTIONS.includes(normalized);
    if (!allowed) {
        return showLoginError('Please use your @uni.minerva.edu email. This portal is for current Minervans only.');
    }
    clearLoginError();
    try {
        const { error } = await supabase.auth.signInWithOtp({
            email: email,
            // Return to wherever the user actually is (localhost in dev, the live
            // site in prod) so the post-login profile step is reachable in both.
            options: { emailRedirectTo: window.location.origin + window.location.pathname }
        });
        if (error) throw error;
        alert('Magic link sent! Check your email.');
        hideLogin();
    } catch (err) {
        showLoginError('Login error: ' + err.message);
    }
}

async function handleLogout() {
    await supabase.auth.signOut();
}

async function loadProfile() {
    const { data } = await supabase.from('profiles').select('*').eq('id', state.user.id).single();
    if (data) state.profile = data;
    renderUI();
    // Staff who are ready to work get the open-questions list loaded
    if (state.profile?.role === 'admin' || (state.profile?.college && state.profile?.country)) {
        loadQuestions();
    }
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    const profileData = {
        id: state.user.id,
        first_name: document.getElementById('profile-first-name').value,
        last_name: document.getElementById('profile-last-name').value,
        preferred_name: document.getElementById('profile-preferred-name').value,
        class_year: document.getElementById('profile-class-year').value,
        college: document.getElementById('profile-college').value,
        country: document.getElementById('profile-country').value,
        gender: document.getElementById('profile-gender').value
    };
    try {
        // upsert: works whether or not a profile row already exists for this user
        const { error } = await supabase.from('profiles').upsert(profileData);
        if (error) throw error;
        state.profile = { ...state.profile, ...profileData };
        renderUI();
        loadQuestions();
    } catch (err) {
        showError('Profile Error: ' + err.message);
    }
}

// ============================================================
// Messaging Engine (M3)
// ============================================================

async function openQuestion(questionId) {
    console.log('Opening Question:', questionId);
    
    try {
        // 1. Check if a thread already exists for this question + this Minervan
        let { data: thread, error } = await supabase
            .from('threads')
            .select('*')
            .eq('question_id', questionId)
            .eq('minervan_id', state.user.id)
            .single();

        // 2. If no thread, create one
        if (!thread) {
            const { data: newThread, error: insertError } = await supabase
                .from('threads')
                .insert([{ question_id: questionId, minervan_id: state.user.id }])
                .select()
                .single();
            
            if (insertError) throw insertError;
            thread = newThread;
        }

        state.currentThread = thread;
        
        // 3. Update UI to show chat
        renderUI();
        loadMessages();
        subscribeToMessages();
    } catch (err) {
        showError('Messaging Error: ' + err.message);
    }
}

async function loadMessages() {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('thread_id', state.currentThread.id)
        .order('created_at', { ascending: true });
    
    if (data) {
        state.messages = data;
        renderMessages();
    }
}

async function handleSendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;

    try {
        const { error } = await supabase
            .from('messages')
            .insert([{
                thread_id: state.currentThread.id,
                sender_id: state.user.id,
                content: content
            }]);
        
        if (error) throw error;
        input.value = '';
    } catch (err) {
        showError('Send Error: ' + err.message);
    }
}

function subscribeToMessages() {
    // Clean up old subscription if any
    if (state.messageSubscription) supabase.removeChannel(state.messageSubscription);

    state.messageSubscription = supabase
        .channel('public:messages')
        .on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'messages',
            filter: `thread_id=eq.${state.currentThread.id}` 
        }, payload => {
            state.messages.push(payload.new);
            renderMessages();
        })
        .subscribe();
}

function closeThread() {
    state.currentThread = null;
    if (state.messageSubscription) supabase.removeChannel(state.messageSubscription);
    renderUI();
}

// ============================================================
// Question & UI Logic
// ============================================================

async function loadQuestions() {
    const { data } = await supabase.from('questions').select('*').eq('status', 'open');
    if (data) {
        state.questions = data.map(q => {
            let score = 0;
            if (q.target_college === state.profile.college) score += 3;
            if (q.country === state.profile.country) score += 2;
            return { ...q, matchScore: score };
        }).sort((a, b) => b.matchScore - a.matchScore);
        renderQuestions();
    }
}

function renderUI() {
    const authControls = document.getElementById('auth-controls');
    const applicantForm = document.getElementById('applicant-form-container');
    const howItWorks = document.getElementById('how-it-works');
    const profileSetup = document.getElementById('profile-setup-section');
    const dashboard = document.getElementById('dashboard-section');
    const threadView = document.getElementById('thread-section');

    [applicantForm, howItWorks, profileSetup, dashboard, threadView].forEach(el => el.classList.add('hidden'));

    if (state.user) {
        const isAdmin = state.profile?.role === 'admin';
        authControls.innerHTML = `<span>${isAdmin ? 'Admin' : 'Minervan Verified'}</span> <button class="btn btn-secondary" onclick="window.app.handleLogout()">Logout</button>`;
        // Admins skip the matching profile; everyone else completes it once.
        const profileComplete = isAdmin || (state.profile?.college && state.profile?.first_name);
        if (!profileComplete) {
            profileSetup.classList.remove('hidden');
        } else if (state.currentThread) {
            threadView.classList.remove('hidden');
        } else {
            dashboard.classList.remove('hidden');
            document.querySelector('.tab-admin')?.classList.toggle('hidden', !isAdmin);
        }
    } else {
        authControls.innerHTML = `<button class="btn btn-secondary" onclick="window.app.showLogin()">Minervan Login</button>`;
        applicantForm.classList.remove('hidden');
        howItWorks.classList.remove('hidden');
    }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderQuestions() {
    const list = document.getElementById('questions-list');
    if (!state.questions.length) {
        list.innerHTML = '<p style="color: var(--mu-graphite);">No open questions right now. Check back soon.</p>';
        return;
    }
    list.innerHTML = state.questions.map(q => `
        <div class="card">
            <h3>${escapeHtml(q.topic)}</h3>
            <p style="color: var(--mu-clay); margin-bottom: 0.5rem;">${escapeHtml(q.target_college || '')}${q.country ? ' · ' + escapeHtml(q.country) : ''}</p>
            <p>${escapeHtml(q.content)}</p>
            ${q.context ? `<p style="font-size: 0.9rem; color: var(--mu-slate);"><strong>Context:</strong> ${escapeHtml(q.context)}</p>` : ''}
            <div style="background: var(--mu-bone); border-radius: 8px; padding: 0.75rem; margin-bottom: 1rem; font-size: 0.875rem;">
                <strong>From:</strong> ${escapeHtml(q.applicant_name || 'Applicant')} &lt;${escapeHtml(q.applicant_email || 'no email provided')}&gt;
                <br><span style="color: var(--mu-graphite); font-size: 0.8rem;">Clicking reply marks this answered and keeps minerva.connect@proton.me in CC.</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span class="badge">Match: ${q.matchScore}</span>
                ${q.applicant_email
                    ? `<button class="btn btn-primary btn-sm" onclick="window.app.replyByEmail('${q.id}')">Reply by Email</button>`
                    : '<span style="color: var(--mu-graphite); font-size: 0.85rem;">No email provided</span>'}
            </div>
        </div>
    `).join('');
}

// ---- Reply-by-email flow --------------------------------------------------
function replyByEmail(questionId) {
    const q = state.questions.find(x => x.id === questionId);
    if (!q) return;
    document.getElementById('reply-modal').classList.remove('hidden');
    document.getElementById('reply-continue-btn').onclick = () => confirmReply(questionId);
}

function closeReplyModal() {
    document.getElementById('reply-modal').classList.add('hidden');
}

async function confirmReply(questionId) {
    const q = state.questions.find(x => x.id === questionId);
    if (!q) return closeReplyModal();

    const body = [
        '--- Please use REPLY ALL so minerva.connect@proton.me stays in CC ---',
        '',
        `Hi ${q.applicant_name || 'there'},`,
        '',
        `Thanks for your question about ${q.topic || 'Minerva'}.`,
        '[Write your answer here]',
        '',
        'Best,',
        displayName(state.profile),
        'Minerva Connect'
    ].join('\n');
    const subject = `Minerva Connect — Re: your question about ${q.topic || ''}`;
    const mailto = `mailto:${encodeURIComponent(q.applicant_email)}`
        + `?cc=${encodeURIComponent('minerva.connect@proton.me')}`
        + `&subject=${encodeURIComponent(subject)}`
        + `&body=${encodeURIComponent(body)}`;

    // Clicking reply marks the question answered (with attribution).
    try {
        const { error } = await supabase.from('questions').update({
            status: 'answered',
            answered_by: state.user.id,
            answered_by_name: displayName(state.profile),
            answered_at: new Date().toISOString()
        }).eq('id', questionId);
        if (error) throw error;
    } catch (err) {
        showError('Could not mark answered: ' + err.message);
    }

    closeReplyModal();
    window.location.href = mailto;   // opens the email client
    loadQuestions();                 // it leaves "Open"; appears under "Answered"
}

// ---- Answered tab ---------------------------------------------------------
async function loadAnswered() {
    const { data } = await supabase.from('questions')
        .select('*').eq('status', 'answered').order('answered_at', { ascending: false });
    state.answered = data || [];
    renderAnswered();
}

function renderAnswered() {
    const list = document.getElementById('answered-list');
    if (!state.answered.length) {
        list.innerHTML = '<p style="color: var(--mu-graphite);">No answered questions yet.</p>';
        return;
    }
    list.innerHTML = state.answered.map(q => `
        <div class="card">
            <h3>${escapeHtml(q.topic)}</h3>
            <p style="color: var(--mu-clay); margin-bottom: 0.5rem;">${escapeHtml(q.target_college || '')}${q.country ? ' · ' + escapeHtml(q.country) : ''}</p>
            <p>${escapeHtml(q.content)}</p>
            <div class="answered-by">Answered by <strong>${escapeHtml(q.answered_by_name || 'a Minervan')}</strong></div>
        </div>
    `).join('');
}

// ---- Admin panel ----------------------------------------------------------
async function loadAllQuestions() {
    const { data } = await supabase.from('questions')
        .select('*').order('created_at', { ascending: false });
    state.allQuestions = data || [];
    renderAdmin();
}

function renderAdmin() {
    const list = document.getElementById('admin-list');
    if (!state.allQuestions.length) {
        list.innerHTML = '<p style="color: var(--mu-graphite);">No questions in the system.</p>';
        return;
    }
    list.innerHTML = state.allQuestions.map(q => {
        const cls = q.status === 'open' ? 'status-open' : (q.status === 'answered' ? 'status-answered' : 'status-other');
        return `
        <div class="admin-row">
            <div style="display:flex; justify-content:space-between; gap:0.5rem; align-items:center; flex-wrap:wrap;">
                <strong>${escapeHtml(q.topic || '')}</strong>
                <span class="status-pill ${cls}">${escapeHtml(q.status || '')}</span>
            </div>
            <p style="margin:0.5rem 0;">${escapeHtml(q.content || '')}</p>
            <div class="meta">
                Applicant: <strong>${escapeHtml(q.applicant_name || '—')}</strong> &lt;${escapeHtml(q.applicant_email || '—')}&gt;<br>
                College: ${escapeHtml(q.target_college || '—')} · Country: ${escapeHtml(q.country || '—')}
                ${q.answered_by_name ? `<br>Answered by: <strong>${escapeHtml(q.answered_by_name)}</strong>` : ''}
            </div>
            <div class="admin-actions">
                ${q.status === 'answered' ? `<button class="btn btn-secondary btn-sm" onclick="window.app.unanswerQuestion('${q.id}')">Mark Unanswered</button>` : ''}
                <button class="btn btn-danger btn-sm" onclick="window.app.deleteQuestion('${q.id}')">Delete</button>
            </div>
        </div>`;
    }).join('');
}

async function unanswerQuestion(id) {
    try {
        const { error } = await supabase.from('questions')
            .update({ status: 'open', answered_by: null, answered_by_name: null, answered_at: null }).eq('id', id);
        if (error) throw error;
        loadAllQuestions();
    } catch (err) { showError('Update Error: ' + err.message); }
}

async function deleteQuestion(id) {
    if (!confirm('Delete this question permanently? This cannot be undone.')) return;
    try {
        const { error } = await supabase.from('questions').delete().eq('id', id);
        if (error) throw error;
        loadAllQuestions();
    } catch (err) { showError('Delete Error: ' + err.message); }
}

// ---- Dashboard tabs -------------------------------------------------------
function showTab(name) {
    state.currentTab = name;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    document.getElementById('tab-' + name)?.classList.remove('hidden');
    if (name === 'open') loadQuestions();
    else if (name === 'answered') loadAnswered();
    else if (name === 'admin') loadAllQuestions();
}

function refreshDashboard() {
    showTab(state.currentTab || 'open');
}

function renderMessages() {
    const window = document.getElementById('chat-window');
    window.innerHTML = state.messages.map(m => `
        <div class="message ${m.sender_id === state.user.id ? 'message-me' : 'message-them'}">
            ${m.content}
        </div>
    `).join('');
    window.scrollTop = window.scrollHeight;
}

// ... (Rest of existing helpers)
function showLogin() { document.getElementById('login-section').classList.remove('hidden'); }
function hideLogin() { document.getElementById('login-section').classList.add('hidden'); }
function showSuccess() { document.getElementById('applicant-form-container').classList.add('hidden'); document.getElementById('success-view').classList.remove('hidden'); }
function showError(msg) {
    let el = document.getElementById('error-message');
    if (!el) { el = document.createElement('div'); el.id = 'error-message'; el.style = 'color: #d93025; background: #f8d7da; padding: 1rem; border-radius: 8px; font-weight: bold; margin-bottom: 1rem;'; document.querySelector('main').prepend(el); }
    el.innerText = msg;
}

// Inline, step-scoped validation feedback so the applicant sees what's wrong
// on the SAME step, instead of a transient alert that disappears on "Next".
function showStepError(stepId, msg) {
    const step = document.getElementById(stepId);
    let el = step.querySelector('.step-error');
    if (!el) {
        el = document.createElement('div');
        el.className = 'step-error';
        el.setAttribute('role', 'alert');
        // Place the message next to the action (just above the buttons) so it's
        // visible where the user is looking, not off-screen at the top of the form.
        const actions = step.querySelector('.button-group');
        step.insertBefore(el, actions || null);
    }
    el.innerText = msg;
    el.classList.remove('hidden');
    // Re-trigger the slide-in + shake animation on every call
    el.classList.remove('step-error--animate');
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add('step-error--animate');
    // Make sure it's actually in view even if the user scrolled
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearStepError(stepId) {
    const el = document.getElementById(stepId).querySelector('.step-error');
    if (el) el.classList.add('hidden');
}
function showLoginError(msg) {
    const el = document.getElementById('login-error');
    if (!el) return alert(msg);
    el.innerText = msg;
    el.classList.remove('hidden');
    el.classList.remove('step-error--animate');
    void el.offsetWidth;
    el.classList.add('step-error--animate');
}
function clearLoginError() {
    document.getElementById('login-error')?.classList.add('hidden');
}

// "First Last (Preferred)" — preferred name in brackets, first then last.
function displayName(p) {
    if (!p) return 'A Minervan';
    const full = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    const pref = p.preferred_name && p.preferred_name.trim();
    return pref ? `${full} (${pref})` : (full || 'A Minervan');
}
// ============================================================
// AI Moderation & Scoring (Local Layer)
// ============================================================

function moderateQuestion(content) {
    const genericPhrases = ['tell me about', 'how is minerva', 'what is it like', 'is it good'];
    let spam = false;
    let priority = 3;
    let clarity = 5;

    // 1. Check for generic content
    const lowerContent = content.toLowerCase();
    if (genericPhrases.some(phrase => lowerContent.includes(phrase))) {
        clarity = 2;
        priority = 1;
    }

    // 2. Length-based scoring
    if (content.length < 100) {
        clarity = 3;
        priority = 2;
    } else if (content.length > 300) {
        priority = 5; // High effort!
    }

    // 3. Simple spam check (repetitive chars)
    if (/(.)\1{4,}/.test(content)) {
        spam = true;
        priority = 1;
    }

    return {
        priority_score: priority,
        spam_flag: spam,
        clarity_score: clarity
    };
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.innerText = 'Submitting...';
    submitBtn.disabled = true;

    const content = document.getElementById('question-content').value;
    const moderation = moderateQuestion(content);

    const data = {
        applicant_name: document.getElementById('applicant-name').value.trim(),
        topic: document.getElementById('topic').value,
        target_college: document.getElementById('target-college').value,
        country: document.getElementById('country').value,
        content: content,
        context: document.getElementById('context').value,
        applicant_email: document.getElementById('applicant-email').value,
        ...moderation
    };
    
    try { 
        const { error } = await supabase.from('questions').insert([data]); 
        if (error) throw error; 
        showSuccess(); 
    } catch (err) { 
        showError(err.message); 
        submitBtn.innerText = 'Submit Question';
        submitBtn.disabled = false;
    }
}

window.app = { nextStep: (s) => {
    if (s === 2) {
        const name = document.getElementById('applicant-name').value.trim();
        const college = document.getElementById('target-college').value;
        const topic = document.getElementById('topic').value;
        const country = document.getElementById('country').value;
        const emailField = document.getElementById('applicant-email');
        const email = emailField.value.trim();

        if (!name || !college || !topic || !country || !email) {
            return showStepError('step-1', 'Please fill in all fields, including your name and email, before continuing.');
        }
        // Validate email format here so problems are caught while the field is still visible
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            emailField.focus();
            return showStepError('step-1', "That email address doesn't look right. Please enter a valid email (e.g. you@example.com).");
        }
        clearStepError('step-1');
    }
    document.querySelectorAll('.form-step').forEach(el => el.classList.add('hidden')); document.getElementById(`step-${s}`).classList.remove('hidden');
},
    showLogin, hideLogin, handleLogout, handleProfileUpdate, openQuestion, closeThread,
    loadQuestions, loadAnswered, loadAllQuestions, showTab, refreshDashboard,
    replyByEmail, confirmReply, closeReplyModal, unanswerQuestion, deleteQuestion
};

document.addEventListener('DOMContentLoaded', init);
