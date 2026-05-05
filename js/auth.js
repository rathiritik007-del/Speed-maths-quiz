(function () {
  window.authState = {
    user: null,
    isLoggedIn: false
  };

  async function getCurrentUser() {
    if (!window.supabaseClient) {
      console.warn("Supabase client missing.");
      return null;
    }

    const { data, error } = await window.supabaseClient.auth.getUser();

    if (error) {
      console.warn("Could not get current Supabase user:", error.message);
      return null;
    }

    window.authState.user = data.user || null;
    window.authState.isLoggedIn = !!data.user;

    return data.user || null;
  }

  window.getCurrentUser = getCurrentUser;

  document.addEventListener("DOMContentLoaded", function () {
    getCurrentUser();
  });
})();