(function () {
  window.authState = {
    user: null,
    isLoggedIn: false
  };

  let authMode = "login";
  let authOpenedFromScreen = null;
  let explicitAuthActionInFlight = false;
  let lastRenderedLoggedIn = null;

  async function refreshAuthState(options) {
    const shouldRunPostLoginSync = !!(options && options.runPostLoginSync);

    if (!window.supabaseClient) {
      console.warn("Supabase client missing.");
      window.authState.user = null;
      window.authState.isLoggedIn = false;
      updateAuthUI();
      return null;
    }

    const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();

    if (sessionError) {
      console.warn("Could not read Supabase auth session:", sessionError.message);
      window.authState.user = null;
      window.authState.isLoggedIn = false;
      updateAuthUI();
      window.updateSyncNotice?.();
      return null;
    }

    if (!sessionData || !sessionData.session) {
      window.authState.user = null;
      window.authState.isLoggedIn = false;
      updateAuthUI();
      window.updateSyncNotice?.();
      return null;
    }

    const { data, error } = await window.supabaseClient.auth.getUser();

    if (error) {
      console.warn("Could not get current Supabase user:", error.message);
      window.authState.user = null;
      window.authState.isLoggedIn = false;
      updateAuthUI();
      window.updateSyncNotice?.();
      return null;
    }

    window.authState.user = data.user || null;
    window.authState.isLoggedIn = !!data.user;
    updateAuthUI();
    window.updateSyncNotice?.();
    if (window.authState.isLoggedIn && shouldRunPostLoginSync) {
      window.migrateLocalAppStateToSupabase?.({ showStatus: true });
    }

    return data.user || null;
  }

  async function signUpWithEmail(email, password) {
    if (!window.supabaseClient) throw new Error("Supabase client missing.");

    explicitAuthActionInFlight = true;
    try {
      const { data, error } = await window.supabaseClient.auth.signUp({
        email: email,
        password: password
      });

      if (error) throw error;

      await refreshAuthState({ runPostLoginSync: true });
      return data;
    } finally {
      explicitAuthActionInFlight = false;
    }
  }

  async function loginWithEmail(email, password) {
    if (!window.supabaseClient) throw new Error("Supabase client missing.");

    explicitAuthActionInFlight = true;
    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (error) throw error;

      await refreshAuthState({ runPostLoginSync: true });
      return data;
    } finally {
      explicitAuthActionInFlight = false;
    }
  }

  async function logoutUser() {
    if (!window.supabaseClient) throw new Error("Supabase client missing.");

    const { error } = await window.supabaseClient.auth.signOut({ scope: "local" });

    if (error) throw error;

    window.authState.user = null;
    window.authState.isLoggedIn = false;
    updateAuthUI();
  }

  function getAuthEls() {
    return {
      modal: document.getElementById("authModal"),
      form: document.getElementById("authForm"),
      emailInput: document.getElementById("authEmail"),
      passwordInput: document.getElementById("authPassword"),
      submitBtn: document.getElementById("authSubmitBtn"),
      modeToggle: document.getElementById("authModeToggle"),
      closeBtn: document.getElementById("authCloseBtn"),
      logoutBtn: document.getElementById("authLogoutBtn"),
      statusEl: document.getElementById("authStatus"),
      titleEl: document.getElementById("authModalTitle"),
      subEl: document.getElementById("authModalSub"),
      userEmailEl: document.getElementById("authUserEmail"),
      userStateEl: document.getElementById("authUserState"),
      profileBtn: document.getElementById("authProfileBtn"),
      profileLogoutBtn: document.getElementById("authProfileLogoutBtn"),
      profileStatus: document.getElementById("authProfileStatus"),
      profileEmail: document.getElementById("authProfileEmail"),
      accountCard: document.querySelector(".auth-account-card")
    };
  }

  function setStatus(message, isError) {
    const { statusEl } = getAuthEls();
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function setAuthMode(mode) {
    authMode = mode === "signup" ? "signup" : "login";
    const { titleEl, subEl, submitBtn, modeToggle, passwordInput } = getAuthEls();
    const isSignup = authMode === "signup";

    if (titleEl) titleEl.textContent = isSignup ? "Sign up" : "Log in";
    if (subEl) {
      subEl.textContent = isSignup
        ? "Create an account to back up your progress."
        : "Sign in to sync your progress across devices.";
    }
    if (submitBtn) submitBtn.textContent = isSignup ? "Sign up" : "Log in";
    if (modeToggle) modeToggle.textContent = isSignup ? "Already have an account? Log in" : "New here? Create an account";
    if (passwordInput) passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
  }

  function openAuthModal(mode) {
    const { modal, emailInput } = getAuthEls();
    if (!modal) return;
    const activeScreen = document.querySelector(".screen.active");
    authOpenedFromScreen = activeScreen ? activeScreen.id : null;
    if (mode) setAuthMode(mode);
    updateAuthUI();
    modal.classList.remove("closing");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if (!window.authState.isLoggedIn && emailInput) {
      setTimeout(function () { emailInput.focus(); }, 0);
    }
  }

  function closeAuthModal() {
    const { modal } = getAuthEls();
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
    if (!modal.classList.contains("open")) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      modal.classList.remove("open", "closing");
      return;
    }
    modal.classList.add("closing");
    setTimeout(function () {
      modal.classList.remove("open", "closing");
    }, 180);
  }

  function updateAuthUI() {
    const els = getAuthEls();
    const user = window.authState.user;
    const loggedIn = !!user;
    const email = user && user.email ? user.email : "";

    if (els.modal) els.modal.classList.toggle("is-logged-in", loggedIn);
    if (els.userEmailEl) els.userEmailEl.textContent = email;
    if (els.userStateEl) els.userStateEl.textContent = loggedIn ? "Logged in" : "Not logged in";
    if (els.profileStatus) els.profileStatus.textContent = loggedIn ? "Logged in" : "Not logged in";
    if (els.profileEmail) els.profileEmail.textContent = email;
    if (els.profileBtn) els.profileBtn.textContent = loggedIn ? "Manage account" : "Sign in / Sync Progress";
    if (els.accountCard) els.accountCard.classList.toggle("logged-in", loggedIn);
    if (els.accountCard && lastRenderedLoggedIn !== null && lastRenderedLoggedIn !== loggedIn) {
      els.accountCard.classList.remove("auth-state-changing");
      void els.accountCard.offsetWidth;
      els.accountCard.classList.add("auth-state-changing");
      window.setTimeout(function () {
        els.accountCard?.classList.remove("auth-state-changing");
      }, 240);
    }
    lastRenderedLoggedIn = loggedIn;

    if (els.profileLogoutBtn) {
      els.profileLogoutBtn.disabled = !loggedIn;
    }

    if (els.statusEl && !els.modal?.classList.contains("open")) {
      setStatus(loggedIn ? "Logged in" : "Not logged in", false);
    }

    setAuthMode(authMode);
  }

  async function submitAuthForm(event) {
    event.preventDefault();
    const { emailInput, passwordInput, submitBtn } = getAuthEls();
    if (!emailInput || !passwordInput) return;

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setStatus("Enter an email and password.", true);
      return;
    }

    try {
      if (submitBtn) submitBtn.disabled = true;
      setStatus(authMode === "signup" ? "Creating account..." : "Logging in...", false);

      if (authMode === "signup") {
        await signUpWithEmail(email, password);
        setStatus(window.authState.isLoggedIn ? "Logged in" : "Check your email to confirm signup.", false);
      } else {
        await loginWithEmail(email, password);
        setStatus("Logged in", false);
      }

      passwordInput.value = "";
      updateAuthUI();
      if (window.authState.isLoggedIn) {
        const returnScreen = authOpenedFromScreen;
        closeAuthModal();
        if ((returnScreen === "s-profile" || returnScreen === "s-welcome") && typeof showProfile === "function") {
          setTimeout(function () { showProfile(); }, 0);
        }
      }
    } catch (error) {
      setStatus(error.message || (authMode === "signup" ? "Signup failed." : "Login failed."), true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function handleLogout() {
    try {
      setStatus("Logging out...", false);
      await logoutUser();
      setStatus("Not logged in", false);
      updateAuthUI();
    } catch (error) {
      setStatus(error.message || "Logout failed.", true);
    }
  }

  function setupAuthUI() {
    const els = getAuthEls();

    if (els.form) els.form.addEventListener("submit", submitAuthForm);
    if (els.modeToggle) {
      els.modeToggle.addEventListener("click", function () {
        setAuthMode(authMode === "signup" ? "login" : "signup");
        setStatus("", false);
      });
    }
    if (els.closeBtn) els.closeBtn.addEventListener("click", closeAuthModal);
    if (els.logoutBtn) els.logoutBtn.addEventListener("click", handleLogout);
    if (els.profileLogoutBtn) els.profileLogoutBtn.addEventListener("click", handleLogout);

    document.querySelectorAll("[data-auth-close]").forEach(function (el) {
      el.addEventListener("click", closeAuthModal);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeAuthModal();
    });

    setAuthMode("login");
    updateAuthUI();
  }

  window.refreshAuthState = refreshAuthState;
  window.signUpWithEmail = signUpWithEmail;
  window.loginWithEmail = loginWithEmail;
  window.logoutUser = logoutUser;
  window.openAuthModal = openAuthModal;
  window.closeAuthModal = closeAuthModal;
  window.setAuthMode = setAuthMode;
  window.updateAuthUI = updateAuthUI;

  if (window.supabaseClient) {
    window.supabaseClient.auth.onAuthStateChange(function (event, session) {
      window.authState.user = session && session.user ? session.user : null;
      window.authState.isLoggedIn = !!window.authState.user;
      updateAuthUI();
      window.updateSyncNotice?.();
      if (window.authState.isLoggedIn && event === "SIGNED_IN" && !explicitAuthActionInFlight) {
        window.migrateLocalAppStateToSupabase?.({ showStatus: true });
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupAuthUI();
    refreshAuthState();
  });
})();
