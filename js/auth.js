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
      email,
      password
    });

    if (error) throw error;

    await refreshAuthState();
    return data;
  }

  async function loginWithEmail(email, password) {
    if (!window.supabaseClient) throw new Error("Supabase client missing.");

    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password
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
  });
})();