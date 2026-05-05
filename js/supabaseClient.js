(function () {
  if (!window.SUPABASE_CONFIG) {
    console.warn("Supabase config missing.");
    return;
  }

  if (!window.supabase) {
    console.warn("Supabase library not loaded.");
    return;
  }

  const { url, publishableKey } = window.SUPABASE_CONFIG;

  window.supabaseClient = window.supabase.createClient(url, publishableKey);
})();