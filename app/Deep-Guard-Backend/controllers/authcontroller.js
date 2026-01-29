// controllers/authcontroller.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");
const { supabase } = require("../config/supabase");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// -------------------------------------------------
// COOKIE OPTIONS (MUST MATCH middleware)
// -------------------------------------------------
const isProduction = process.env.NODE_ENV === 'production';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProduction, // Secure in Prod, Not in Dev
  sameSite: isProduction ? "none" : "lax", // None for Cross-Site Prod, Lax for Local
  path: "/"
};



const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createAccessToken = (userId, email, version) =>
  jwt.sign({ userId, email, tokenVersion: version }, process.env.JWT_SECRET, {
    expiresIn: "15m",
  });

const createRefreshToken = (userId, email, version) =>
  jwt.sign(
    { userId, email, tokenVersion: version },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "30d" }
  );

const setAuthCookies = (res, access, refresh) => {
  res.cookie("accessToken", access, {
    ...COOKIE_OPTS,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", refresh, {
    ...COOKIE_OPTS,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
};

const clearAuthCookies = (res) => {
  res.clearCookie("accessToken", {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
  });

  res.clearCookie("refreshToken", {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
  });

  // Clear trial cookie too
  res.clearCookie("trialAccess", {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
  });
};


const createSession = async (req, user, refreshToken) => {
  const hashed = hashToken(refreshToken);
  await supabase.from("sessions").insert({
    user_id: user.id,
    refresh_token_hash: hashed,
    token_version_snapshot: user.token_version,
    user_agent: req.headers["user-agent"],
    ip_address: req.ip,
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  });
};

// -------------------------------------------------
// EMAIL TRANSPORT
// -------------------------------------------------
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// -------------------------------------------------
// FORMATTED USER RESPONSE
// -------------------------------------------------
const formatUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  profilePicture:
    u.profile_picture ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.email}`,
});

// -------------------------------------------------
// OTP STORES
// -------------------------------------------------
const signupOtpStore = new Map();
const resetOtpStore = new Map();

const SIGNUP_EXP = 5 * 60 * 1000;
const RESET_EXP = 5 * 60 * 1000;

// -----------------------------------------------------
// SEND SIGNUP OTP
// -----------------------------------------------------
exports.sendSignupOtp = async (req, res) => {
  try {
    const { email, name } = req.body;
    const normalized = email.toLowerCase().trim();

    const { data: exists } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalized)
      .single();

    if (exists) return res.status(400).json({ message: "User already exists" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashed = await bcrypt.hash(otp, 10);

    signupOtpStore.set(normalized, {
      hashedOtp: hashed,
      expiresAt: Date.now() + SIGNUP_EXP,
      name,
    });

    await mailer.sendMail({
      from: `"Deep Guard" <${process.env.EMAIL_USER}>`,
      to: normalized,
      subject: "Verify your account",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #f9f9f9;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #333;">Deep Guard</h2>
          </div>
          <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="color: #555; font-size: 16px;">Hello ${name || 'User'},</p>
            <p style="color: #555; font-size: 16px;">Thank you for signing up with Deep Guard. To complete your registration, please use the verification code below:</p>
            <div style="text-align: center; margin: 30px 0;">
              <span style="font-size: 32px; font-weight: bold; color: #4F46E5; letter-spacing: 5px; background: #EEF2FF; padding: 10px 20px; border-radius: 5px; border: 1px dashed #4F46E5;">
                ${otp}
              </span>
            </div>
            <p style="color: #555; font-size: 14px;">This code will expire in 5 minutes.</p>
            <p style="color: #888; font-size: 12px; margin-top: 20px;">If you did not request this code, please ignore this email.</p>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #aaa; font-size: 12px;">
            &copy; ${new Date().getFullYear()} Deep Guard. All rights reserved.
          </div>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

// -----------------------------------------------------
// SIGNUP
// -----------------------------------------------------
exports.signup = async (req, res) => {
  try {
    const { email, password, name, otp } = req.body;
    const normalized = email.toLowerCase().trim();

    const entry = signupOtpStore.get(normalized);
    if (!entry) return res.status(400).json({ message: "OTP not requested" });

    if (Date.now() > entry.expiresAt)
      return res.status(400).json({ message: "OTP expired" });

    const valid = await bcrypt.compare(otp, entry.hashedOtp);
    if (!valid) return res.status(400).json({ message: "Invalid OTP" });

    const hash = await bcrypt.hash(password, 10);

    const { data: user } = await supabase
      .from("users")
      .insert({
        email: normalized,
        name: name || normalized.split("@")[0],
        password_hash: hash,
        token_version: 1,
      })
      .select()
      .single();

    signupOtpStore.delete(normalized);

    const access = createAccessToken(user.id, user.email, user.token_version);
    const refresh = createRefreshToken(
      user.id,
      user.email,
      user.token_version
    );

    await createSession(req, user, refresh);
    setAuthCookies(res, access, refresh);

    res.json({ user: formatUser(user) });
  } catch (err) {
    res.status(500).json({ message: "Signup failed" });
  }
};

// -----------------------------------------------------
// LOGIN
// -----------------------------------------------------
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const normalized = email.toLowerCase().trim();

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", normalized)
      .single();

    if (!user) return res.status(404).json({ message: "User does not exist" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ message: "Invalid credentials" });

    const access = createAccessToken(user.id, user.email, user.token_version);
    const refresh = createRefreshToken(
      user.id,
      user.email,
      user.token_version
    );

    await createSession(req, user, refresh);
    setAuthCookies(res, access, refresh);

    res.json({ user: formatUser(user) });
  } catch (err) {
    res.status(500).json({ message: "Login failed" });
  }
};

// -----------------------------------------------------
// GOOGLE LOGIN
// -----------------------------------------------------
exports.googleLogin = async (req, res) => {
  try {
    const { credentials } = req.body;

    const ticket = await googleClient.verifyIdToken({
      idToken: credentials,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("google_id", googleId)
      .single();

    if (!user) {
      const insert = await supabase
        .from("users")
        .insert({
          google_id: googleId,
          email,
          name,
          profile_picture: picture,
          token_version: 1,
        })
        .select()
        .single();

      user = insert.data;
    }

    const access = createAccessToken(user.id, user.email, user.token_version);
    const refresh = createRefreshToken(
      user.id,
      user.email,
      user.token_version
    );

    await createSession(req, user, refresh);
    setAuthCookies(res, access, refresh);

    res.json({ user: formatUser(user) });
  } catch (err) {
    res.status(401).json({ message: "Invalid Google token" });
  }
};

// -----------------------------------------------------
// SEND RESET OTP (FORGOT PASSWORD)
// -----------------------------------------------------
exports.sendResetOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const normalized = email.toLowerCase().trim();

    const { data: user } = await supabase
      .from("users")
      .select("id, email")
      .eq("email", normalized)
      .single();

    if (!user)
      return res.status(400).json({ message: "Email not found" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);

    resetOtpStore.set(normalized, {
      hashedOtp,
      expiresAt: Date.now() + RESET_EXP,
    });

    await mailer.sendMail({
      from: `"Deep Guard" <${process.env.EMAIL_USER}>`,
      to: normalized,
      subject: "Reset Password",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #f9f9f9;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #333;">Deep Guard</h2>
          </div>
          <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="color: #555; font-size: 16px;">Hello,</p>
            <p style="color: #555; font-size: 16px;">You requested to reset your password. Use the code below to proceed:</p>
            <div style="text-align: center; margin: 30px 0;">
              <span style="font-size: 32px; font-weight: bold; color: #DC2626; letter-spacing: 5px; background: #FEF2F2; padding: 10px 20px; border-radius: 5px; border: 1px dashed #DC2626;">
                ${otp}
              </span>
            </div>
            <p style="color: #555; font-size: 14px;">This code will expire in 5 minutes.</p>
            <p style="color: #888; font-size: 12px; margin-top: 20px;">If you did not request a password reset, please ignore this email immediately.</p>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #aaa; font-size: 12px;">
            &copy; ${new Date().getFullYear()} Deep Guard. All rights reserved.
          </div>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to send reset OTP" });
  }
};

// -----------------------------------------------------
// RESET PASSWORD
// -----------------------------------------------------
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const normalized = email.toLowerCase().trim();

    const entry = resetOtpStore.get(normalized);

    if (!entry)
      return res.status(400).json({ message: "OTP not requested" });

    if (Date.now() > entry.expiresAt) {
      resetOtpStore.delete(normalized);
      return res.status(400).json({ message: "OTP expired" });
    }

    const valid = await bcrypt.compare(otp, entry.hashedOtp);
    if (!valid)
      return res.status(400).json({ message: "Invalid OTP" });

    const newHash = await bcrypt.hash(newPassword, 10);

    const { data: user } = await supabase
      .from("users")
      .update({ password_hash: newHash })
      .eq("email", normalized)
      .select("id")
      .single();

    resetOtpStore.delete(normalized);
    await supabase.from("sessions").delete().eq("user_id", user.id);

    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ message: "Reset failed" });
  }
};
exports.refresh = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken)
      return res.status(401).json({ message: "No refresh token" });

    // 1. Verify JWT signature
    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    const { userId, email, tokenVersion } = payload;

    // 2. Hash token and check it exists in sessions
    const hashed = hashToken(refreshToken);

    const { data: session } = await supabase
      .from("sessions")
      .select("*")
      .eq("refresh_token_hash", hashed)
      .single();

    if (!session)
      return res.status(401).json({ message: "Session not found" });

    // 3. Verify token_version has not changed
    const { data: user } = await supabase
      .from("users")
      .select("id, email, token_version")
      .eq("id", userId)
      .single();

    if (!user)
      return res.status(401).json({ message: "User not found" });

    if (user.token_version !== tokenVersion) {
      // version mismatch = user logged out everywhere
      await supabase.from("sessions").delete().eq("user_id", userId);
      clearAuthCookies(res);
      return res.status(401).json({ message: "Token version invalid" });
    }

    // 4. Rotate refresh token (With Grace Period)
    const newAccess = createAccessToken(user.id, user.email, user.token_version);
    const newRefresh = createRefreshToken(user.id, user.email, user.token_version);
    const newHash = hashToken(newRefresh);

    // Create NEW session
    await supabase.from("sessions").insert({
      user_id: user.id,
      refresh_token_hash: newHash,
      token_version_snapshot: user.token_version,
      user_agent: req.headers["user-agent"],
      ip_address: req.ip,
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    // Mark old session for deletion (Grace Period of 10 seconds)
    setTimeout(async () => {
      try {
        await supabase.from("sessions").delete().eq("id", session.id);
      } catch (e) {
        console.error("Failed to cleanup old session:", e);
      }
    }, 10000); // 10 seconds grace period

    // 5. Set new cookies
    setAuthCookies(res, newAccess, newRefresh);

    return res.json({
      success: true,
      accessToken: newAccess,
    });

  } catch (err) {
    console.error("REFRESH ERROR:", err);
    return res.status(500).json({ message: "Refresh failed" });
  }
};

// -----------------------------------------------------
// GET ME
// -----------------------------------------------------
exports.getMe = (req, res) => {
  // START TRIAL SUPPORT
  if (req.user?.isTrial) {
    return res.json({
      id: 'trial_user',
      name: 'Guest User',
      email: 'guest@trial.com',
      profilePicture: `https://api.dicebear.com/7.x/avataaars/svg?seed=guest`,
      isTrial: true
    });
  }
  // END TRIAL SUPPORT
  res.json(formatUser(req.user));
};

// -----------------------------------------------------
// LOGOUT (CURRENT SESSION)
// -----------------------------------------------------
exports.logout = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      const hashed = hashToken(refreshToken);
      await supabase
        .from("sessions")
        .delete()
        .eq("refresh_token_hash", hashed);
    }

    clearAuthCookies(res);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Logout failed" });
  }
};

// -----------------------------------------------------
// LOGOUT ALL DEVICES
// -----------------------------------------------------
exports.logoutAllDevices = async (req, res) => {
  try {
    await supabase
      .from("users")
      .update({
        token_version: req.user.tokenVersion + 1,
      })
      .eq("id", req.user.id);

    await supabase.from("sessions").delete().eq("user_id", req.user.id);

    clearAuthCookies(res);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Logout-all failed" });
  }
};
