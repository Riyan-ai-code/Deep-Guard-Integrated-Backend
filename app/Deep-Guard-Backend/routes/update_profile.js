const express = require("express");
const bcrypt = require("bcryptjs");
const requireAuth = require("../middleware/auth");
const { supabase } = require("../config/supabase");

const router = express.Router();

// Format user helper
const formatUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  profile_picture:
    user.profile_picture ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`,
});
// ------------------------------------
// GET LOGGED-IN USER PROFILE
// ------------------------------------
router.get("/me", requireAuth, async (req, res) => {
  try {
    // START TRIAL CHECK
    if (req.user?.isTrial) {
      return res.json({
        id: 'trial_user',
        name: 'Guest User',
        email: 'guest@trial.com',
        profile_pic: `https://api.dicebear.com/7.x/avataaars/svg?seed=guest`,
      });
    }
    // END TRIAL CHECK

    const { data, error } = await supabase
      .from("users")
      .select("id, name, email, profile_picture")
      .eq("id", req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      id: data.id,
      name: data.name,
      email: data.email,
      profile_pic: data.profile_picture,
    });
  } catch (err) {
    console.error("GET /me Error:", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
});


// ------------------------------------
router.put("/update-profile", requireAuth, async (req, res) => {
  try {
    // START TRIAL CHECK
    if (req.user?.isTrial) {
      return res.json({
        success: true,
        user: {
          id: 'trial_user',
          name: req.body.name || 'Guest User',
          email: 'guest@trial.com',
          profile_picture: req.body.profile_pic || 'https://api.dicebear.com/7.x/avataaars/svg?seed=guest',
        }
      });
    }
    // END TRIAL CHECK

    const { name, profile_pic } = req.body;

    const updateFields = {};

    if (name !== undefined) updateFields.name = name;
    if (profile_pic !== undefined) updateFields.profile_picture = profile_pic;

    const { data, error } = await supabase
      .from("users")
      .update(updateFields)
      .eq("id", req.user.id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      user: {
        id: data.id,
        name: data.name,
        email: data.email,
        profile_picture: data.profile_picture, // NO FALLBACK
      },
    });
  } catch (err) {
    console.error("Profile Update Error:", err);
    return res.status(500).json({ message: "Failed to update profile" });
  }
});


// ------------------------------------
// CHANGE PASSWORD
// ------------------------------------
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    if (req.user?.isTrial) {
      return res.status(403).json({ message: "Trial users cannot change password." });
    }

    const { current_password, new_password } = req.body;

    const { data: user } = await supabase
      .from("users")
      .select("password_hash")
      .eq("id", req.user.id)
      .single();

    if (!user.password_hash)
      return res.status(400).json({ message: "Password login not enabled" });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid)
      return res.status(401).json({ message: "Incorrect current password" });

    const hashed = await bcrypt.hash(new_password, 10);

    await supabase
      .from("users")
      .update({ password_hash: hashed })
      .eq("id", req.user.id);

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Password Change Error:", err);
    res.status(500).json({ message: "Failed to change password" });
  }
});
router.delete("/delete-analyses", requireAuth, async (req, res) => {
  try {
    if (req.user?.isTrial) {
      return res.json({ success: true, message: "Trial session has no persistent history." });
    }

    const { error } = await supabase
      .from("analyses")
      .delete()
      .eq("user_id", req.user.id);

    if (error) throw error;

    res.json({ success: true, message: "All analyses deleted." });
  } catch (err) {
    console.error("Delete Analyses Error:", err);
    res.status(500).json({ message: "Failed to delete analyses" });
  }
});
// -------------------------------
// LOGOUT OTHER DEVICES (but keep current device)
// -------------------------------
// ------------------------------------
// LOGOUT ALL DEVICES (invalidate everyone, including this browser)
// ------------------------------------
router.post("/logout-all", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Increase token_version → invalidates ALL existing JWTs
    const { data: updated, error: versionError } = await supabase
      .from("users")
      .update({ token_version: req.user.tokenVersion + 1 })
      .eq("id", userId)
      .select("token_version")
      .single();

    if (versionError) throw versionError;

    // 2. Remove ALL sessions from DB
    const { error: sessionError } = await supabase
      .from("sessions")
      .delete()
      .eq("user_id", userId);

    if (sessionError) throw sessionError;

    // 3. Clear cookies from current device
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    res.clearCookie("trialAccess");

    return res.json({
      success: true,
      message: "Logged out from all devices",
    });
  } catch (err) {
    console.error("Logout-All Error:", err);
    res.status(500).json({ message: "Internal error" });
  }
});


router.delete("/delete-account", requireAuth, async (req, res) => {
  try {
    if (req.user?.isTrial) {
      res.clearCookie("trialAccess");
      return res.json({ success: true, message: "Trial ended." });
    }

    const { error } = await supabase
      .from("users")
      .delete()
      .eq("id", req.user.id);

    if (error) throw error;

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    res.clearCookie("trialAccess");

    res.json({ success: true, message: "Account deleted." });
  } catch (err) {
    console.error("Delete Account Error:", err);
    res.status(500).json({ message: "Failed to delete account" });
  }
});

module.exports = router;
