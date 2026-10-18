(function () {
  "use strict";

  // =====================================================
  // 1. CONFIGURATION
  // =====================================================

  const CONFIG = {
    defaultLocale: "en",

    supportedLocales: [
      "en",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "fr",
      "de",
      "es",
      "pt",
      "ru",
    ],

    messagesPath: "./messages",

    storageKey: "site_locale",
    cookieName: "site_locale",
    cookieMaxAge: 60 * 60 * 24 * 365,

    ipTimeout: 3000,
    jsonTimeout: 5000,

    enableIPDetection: true,
    enableOverlay: true,
  };

  // =====================================================
  // 2. COUNTRY -> LANGUAGE MAP
  // =====================================================

  const LANG_MAP = {
    US: "en",
    GB: "en",
    CA: "en",
    AU: "en",
    NZ: "en",
    IE: "en",
    SG: "en",

    VN: "vi",
    JP: "ja",
    KR: "ko",
    CN: "zh-CN",
    TW: "zh-TW",
    HK: "zh-TW",

    TH: "en",
    ID: "en",
    MY: "en",
    PH: "en",
    IN: "en",

    FR: "fr",
    DE: "de",
    ES: "es",
    PT: "pt",
    BR: "pt",
    BE: "fr",
    CH: "de",
    AT: "de",

    MX: "es",
    AR: "es",
    CO: "es",
    CL: "es",
    PE: "es",

    RU: "ru",
    UA: "en",

    SE: "en",
    NO: "en",
    DK: "en",
    FI: "en",

    NL: "en",
    IT: "en",
    PL: "en",

    ZA: "en",
    NG: "en",
    KE: "en",
  };

  // =====================================================
  // 3. STATE
  // =====================================================

  let currentLocale = CONFIG.defaultLocale;
  let messages = {};
  let initialized = false;
  let requestId = 0;

  const messageCache = Object.create(null);

  // =====================================================
  // 4. LOCALE HELPERS
  // =====================================================

  function isSupportedLocale(locale) {
    return CONFIG.supportedLocales.includes(locale);
  }

  function normalizeLocale(locale) {
    if (!locale || typeof locale !== "string") {
      return null;
    }

    const normalized = locale.trim().replace(/_/g, "-");

    if (isSupportedLocale(normalized)) {
      return normalized;
    }

    const base = normalized.split("-")[0].toLowerCase();

    return (
      CONFIG.supportedLocales.find((item) => item.toLowerCase() === base) ||
      null
    );
  }

  // =====================================================
  // 5. COOKIE + LOCAL STORAGE
  // =====================================================

  function getCookie(name) {
    const prefix = name + "=";

    const item = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(prefix));

    if (!item) return null;

    try {
      return decodeURIComponent(item.substring(prefix.length));
    } catch {
      return null;
    }
  }

  function setLocaleCookie(locale) {
    const secure = location.protocol === "https:" ? "; Secure" : "";

    document.cookie =
      CONFIG.cookieName +
      "=" +
      encodeURIComponent(locale) +
      "; Path=/" +
      "; Max-Age=" +
      CONFIG.cookieMaxAge +
      "; SameSite=Lax" +
      secure;
  }

  function getSavedLocale() {
    try {
      const saved = normalizeLocale(localStorage.getItem(CONFIG.storageKey));

      if (saved) return saved;
    } catch (error) {
      console.warn("Cannot read localStorage:", error);
    }

    return normalizeLocale(getCookie(CONFIG.cookieName));
  }

  function saveLocale(locale) {
    try {
      localStorage.setItem(CONFIG.storageKey, locale);
    } catch (error) {
      console.warn("Cannot save locale:", error);
    }

    try {
      setLocaleCookie(locale);
    } catch (error) {
      console.warn("Cannot save locale cookie:", error);
    }
  }

  // =====================================================
  // 6. DETECT LOCALE FROM URL
  // Example: /vi/ , /ja/
  // =====================================================

  function getLocaleFromURL() {
    const segments = location.pathname.split("/").filter(Boolean);

    if (!segments.length) return null;

    return normalizeLocale(segments[0]);
  }

  // =====================================================
  // 7. DETECT BROWSER LANGUAGE
  // =====================================================

  function getBrowserLocale() {
    const languages = navigator.languages || [navigator.language];

    for (const language of languages) {
      const locale = normalizeLocale(language);

      if (locale) return locale;
    }

    return null;
  }

  // =====================================================
  // 8. FETCH JSON WITH TIMEOUT
  // =====================================================

  async function fetchJSON(url, timeout) {
    const controller = new AbortController();

    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // =====================================================
  // 9. DETECT COUNTRY BY IP
  // Primary API + fallback API
  // =====================================================

  async function getCountryCode() {
    const providers = [
      {
        url: "https://apip.cc/json",
      },
      {
        url: "https://ipapi.co/json/",
      },
    ];

    for (const provider of providers) {
      try {
        const data = await fetchJSON(provider.url, CONFIG.ipTimeout);

        const code = (
          data.CountryCode ||
          data.country_code ||
          ""
        ).toUpperCase();

        if (/^[A-Z]{2}$/.test(code)) {
          return code;
        }
      } catch (error) {
        console.warn("IP detection failed:", provider.url);
      }
    }

    return "";
  }

  // =====================================================
  // 10. DETECT INITIAL LOCALE
  // Priority:
  // Saved preference -> URL -> Browser -> IP -> English
  // =====================================================

  async function detectLocale() {
    const saved = getSavedLocale();

    if (saved) return saved;

    const urlLocale = getLocaleFromURL();

    if (urlLocale) return urlLocale;

    const browserLocale = getBrowserLocale();

    if (browserLocale) return browserLocale;

    if (CONFIG.enableIPDetection) {
      const countryCode = await getCountryCode();
      const locale = normalizeLocale(LANG_MAP[countryCode]);

      if (locale) return locale;
    }

    return CONFIG.defaultLocale;
  }

  // =====================================================
  // 11. LOADING OVERLAY
  // =====================================================

  let overlay = null;
  let overlayTimer = null;

  function createOverlay() {
    if (!CONFIG.enableOverlay || overlay || !document.body) {
      return;
    }

    if (!document.getElementById("i18n-overlay-style")) {
      const style = document.createElement("style");

      style.id = "i18n-overlay-style";
      style.textContent = `
        @keyframes i18n-spin {
          to { transform: rotate(360deg); }
        }

        #i18n-overlay {
          position: fixed;
          inset: 0;
          z-index: 999999;
          background: rgba(255,255,255,.48);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 1;
          transition: opacity .3s ease;
        }

        #i18n-spinner {
          width: 36px;
          height: 36px;
          border: 3px solid #e0e0e0;
          border-top-color: #1877f2;
          border-radius: 50%;
          animation: i18n-spin .7s linear infinite;
        }
      `;

      document.head.appendChild(style);
    }

    overlay = document.createElement("div");
    overlay.id = "i18n-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-label", "Loading translations");

    const spinner = document.createElement("div");
    spinner.id = "i18n-spinner";

    overlay.appendChild(spinner);
    document.body.appendChild(overlay);

    overlayTimer = setTimeout(removeOverlay, 6000);
  }

  function removeOverlay() {
    if (overlayTimer) {
      clearTimeout(overlayTimer);
      overlayTimer = null;
    }

    if (!overlay) return;

    const element = overlay;
    overlay = null;

    element.style.opacity = "0";

    setTimeout(() => element.remove(), 320);
  }

  // =====================================================
  // 12. LOAD TRANSLATION JSON
  // =====================================================

  async function loadMessages(locale) {
    if (messageCache[locale]) {
      return messageCache[locale];
    }

    const data = await fetchJSON(
      CONFIG.messagesPath + "/" + encodeURIComponent(locale) + ".json",
      CONFIG.jsonTimeout,
    );

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid JSON: " + locale);
    }

    messageCache[locale] = data;

    return data;
  }

  // =====================================================
  // 13. GET TRANSLATION BY KEY
  // Example: t("home.title")
  // =====================================================

  function getValue(source, key) {
    if (!source || typeof key !== "string") {
      return undefined;
    }

    return key.split(".").reduce((value, part) => {
      if (
        value &&
        typeof value === "object" &&
        Object.prototype.hasOwnProperty.call(value, part)
      ) {
        return value[part];
      }

      return undefined;
    }, source);
  }

  function t(key, variables) {
    let value = getValue(messages, key);

    if (value === undefined && currentLocale !== CONFIG.defaultLocale) {
      value = getValue(messageCache[CONFIG.defaultLocale], key);
    }

    if (value === undefined || value === null) {
      return key;
    }

    if (typeof value !== "string" && typeof value !== "number") {
      return key;
    }

    let result = String(value);

    if (variables && typeof variables === "object") {
      result = result.replace(/\{(\w+)\}/g, (match, name) => {
        return Object.prototype.hasOwnProperty.call(variables, name)
          ? String(variables[name])
          : match;
      });
    }

    return result;
  }

  // =====================================================
  // 14. TRANSLATE HTML ELEMENTS
  // =====================================================

  function translatePage() {
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.getAttribute("data-i18n"));
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.setAttribute(
        "placeholder",
        t(element.getAttribute("data-i18n-placeholder")),
      );
    });

    document.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.setAttribute("title", t(element.getAttribute("data-i18n-title")));
    });

    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute(
        "aria-label",
        t(element.getAttribute("data-i18n-aria-label")),
      );
    });

    document.documentElement.lang = currentLocale;

    const titleKey = document.documentElement.getAttribute("data-i18n-title");

    if (titleKey) {
      document.title = t(titleKey);
    }

    document
      .querySelectorAll("#language-select, [data-i18n-select]")
      .forEach((selector) => {
        selector.value = currentLocale;
      });

    document.dispatchEvent(
      new CustomEvent("i18n:changed", {
        detail: { locale: currentLocale },
      }),
    );
  }

  // =====================================================
  // 15. CHANGE LANGUAGE WITHOUT RELOAD
  // =====================================================

  async function setLocale(locale) {
    const normalized = normalizeLocale(locale);

    if (!normalized) {
      console.warn("Unsupported locale:", locale);
      return false;
    }

    const thisRequest = ++requestId;

    try {
      let nextMessages;
      let actualLocale = normalized;

      try {
        nextMessages = await loadMessages(normalized);
      } catch (error) {
        console.error("Cannot load locale:", normalized, error);

        if (normalized === CONFIG.defaultLocale) {
          return false;
        }

        nextMessages = await loadMessages(CONFIG.defaultLocale);

        actualLocale = CONFIG.defaultLocale;
      }

      // Ignore stale requests.
      if (thisRequest !== requestId) {
        return false;
      }

      messages = nextMessages;
      currentLocale = actualLocale;

      saveLocale(currentLocale);
      translatePage();

      return true;
    } catch (error) {
      console.error("Translation error:", error);
      return false;
    }
  }

  // =====================================================
  // 16. INITIALIZE I18N
  // =====================================================

  async function initI18n() {
    if (initialized) return;

    initialized = true;
    createOverlay();

    try {
      // Load English for missing-key fallback.
      try {
        await loadMessages(CONFIG.defaultLocale);
      } catch (error) {
        console.warn("Cannot preload English translations.");
      }

      const locale = await detectLocale();

      await setLocale(locale);
    } catch (error) {
      console.error("i18n initialization failed:", error);
    } finally {
      removeOverlay();
    }
  }

  // =====================================================
  // 17. PUBLIC API
  // =====================================================

  window.i18n = {
    init: initI18n,
    setLocale,
    detectLocale,
    getCountryCode,
    getLocaleFromURL,
    getBrowserLocale,
    getSavedLocale,
    loadMessages,
    translatePage,
    t,

    getLocale() {
      return currentLocale;
    },

    getConfig() {
      return {
        defaultLocale: CONFIG.defaultLocale,
        supportedLocales: [...CONFIG.supportedLocales],
      };
    },
  };

  // Convenient global functions.
  window.setLocale = setLocale;
  window.t = t;

  // Start after DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initI18n, { once: true });
  } else {
    initI18n();
  }
})();
