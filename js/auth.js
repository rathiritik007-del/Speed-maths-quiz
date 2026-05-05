(function () {
  window.authState = {
    user: null,
    isLoggedIn: false
  };

  async function refreshAuthState() {
    if (!window.supabaseClient) {
      console.warn("Supabase client missing.");
      return null;
    }

    const { data, error } = await window.supabaseClient.auth.getUser();

    if (error) {
      console.warn("Could not get current Supabase user:", error.message);
      window.authState.user = null;
      window.authState.isLoggedIn = false;
      return null;
    }

    window.authState.user = data.user || null;
    window.authState.isLoggedIn = !!data.user;

    return data.user || null;
  }

  async function signUpWithEmail(email, password) {
    if (!window.supabaseClient) throw new Error("Supabase client missing.");

    const { data, error } = await window.supabaseClient.auth.signUp({
      email: email,
      password: password
    });

    if (error) throw error;

    await refreshAuthState();
    return data;
  }

  async function loginWithEmail(email, password) {
    if (!window.supabaseClient) throw new Error("Supabase client missing.");

    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) throw error;

    await refreshAuthState();
    return data;
  }

  async function logoutUser() {
    if (!window.supabaseClient) throw new Error("Supabase client missing.");

    const { error } = await window.supabaseClient.auth.signOut();

    if (error) throw error;

    window.authState.user = null;
    window.authState.isLoggedIn = false;
  }

  function setupAuthUI() {
    const emailInput = document.getElementById("authEmail");
    const passwordInput = document.getElementById("authPassword");
    const signupBtn = document.getElementById("authSignupBtn");
    const loginBtn = document.getElementById("authLoginBtn");
    const logoutBtn = document.getElementById("authLogoutBtn");
    const statusEl = document.getElementById("authStatus");

    if (!emailInput || !passwordInput || !signupBtn || !loginBtn || !logoutBtn || !statusEl) {
      return;
    }

    function setStatus(message) {
      statusEl.textContent = message;
    }

    signupBtn.addEventListener("click", async function () {
      try {
        setStatus("Signing up...");
        await signUpWithEmail(emailInput.value.trim(), passwordInput.value);
        await refreshAuthState();
        setStatus(window.authState.isLoggedIn ? "Logged in" : "Check your email to confirm signup");
      } catch (error) {
        setStatus(error.message || "Signup failed");
      }
    });

    loginBtn.addEventListener("click", async function () {
      try {
        setStatus("Logging in...");
        await loginWithEmail(emailInput.value.trim(), passwordInput.value);
        await refreshAuthState();
        setStatus(window.authState.isLoggedIn ? "Logged in" : "Login failed");
      } catch (error) {
        setStatus(error.message || "Login failed");
      }
    });

    logoutBtn.addEventListener("click", async function () {
      try {
        setStatus("Logging out...");
        await logoutUser();
        setStatus("Not logged in");
      } catch (error) {
        setStatus(error.message || "Logout failed");
      }
    });

    refreshAuthState().then(function () {
      setStatus(window.authState.isLoggedIn ? "Logged in" : "Not logged in");
    });
  }

  window.refreshAuthState = refreshAuthState;
  window.signUpWithEmail = signUpWithEmail;
  window.loginWithEmail = loginWithEmail;
  window.logoutUser = logoutUser;

  if (window.supabaseClient) {
    window.supabaseClient.auth.onAuthStateChange(function (_event, session) {
      window.authState.user = session && session.user ? session.user : null;
      window.authState.isLoggedIn = !!window.authState.user;
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    refreshAuthState();
    setupAuthUI();
  });
})();