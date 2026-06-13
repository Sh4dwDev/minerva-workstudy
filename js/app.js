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

    if (!email.endsWith('@uni.minerva.edu')) {
        alert('Only @uni.minerva.edu emails are allowed.');
        return;
    }
    try {
        const { error } = await supabase.auth.signInWithOtp({
            email: email,
            options: { emailRedirectTo: 'https://emmanuelangelo-hyuwa-lang.github.io/minerva-workstudy/' }
        });
        if (error) throw error;
        alert('Magic link sent! Check your email.');
        hideLogin();
    } catch (err) {
        showError('Login Error: ' + err.message);
    }
}

async function handleLogout() {
    await supabase.auth.signOut();
}

async function loadProfile() {
    const { data } = await supabase.from('profiles').select('*').eq('id', state.user.id).single();
    if (data) {
        state.profile = data;
        if (state.profile.college && state.profile.country) loadQuestions();
    }
    renderUI();
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
        authControls.innerHTML = `<span>Minervan Verified</span> <button class="btn btn-secondary" onclick="window.app.handleLogout()">Logout</button>`;
        if (!state.profile?.college) {
            profileSetup.classList.remove('hidden');
        } else if (state.currentThread) {
            threadView.classList.remove('hidden');
        } else {
            dashboard.classList.remove('hidden');
        }
    } else {
        authControls.innerHTML = `<button class="btn btn-secondary" onclick="window.app.showLogin()">Minervan Login</button>`;
        applicantForm.classList.remove('hidden');
        howItWorks.classList.remove('hidden');
    }
}

function renderQuestions() {
    const list = document.getElementById('questions-list');
    if (!state.questions.length) {
        list.innerHTML = '<p style="color: var(--mu-graphite);">No open questions right now. Check back soon.</p>';
        return;
    }
    list.innerHTML = state.questions.map(q => `
        <div class="card">
            <h3>${q.topic}</h3>
            <p style="color: var(--mu-clay); margin-bottom: 0.5rem;">${q.target_college}${q.country ? ' · ' + q.country : ''}</p>
            <p>${q.content}</p>
            ${q.context ? `<p style="font-size: 0.9rem; color: var(--mu-slate);"><strong>Context:</strong> ${q.context}</p>` : ''}
            <div style="background: var(--mu-bone); border-radius: 8px; padding: 0.75rem; margin-bottom: 1rem; font-size: 0.875rem;">
                <strong>Reply to:</strong> ${q.applicant_email || '<em>no email provided</em>'}
                <br><span style="color: var(--mu-graphite); font-size: 0.8rem;">Always CC minerva.connect@proton.me in your reply.</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span class="badge">Match: ${q.matchScore}</span>
                <div style="display: flex; gap: 0.5rem;">
                    ${q.applicant_email ? `<a class="btn btn-primary btn-sm" style="text-decoration: none;" href="mailto:${q.applicant_email}?cc=minerva.connect@proton.me&subject=${encodeURIComponent('Minerva Connect — Re: your question about ' + q.topic)}">Reply by Email</a>` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="window.app.markAnswered('${q.id}')">Mark Answered</button>
                </div>
            </div>
        </div>
    `).join('');
}

async function markAnswered(questionId) {
    try {
        const { error } = await supabase.from('questions').update({ status: 'answered' }).eq('id', questionId);
        if (error) throw error;
        loadQuestions();
    } catch (err) {
        showError('Update Error: ' + err.message);
    }
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
        step.insertBefore(el, step.firstChild);
    }
    el.innerText = msg;
    el.classList.remove('hidden');
    // Re-trigger the slide-in + shake animation on every call
    el.classList.remove('step-error--animate');
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add('step-error--animate');
}
function clearStepError(stepId) {
    const el = document.getElementById(stepId).querySelector('.step-error');
    if (el) el.classList.add('hidden');
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
        const college = document.getElementById('target-college').value;
        const topic = document.getElementById('topic').value;
        const country = document.getElementById('country').value;
        const emailField = document.getElementById('applicant-email');
        const email = emailField.value.trim();

        if (!college || !topic || !country || !email) {
            return showStepError('step-1', 'Please fill in all fields, including your email, before continuing.');
        }
        // Validate email format here so problems are caught while the field is still visible
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            emailField.focus();
            return showStepError('step-1', "That email address doesn't look right. Please enter a valid email (e.g. you@example.com).");
        }
        clearStepError('step-1');
    }
    document.querySelectorAll('.form-step').forEach(el => el.classList.add('hidden')); document.getElementById(`step-${s}`).classList.remove('hidden');
}, showLogin, hideLogin, handleLogout, handleProfileUpdate, openQuestion, closeThread, loadQuestions, markAnswered };

document.addEventListener('DOMContentLoaded', init);
