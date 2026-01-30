// middleware/auth.js
const jwt = require("jsonwebtoken");
const { supabase } = require("../config/supabase");
const crypto = require("crypto");

const isProduction = process.env.NODE_ENV === 'production';

// Must match controller cookie options
const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
  path: "/",
};

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const authMiddleware = async (req, res, next) => {
  try {
    const accessToken = req.cookies.accessToken || null;
    const refreshToken = req.cookies.refreshToken || null;

    // START TRIAL AUTH CHECK
    const trialToken = req.cookies.trialAccess;
    if (trialToken) {
      try {
        const decodedTrial = jwt.verify(trialToken, process.env.JWT_SECRET);
        // If valid, short-circuit standard auth
        req.user = {
          id: 'trial_user',
          name: 'Guest User',
          email: 'guest@trial.com',
          isTrial: true,
          trialSessionId: decodedTrial.sessionId
        };
        return next();
      } catch (e) { /* ignore and proceed to standard auth */ }
    }
    // END TRIAL AUTH CHECK

    if (!accessToken && !refreshToken) {
      return res.status(401).json({
        code: "NO_TOKENS",
        message: "Not authorized",
      });
    }

    let decoded = null;

    // ----------------------------------------------------
    // 1. TRY ACCESS TOKEN
    // ----------------------------------------------------
    if (accessToken) {
      try {
        decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      } catch (err) {
        if (err.name !== "TokenExpiredError") {
          return res.status(401).json({
            code: "INVALID_ACCESS",
            message: "Invalid access token",
          });
        }
      }
    }

    // ----------------------------------------------------
    // 2. ACCESS INVALID → TRY REFRESH TOKEN
    // ----------------------------------------------------
    if (!decoded && refreshToken) {
      let refreshDecoded;

      try {
        refreshDecoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET
        );
      } catch (err) {
        return res.status(401).json({
          code: "INVALID_REFRESH",
          message: "Session expired",
        });
      }

      const hashedRT = hashToken(refreshToken);

      // Look up refresh session
      const { data: session, error: sessionErr } = await supabase
        .from("sessions")
        .select("*")
        .eq("refresh_token_hash", hashedRT)
        .eq("user_id", refreshDecoded.userId)
        .single();

      if (sessionErr || !session) {
        return res.status(401).json({
          code: "REFRESH_NOT_FOUND",
          message: "Session expired",
        });
      }

      // Check DB expiration timestamp
      if (new Date(session.expires_at).getTime() < Date.now()) {
        await supabase.from("sessions").delete().eq("id", session.id);
        return res.status(401).json({
          code: "SESSION_EXPIRED",
          message: "Session expired",
        });
      }

      // Validate token_version
      const { data: userData, error: userErr } = await supabase
        .from("users")
        .select("token_version")
        .eq("id", refreshDecoded.userId)
        .single();

      if (userErr || !userData) {
        return res.status(401).json({
          code: "USER_NOT_FOUND",
          message: "User not found",
        });
      }

      if (userData.token_version !== refreshDecoded.tokenVersion) {
        await supabase.from("sessions").delete().eq("user_id", refreshDecoded.userId);
        return res.status(401).json({
          code: "TOKEN_VERSION_MISMATCH",
          message: "Session invalidated",
        });
      }

      // ----------------------------------------------------
      // 3. ROTATE REFRESH TOKEN (With Grace Period)
      // ----------------------------------------------------
      // To prevent race conditions with parallel requests, we:
      // 1. Create a NEW session with the new token
      // 2. Delete the OLD session after a short delay (Grace Period)

      const newRefreshToken = jwt.sign(
        {
          userId: refreshDecoded.userId,
          email: refreshDecoded.email,
          tokenVersion: userData.token_version,
        },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: "30d" }
      );

      const newHash = hashToken(newRefreshToken);

      // Create NEW session
      await supabase.from("sessions").insert({
        user_id: refreshDecoded.userId,
        refresh_token_hash: newHash,
        token_version_snapshot: userData.token_version,
        user_agent: req.headers["user-agent"],
        ip_address: req.ip,
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      });

      // Mark old session for deletion (Grace Period of 10 seconds)
      // This allows parallel requests matching the old hash to still proceed 
      // (by creating their own forked sessions) instead of failing immediately.
      setTimeout(async () => {
        try {
          await supabase.from("sessions").delete().eq("id", session.id);
        } catch (e) {
          console.error("Failed to cleanup old session:", e);
        }
      }, 10000); // 10 seconds grace period

      res.cookie("refreshToken", newRefreshToken, {
        ...COOKIE_OPTS,
        maxAge: 30 * 86400000,
      });

      // ----------------------------------------------------
      // 4. ISSUE NEW ACCESS TOKEN
      // ----------------------------------------------------
      const newAccessToken = jwt.sign(
        {
          userId: refreshDecoded.userId,
          email: refreshDecoded.email,
          tokenVersion: userData.token_version,
        },
        process.env.JWT_SECRET,
        { expiresIn: "15m" }
      );

      res.cookie("accessToken", newAccessToken, {
        ...COOKIE_OPTS,
        maxAge: 15 * 60 * 1000,
      });

      decoded = {
        userId: refreshDecoded.userId,
        email: refreshDecoded.email,
        tokenVersion: userData.token_version,
      };
    }

    // ----------------------------------------------------
    // 3. STILL NO DECODED? FAIL
    // ----------------------------------------------------
    if (!decoded) {
      return res.status(401).json({
        code: "AUTH_FAILED",
        message: "Not authorized",
      });
    }

    // ----------------------------------------------------
    // 4. FETCH USER AND ATTACH TO req.user
    // ----------------------------------------------------
    const { data: user, error: userErr2 } = await supabase
      .from("users")
      .select("id, name, email, profile_picture, token_version")
      .eq("id", decoded.userId)
      .single();

    if (userErr2 || !user) {
      return res.status(401).json({
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    if (user.token_version !== decoded.tokenVersion) {
      return res.status(401).json({
        code: "TOKEN_VERSION_MISMATCH",
        message: "Session invalidated",
      });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      profile_pic: user.profile_picture,
      tokenVersion: user.token_version,
    };

    return next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(401).json({
      code: "SERVER_ERROR",
      message: "Not authorized",
    });
  }
};

module.exports = authMiddleware;
