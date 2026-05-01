(function () {
  const SESSION_TOKEN_KEY = 'google-session-token';
  const LOGIN_EMAIL_KEY = 'google-login-email';

  let auth = null;
  let authConfig = null;
  let initPromise = null;
  const listeners = new Set();

  function emit(state) {
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (_err) {
        // UI listeners should not break auth state propagation.
      }
    });
  }

  function clearSession() {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(LOGIN_EMAIL_KEY);
  }

  function saveSession(result) {
    localStorage.setItem(SESSION_TOKEN_KEY, result.sessionToken || '');
    localStorage.setItem(LOGIN_EMAIL_KEY, result.email || '');
  }

  function hasFirebaseSdk() {
    return Boolean(window.firebase?.initializeApp && window.firebase?.auth);
  }

  function hasFirebaseConfig(config) {
    return Boolean(config?.apiKey && config?.authDomain && config?.projectId);
  }

  async function createBackendSession(user, forceRefresh = false) {
    const idToken = await user.getIdToken(forceRefresh);
    const result = await window.App.api.request('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
    saveSession(result);
    return result;
  }

  async function configureFirebase() {
    authConfig = await window.App.api.request('/api/auth/config');
    if (!authConfig.required) return authConfig;

    if (!hasFirebaseConfig(authConfig.firebaseConfig)) {
      return authConfig;
    }
    if (!hasFirebaseSdk()) {
      throw new Error('Firebase Auth SDK chưa được tải.');
    }

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(authConfig.firebaseConfig);
    }
    auth = window.firebase.auth();
    await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        clearSession();
        emit({ required: true, configured: true, authenticated: false });
        return;
      }

      try {
        const session = await createBackendSession(user);
        emit({
          required: true,
          configured: true,
          authenticated: true,
          email: session.email,
          name: session.name || '',
          picture: session.picture || '',
        });
      } catch (err) {
        clearSession();
        emit({
          required: true,
          configured: true,
          authenticated: false,
          error: err.message,
        });
      }
    });

    auth.getRedirectResult().catch((err) => {
      emit({
        required: true,
        configured: true,
        authenticated: false,
        error: err.message,
      });
    });

    return authConfig;
  }

  async function init(options = {}) {
    if (typeof options.onAuthStateChanged === 'function') {
      listeners.add(options.onAuthStateChanged);
    }
    if (!initPromise) initPromise = configureFirebase();
    return initPromise;
  }

  async function signIn() {
    if (!auth) throw new Error('Firebase Auth chưa sẵn sàng.');
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err.code)) {
        await auth.signInWithRedirect(provider);
        return;
      }
      throw err;
    }
  }

  async function signOut() {
    if (auth) await auth.signOut();
    clearSession();
    emit({ required: Boolean(authConfig?.required), configured: Boolean(auth), authenticated: false });
  }

  async function refreshSession(forceRefresh = false) {
    if (!auth?.currentUser) return null;
    return createBackendSession(auth.currentUser, forceRefresh);
  }

  window.App = window.App || {};
  window.App.FirebaseClient = {
    mode: 'firebase-auth',
    init,
    signIn,
    signOut,
    refreshSession,
    sessionToken() { return localStorage.getItem(SESSION_TOKEN_KEY) || ''; },
    email() { return localStorage.getItem(LOGIN_EMAIL_KEY) || ''; },
  };
})();
