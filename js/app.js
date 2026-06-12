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
    if (!email.endsWith('@uni.minerva.edu')) {
        alert('Only @uni.minerva.edu emails are allowed.');
        return;
    }
    try {
        const { error } = await supabase.auth.signInWithOtp({
            email: email,
            options: { emailRedirectTo: window.location.origin + window.location.pathname }
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
        college: document.getElementById('profile-college').value,
        country: document.getElementById('profile-country').value,
        gender: document.getElementById('profile-gender').value
    };
    try {
        const { error } = await supabase.from('profiles').update(profileData).eq('id', state.user.id);
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
    list.innerHTML = state.questions.map(q => `
        <div class="card">
            <h3>${q.topic}</h3>
            <p style="color: var(--mu-clay);">${q.target_college}</p>
            <p>${q.content.substring(0, 100)}...</p>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="badge">Match: ${q.matchScore}</span>
                <button class="btn btn-primary btn-sm" onclick="window.app.openQuestion('${q.id}')">Answer</button>
            </div>
        </div>
    `).join('');
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
        content: content, 
        context: document.getElementById('context').value,
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
    if (s===2 && (!document.getElementById('target-college').value || !document.getElementById('topic').value || !document.getElementById('country').value)) return alert('Fill all fields');
    document.querySelectorAll('.form-step').forEach(el => el.classList.add('hidden')); document.getElementById(`step-${s}`).classList.remove('hidden');
}, showLogin, hideLogin, handleLogout, handleProfileUpdate, openQuestion, closeThread };

document.addEventListener('DOMContentLoaded', init);
