/* Shared, file://-safe player preferences. Scenarios may read these values,
   but the settings stay engine-level so every page behaves consistently. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const KEY = "zs.settings.v1";
  const defaults = {
    muted: false,
    volume: 0.5,
    autoCamera: true,
  };

  let values = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === "object") values = { ...values, ...saved };
  } catch {
    // Private browsing and locked-down file:// profiles may deny storage.
  }

  values.muted = values.muted === true;
  values.volume = Math.max(0, Math.min(1, Number(values.volume) || 0));
  values.autoCamera = values.autoCamera !== false;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(values));
    } catch {
      // The preferences still work for this page when persistence is denied.
    }
  }

  function get(name) {
    return values[name];
  }

  function set(name, value) {
    if (!(name in defaults)) return;
    if (name === "volume") value = Math.max(0, Math.min(1, Number(value) || 0));
    else value = value === true;
    values[name] = value;
    save();
  }

  function soundLevel() {
    return values.muted ? 0 : values.volume;
  }

  ZS.settings = { get, set, soundLevel };
})();
