// worker.js (Cloudflare Worker - ES Module)
const API_KEY = "GOKU"; // same as original (change if chahiye)
const TARGET_URL = "https://hostzo.rf.gd/hacker.php?i=1";
const SOURCE_NAME = "@gokuuuu_1"; // changed as per request
const REQUEST_TIMEOUT_MS = 30000;

// Exact headers from curl command (we'll copy these; Fetch may block some forbidden headers)
const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "sec-ch-ua-platform": '"Android"',
  "sec-ch-ua": '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  "sec-ch-ua-mobile": "?1",
  "Origin": "https://hostzo.rf.gd",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Referer": "https://hostzo.rf.gd/hacker.php?i=1",
  "Accept-Language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
  "Connection": "keep-alive"
};

// Helpers
function hexToBytes(hex) {
  if (!hex) return new Uint8Array(0);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
function pkcs7Unpad(u8) {
  if (u8.length === 0) return u8;
  const pad = u8[u8.length - 1];
  if (pad <= 0 || pad > 16) return u8;
  // validate padding bytes
  for (let i = 1; i <= pad; i++) {
    if (u8[u8.length - i] !== pad) return u8;
  }
  return u8.slice(0, u8.length - pad);
}
function stripTags(s) {
  return s.replace(/<[^>]*>/g, "");
}
function decodeEntities(str) {
  // basic HTML entity decode (covers common ones)
  return str.replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ");
}
function removeEmojis(s) {
  // remove surrogate-pair based emoji (most common)
  return s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
}
function cleanText(s) {
  if (!s) return "";
  let t = decodeEntities(stripTags(s));
  t = removeEmojis(t);
  t = t.replace(/[\uFE00-\uFE0F\u200D]/g, ""); // variation selectors & zwj
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// parse reply HTML: find pairs of label/value (similar logic to Python)
function parseReplyHtml(replyHtml) {
  const re = /<div[^>]*class=["']label["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*class=["']value["'][^>]*>([\s\S]*?)<\/div>/g;
  const results = {};
  let m;
  while ((m = re.exec(replyHtml)) !== null) {
    const labelRaw = m[1] || "";
    const valueRaw = m[2] || "";
    const label = cleanText(labelRaw);
    const value = cleanText(valueRaw);
    if (label) {
      const key = label.replace(/[^\w\s]/g, "").trim().toLowerCase().replace(/\s+/g, "_").replace(/:$/,"");
      if (key) results[key] = value;
    }
  }
  return results;
}

// Attempt to extract JS-challenge hex arrays and decrypt to produce __test cookie hex
async function attemptJsCookie(pageHtml) {
  // find all toNumbers("hex...") occurrences and take last three (as Python version)
  const re = /toNumbers\(\s*"([0-9a-fA-F]+)"\s*\)/g;
  const vals = [];
  let m;
  while ((m = re.exec(pageHtml)) !== null) vals.push(m[1]);
  if (vals.length < 3) return null;
  const a = vals[vals.length - 3];
  const b = vals[vals.length - 2];
  const c = vals[vals.length - 1];
  try {
    const keyBytes = hexToBytes(a);
    const ivBytes = hexToBytes(b);
    const cipherBytes = hexToBytes(c);

    // import key
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-CBC", length: 8 * keyBytes.length },
      false,
      ["decrypt"]
    );
    // decrypt
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, cipherBytes);
    let plain = new Uint8Array(plainBuf);
    // try PKCS#7 unpad
    plain = pkcs7Unpad(plain);
    // trim trailing zeros and whitespace
    let i = plain.length;
    while (i > 0 && (plain[i - 1] === 0 || plain[i - 1] === 32 || plain[i - 1] === 10 || plain[i - 1] === 13)) i--;
    plain = plain.slice(0, i);
    return bytesToHex(plain);
  } catch (e) {
    return null;
  }
}

// Perform upstream POST (multipart/form-data with 'message' field). Returns Response object.
async function upstreamPostNumber(num, cookieValue = null) {
  const headers = Object.assign({}, BASE_HEADERS);
  if (cookieValue) headers["Cookie"] = cookieValue;

  const formData = new FormData();
  formData.append("message", num);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(TARGET_URL, {
      method: "POST",
      headers: headers,
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return resp;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// Utility to create compact JSON Response with X-Source-Developer header
function makeJsonResponse(payloadObj, status = 200) {
  const body = JSON.stringify(payloadObj);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Source-Developer": SOURCE_NAME
  };
  return new Response(body, { status, headers });
}

// Worker entry point
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/fetch") {
        return new Response("Not Found", { status: 404 });
      }

      const providedKey = (url.searchParams.get("key") || "").trim();
      const num = (url.searchParams.get("num") || "").trim();

      // Validate API key
      if (!providedKey || providedKey !== API_KEY) {
        return makeJsonResponse({ ok: false, error: "Invalid or missing API key." }, 401);
      }

      // Validate phone number (10 digits)
      if (!/^\d{10}$/.test(num)) {
        return makeJsonResponse({ ok: false, error: "Provide a valid 10-digit phone number in ?num= parameter." }, 400);
      }

      // First try without cookie header
      let resp;
      try {
        resp = await upstreamPostNumber(num);
      } catch (e) {
        console.error("Upstream request failed (initial):", e);
        return makeJsonResponse({ ok: false, error: `Upstream request failed: ${String(e)}` }, 502);
      }

      let upstreamJson = null;
      let respText = null;
      try {
        upstreamJson = await resp.json();
      } catch (e) {
        // Not JSON; try solve JS challenge
        respText = await resp.text();
        const cookieHex = await attemptJsCookie(respText);
        if (!cookieHex) {
          console.warn("JS challenge present and not solvable (no cookie extracted)");
          return makeJsonResponse({ ok: false, error: "JS challenge not solvable." }, 502);
        }
        const cookieHeaderValue = `__test=${cookieHex}`;
        try {
          resp = await upstreamPostNumber(num, cookieHeaderValue);
          upstreamJson = await resp.json();
        } catch (err2) {
          console.error("Upstream failed after solving cookie:", err2);
          return makeJsonResponse({ ok: false, error: `Upstream request failed after cookie: ${String(err2)}` }, 502);
        }
      }

      // Extract results
      const results = [];
      if (upstreamJson && typeof upstreamJson === "object" && "reply" in upstreamJson) {
        results.push(parseReplyHtml(upstreamJson["reply"]));
      } else if (upstreamJson && typeof upstreamJson === "object" && "replies" in upstreamJson && Array.isArray(upstreamJson["replies"])) {
        for (const rhtml of upstreamJson["replies"]) {
          results.push(parseReplyHtml(rhtml));
        }
      } else {
        console.warn("Upstream returned unexpected structure", upstreamJson);
        return makeJsonResponse({ ok: false, error: "Upstream did not return expected data." }, 502);
      }

      const payload = {
        ok: true,
        results: results,
        source_developer: SOURCE_NAME
      };
      return makeJsonResponse(payload, 200);
    } catch (e) {
      console.error("Unexpected error in worker:", e);
      return makeJsonResponse({ ok: false, error: `Internal error: ${String(e)}` }, 500);
    }
  }
};
