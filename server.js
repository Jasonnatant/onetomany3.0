import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import express from "express";
import cors from "cors";
import path from "path";
import Stripe from "stripe";
import { fileURLToPath } from "url";

/* ==========================
   BASIC SERVER SETUP
========================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

/* ==========================
   ENV CHECKS
========================== */

console.log("API Key Loaded:", process.env.OPENAI_API_KEY ? "YES" : "NO");
console.log("Stripe Key Loaded:", process.env.STRIPE_SECRET_KEY ? "YES" : "NO");
console.log("Stripe Price Loaded:", process.env.STRIPE_PRICE_ID ? "YES" : "NO");
console.log("App URL Loaded:", process.env.APP_URL ? process.env.APP_URL : "NO - using fallback");

/* ==========================
   CLIENTS
========================== */

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ==========================
   MIDDLEWARE
========================== */

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/", function (req, res) {
    res.sendFile(path.join(__dirname, "index.html"));
});

/* ==========================
   STRIPE CHECKOUT
========================== */

app.post("/create-checkout-session", async function (req, res) {
    try {
        if (!process.env.STRIPE_SECRET_KEY) {
            return res.status(500).json({
                error: "Stripe secret key is missing."
            });
        }

        if (!process.env.STRIPE_PRICE_ID) {
            return res.status(500).json({
                error: "Stripe price ID is missing."
            });
        }

        const appUrl = process.env.APP_URL || "http://localhost:3000";

        const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            line_items: [
                {
                    price: process.env.STRIPE_PRICE_ID,
                    quantity: 1
                }
            ],
            success_url: `${appUrl}/?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/?checkout=cancelled`,
            allow_promotion_codes: true
        });

        return res.json({
            url: session.url
        });

    } catch (error) {
        console.error("Stripe checkout error message:", error.message);
        console.error("Stripe checkout full error:", error);

        return res.status(500).json({
            error: error.message || "Unable to create checkout session."
        });
    }
});

app.get("/verify-checkout-session", async function (req, res) {
    try {
        const sessionId = req.query.session_id;

        if (!sessionId) {
            return res.status(400).json({
                paid: false,
                error: "Missing session ID."
            });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const isPaid =
            session.payment_status === "paid" ||
            session.status === "complete" ||
            Boolean(session.subscription);

        return res.json({
            paid: isPaid,
            customerEmail: session.customer_details?.email || null,
            subscriptionId: session.subscription || null
        });

    } catch (error) {
        console.error("Stripe verify error message:", error.message);
        console.error("Stripe verify full error:", error);

        return res.status(500).json({
            paid: false,
            error: error.message || "Unable to verify checkout session."
        });
    }
});

/* ==========================
   OPENAI DOCUMENT GENERATION
========================== */

app.post("/generate-ai", async function (req, res) {
    try {
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({
                error: "OpenAI API key is missing."
            });
        }

        const {
            businessName,
            customerName,
            customerEmail,
            customerPhone,
            projectType,
            estimatedPrice,
            timeline,
            projectNotes,
            jobStatus,
            followUpDate
        } = req.body;

        const safeBusinessName = businessName || "Your Company Name";
        const safeCustomerName = customerName || "Customer";
        const safeCustomerEmail = customerEmail || "Not provided";
        const safeCustomerPhone = customerPhone || "Not provided";
        const safeProjectType = projectType || "General Contracting";
        const safeEstimatedPrice = estimatedPrice || "To be determined";
        const safeTimeline = timeline || "To be discussed";
        const safeProjectNotes = projectNotes || "Project details to be discussed.";
        const safeJobStatus = jobStatus || "Lead";
        const safeFollowUpDate = followUpDate || "Not set";

        const prompt = `
You are an assistant helping a small contractor create professional business documents.

Your job is to create documents that sound:
- Professional
- Clear
- Customer-friendly
- Contractor-style
- Confident but not pushy
- Easy for a homeowner or client to understand

Use this project data:

Business Name: ${safeBusinessName}
Customer Name: ${safeCustomerName}
Customer Email: ${safeCustomerEmail}
Customer Phone: ${safeCustomerPhone}
Project Type: ${safeProjectType}
Estimated Price: ${safeEstimatedPrice}
Estimated Timeline: ${safeTimeline}
Project Notes: ${safeProjectNotes}
Job Status: ${safeJobStatus}
Follow-Up Date: ${safeFollowUpDate}

Generate these 5 items:

1. Quote
2. Invoice
3. Service Agreement Draft
4. Customer Email
5. Follow-Up SMS

Important rules:

- Return ONLY valid JSON.
- Do not wrap the response in markdown.
- Do not include triple backticks.
- Do not include explanations outside the JSON.
- Keep the quote professional and useful.
- Keep the invoice clear and payment-focused.
- The service agreement must be labeled "SERVICE AGREEMENT DRAFT".
- The service agreement must NOT claim to be legal advice.
- The service agreement should include customer info, project info, scope of work, payment terms, change approval language, customer responsibilities, contractor responsibilities, and signature lines.
- Do NOT include a giant legal disclaimer inside the agreement text. The PDF export already adds a warning.
- The email should mention the estimate, timeline, project, and a simple next step.
- If a follow-up date is provided, include it naturally in the email.
- The SMS should be under 240 characters and should feel like a real contractor follow-up message.
- If the job status is "Quoted", write the email and SMS like the contractor is following up after sending an estimate.
- If the job status is "Lead", write the email and SMS like the contractor is responding to an interested customer.
- If the job status is "Won", write the email and SMS like the contractor is confirming next steps.
- If the job status is "Lost", keep the tone polite and professional.
- If the job status is "Completed", write the email and SMS like a completion/final follow-up.

Return JSON exactly in this structure:

{
  "quote": "professional quote text",
  "invoice": "professional invoice text",
  "agreement": "service agreement draft text",
  "email": {
    "subject": "email subject line",
    "body": "customer email body"
  },
  "sms": {
    "message": "short follow-up SMS"
  }
}
`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You create clean JSON business documents for contractor workflow software."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 1300,
            response_format: {
                type: "json_object"
            }
        });

        const text = response.choices[0].message.content;

        return res.json({
            result: text
        });

    } catch (error) {
        console.error("AI generation error message:", error.message);
        console.error("AI generation full error:", error);

        return res.status(500).json({
            error: error.message || "AI generation failed."
        });
    }
});

/* ==========================
   START SERVER
========================== */

app.listen(PORT, function () {
    console.log(`Server running on port ${PORT}`);
});