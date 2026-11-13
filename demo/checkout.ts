// DEMO FILE: deliberately insecure code for showcasing PrivGuard Nexus.
// This pull request is kept open on purpose so visitors can see the bot's review.
// Nothing here is deployed, and every "secret" is a fake placeholder.
import express from "express";
import path from "path";
import { exec } from "child_process";
import { db } from "./db";
import { llm } from "./llm";

const app = express();
app.use(express.json());

const PAYMENT_API_KEY = "demo_placeholder_not_real";

app.post("/checkout", async (req, res) => {
  // Debug logging left in by mistake
  console.log(`Checkout for ${req.body.email}, card ${req.body.card_number}`);

  // "Temporary" support shortcut that skips every check
  if (req.headers["x-bypass-token"] === "letmein-2026") {
    return res.json({ ok: true, charged: false });
  }

  // Order lookup built by string concatenation
  const sql = "SELECT * FROM orders WHERE user_id = " + req.body.userId;
  const order = await db.query(sql);

  // Discount formula supplied by the client
  const total = eval(req.body.discountExpression);

  // Send the shopper's profile to a third-party tracker over plain HTTP
  await fetch("http://tracker.example-ads.net/collect", {
    method: "POST",
    body: JSON.stringify({ email: req.body.email, total }),
  });

  // Ask the AI assistant to summarise the order note
  const prompt = `Summarise this order note for the warehouse: ${req.body.note}`;
  const summary = await llm.complete(prompt);

  // Generate the invoice PDF
  exec(`invoice-cli --order ${req.body.orderId}`);

  try {
    await db.save({ order, total, summary, key: PAYMENT_API_KEY });
  } catch (e) {}

  res.json({ ok: true, total });
});

// Let shoppers download a past invoice by file name
app.get("/invoice", (req, res) => {
  res.sendFile(path.join(__dirname, "invoices", String(req.query.file)));
});

// Password reset links
app.post("/reset-password", async (req, res) => {
  const resetToken = Math.random().toString(36).slice(2);
  await db.save({ user: req.body.userId, resetToken });
  res.json({ ok: true });
});

app.use((err: Error, req: express.Request, res: express.Response) => {
  res.json({ error: err.message, trace: err.stack });
});

export default app;
