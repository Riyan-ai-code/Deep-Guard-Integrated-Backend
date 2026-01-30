const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { supabase } = require("../config/supabase");

const TRIAL_BUCKET = "trial_analyses";
const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day
const TRIAL_MAX_UPLOADS = 3;

const COOKIE_NAME = "trialAccess";
const JWT_SECRET = process.env.JWT_SECRET;

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
  path: "/",
};

// -----------------------------------------
// Fingerprint (binds trial to device forever)
// -----------------------------------------
const getDeviceFingerprint = (req) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    "unknown-ip";

  const ua = req.headers["user-agent"] || "unknown-ua";

  return crypto.createHash("sha256").update(ip + "|" + ua).digest("hex");
};

// -----------------------------------------
// Cleanup Session + bucket folder
// -----------------------------------------
async function cleanupSession(sessionId) {
  try {
    const list = await supabase.storage.from(TRIAL_BUCKET).list(sessionId, {
      limit: 1000,
      offset: 0,
    });

    if (list.data && list.data.length > 0) {
      const paths = list.data.map((f) => `${sessionId}/${f.name}`);
      await supabase.storage.from(TRIAL_BUCKET).remove(paths);
    }

    await supabase.from("trial_sessions").delete().eq("id", sessionId);
  } catch (err) {
    console.error("Cleanup error:", err);
  }
}

// -----------------------------------------
// Main trial middleware
// -----------------------------------------
const trialMiddleware = async (req, res, next) => {
  try {
    const fingerprint = getDeviceFingerprint(req);
    const token = req.cookies[COOKIE_NAME] || null;

    // -----------------------------------------
    // 1. TOKEN PRESENT → VERIFY
    // -----------------------------------------
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const { data: session, error } = await supabase
          .from("trial_sessions")
          .select("*")
          .eq("id", decoded.sessionId)
          .single();

        if (error || !session) {
          res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
          return res.status(403).json({
            requireSignIn: true,
            message: "Trial expired. Sign in to continue.",
          });
        }

        // Expired?
        if (new Date(session.expires_at).getTime() <= Date.now()) {
          await cleanupSession(session.id);
          res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
          return res.status(403).json({
            requireSignIn: true,
            message: "Your trial has expired. Sign in to continue.",
          });
        }

        req.trial = session;
        return next();
      } catch (err) {
        res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
      }
    }

    // -----------------------------------------
    // 2. NO TOKEN → CHECK IF DEVICE HAS SESSION
    // -----------------------------------------
    const { data: existing } = await supabase
      .from("trial_sessions")
      .select("*")
      .eq("client_id", fingerprint)
      .single();

    if (existing) {
      // expired?
      if (new Date(existing.expires_at).getTime() <= Date.now()) {
        await cleanupSession(existing.id);
        return res.status(403).json({
          requireSignIn: true,
          message: "Your trial has expired. Please sign in.",
        });
      }

      // REISSUE TOKEN because cookie was deleted
      const newToken = jwt.sign(
        { sessionId: existing.id },
        JWT_SECRET,
        { expiresIn: "1d" }
      );

      res.cookie(COOKIE_NAME, newToken, {
        ...COOKIE_OPTS,
        maxAge: TRIAL_DURATION_MS,
      });

      req.trial = existing;
      return next();
    }

    // -----------------------------------------
    // 3. CREATE NEW TRIAL SESSION
    // -----------------------------------------
    const expiresAt = new Date(Date.now() + TRIAL_DURATION_MS).toISOString();

    const { data: created, error } = await supabase
      .from("trial_sessions")
      .insert({
        client_id: fingerprint,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
        expires_at: expiresAt,
        analysis_count: 0,
      })
      .select("*")
      .single();

    if (error) {
      return res.status(500).json({
        message: "Unable to start trial session",
      });
    }

    const tokenPayload = { sessionId: created.id };
    const trialToken = jwt.sign(tokenPayload, JWT_SECRET, {
      expiresIn: "1d",
    });

    res.cookie(COOKIE_NAME, trialToken, {
      ...COOKIE_OPTS,
      maxAge: TRIAL_DURATION_MS,
    });

    req.trial = created;
    return next();
  } catch (err) {
    console.error("Trial middleware error:", err);
    return res.status(500).json({
      message: "Trial system error",
    });
  }
};

module.exports = trialMiddleware;
