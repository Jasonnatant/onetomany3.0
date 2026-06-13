import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import express from "express";
import cors from "cors";
import path from "path";
import Stripe from "stripe";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

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

console.log("OpenAI key loaded:", process.env.OPENAI_API_KEY ? "YES" : "NO");
console.log("Stripe key loaded:", process.env.STRIPE_SECRET_KEY ? "YES" : "NO");
console.log("Stripe price loaded:", process.env.STRIPE_PRICE_ID ? "YES" : "NO");
console.log("Stripe webhook secret loaded:", process.env.STRIPE_WEBHOOK_SECRET ? "YES" : "NO");
console.log("Supabase URL loaded:", process.env.SUPABASE_URL ? "YES" : "NO");
console.log(
    "Supabase public key loaded:",
    process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY ? "YES" : "NO"
);
console.log("Supabase service key loaded:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "YES" : "NO");
console.log("App URL loaded:", process.env.APP_URL ? process.env.APP_URL : "NO - using fallback");

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("SUPABASE_SERVICE_ROLE_KEY is missing. Saved jobs cannot work without it.");
} else if (process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_")) {
    console.warn("SUPABASE_SERVICE_ROLE_KEY looks like a publishable key. It must be the backend service role key.");
}

/* ==========================
   CLIENTS
========================== */

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

/* ==========================
   HELPER FUNCTIONS
========================== */

function getAppUrl() {
    return process.env.APP_URL || "http://localhost:3000";
}

function isSubscriptionPro(status) {
    return status === "active" || status === "trialing";
}

async function getUserFromRequest(req) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
        throw new Error("Missing Supabase auth token.");
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data || !data.user) {
        throw new Error("Invalid Supabase auth token.");
    }

    return data.user;
}

function getRequestErrorStatus(error) {
    const message = error && error.message ? error.message : "";

    if (message.includes("Supabase auth token")) {
        return 401;
    }

    return 500;
}

async function ensureProfile(user) {
    if (!user || !user.id) return null;

    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .upsert(
            {
                id: user.id,
                email: user.email || null,
                updated_at: now
            },
            {
                onConflict: "id"
            }
        )
        .select()
        .single();

    if (error) {
        console.error("Profile upsert error:", error);
        throw new Error("Could not create or update user profile.");
    }

    return data;
}

async function findProfileForSubscription(subscription) {
    const userIdFromMetadata = subscription.metadata?.user_id;

    if (userIdFromMetadata) {
        return {
            id: userIdFromMetadata
        };
    }

    const subscriptionId = subscription.id;
    const customerId =
        typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;

    if (subscriptionId) {
        const { data } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("stripe_subscription_id", subscriptionId)
            .maybeSingle();

        if (data) return data;
    }

    if (customerId) {
        const { data } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();

        if (data) return data;
    }

    return null;
}

async function updateProfileFromSubscription(subscription, forceInactive = false) {
    const profile = await findProfileForSubscription(subscription);

    if (!profile || !profile.id) {
        console.warn("No matching Supabase profile found for subscription:", subscription.id);
        return;
    }

    const customerId =
        typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;

    const status = forceInactive ? "cancelled" : subscription.status;
    const isPro = forceInactive ? false : isSubscriptionPro(status);

    const { error } = await supabaseAdmin
        .from("profiles")
        .update({
            stripe_customer_id: customerId || null,
            stripe_subscription_id: subscription.id || null,
            subscription_status: status || "unknown",
            is_pro: isPro,
            updated_at: new Date().toISOString()
        })
        .eq("id", profile.id);

    if (error) {
        console.error("Subscription profile update error:", error);
        throw new Error("Could not update subscription profile.");
    }

    console.log("Profile subscription updated:", profile.id, status, "is_pro:", isPro);
}

/* ==========================
   STRIPE WEBHOOK
   IMPORTANT: This route must be BEFORE express.json()
========================== */

app.post(
    "/stripe-webhook",
    express.raw({ type: "application/json" }),
    async function (req, res) {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const signature = req.headers["stripe-signature"];

        if (!webhookSecret) {
            console.error("Missing STRIPE_WEBHOOK_SECRET.");
            return res.status(500).send("Webhook secret missing.");
        }

        let event;

        try {
            event = stripe.webhooks.constructEvent(
                req.body,
                signature,
                webhookSecret
            );
        } catch (error) {
            console.error("Webhook signature verification failed:", error.message);
            return res.status(400).send(`Webhook Error: ${error.message}`);
        }

        try {
            if (event.type === "checkout.session.completed") {
                const session = event.data.object;

                const userId =
                    session.metadata?.user_id ||
                    session.client_reference_id;

                const subscriptionId =
                    typeof session.subscription === "string"
                        ? session.subscription
                        : session.subscription?.id;

                const customerId =
                    typeof session.customer === "string"
                        ? session.customer
                        : session.customer?.id;

                if (!userId) {
                    console.warn("Checkout completed but no user_id was found in metadata.");
                    return res.json({ received: true });
                }

                let subscriptionStatus = "active";
                let isPro = true;

                if (subscriptionId) {
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                    subscriptionStatus = subscription.status;
                    isPro = isSubscriptionPro(subscriptionStatus);
                }

                const { error } = await supabaseAdmin
                    .from("profiles")
                    .update({
                        stripe_customer_id: customerId || null,
                        stripe_subscription_id: subscriptionId || null,
                        subscription_status: subscriptionStatus,
                        is_pro: isPro,
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", userId);

                if (error) {
                    console.error("Checkout profile update error:", error);
                    throw error;
                }

                console.log("Checkout completed for user:", userId);
            }

            if (event.type === "customer.subscription.updated") {
                const subscription = event.data.object;
                await updateProfileFromSubscription(subscription, false);
            }

            if (event.type === "customer.subscription.deleted") {
                const subscription = event.data.object;
                await updateProfileFromSubscription(subscription, true);
            }

            return res.json({
                received: true
            });

        } catch (error) {
            console.error("Webhook handling error:", error);
            return res.status(500).send("Webhook handler failed.");
        }
    }
);

/* ==========================
   MIDDLEWARE
========================== */

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/", function (req, res) {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/supabase-config", function (req, res) {
    const supabaseAnonKey =
        process.env.SUPABASE_ANON_KEY ||
        process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!process.env.SUPABASE_URL || !supabaseAnonKey) {
        return res.status(500).json({
            error: "Supabase public configuration is missing."
        });
    }

    return res.json({
        url: process.env.SUPABASE_URL,
        anonKey: supabaseAnonKey
    });
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

        const user = await getUserFromRequest(req);
        const profile = await ensureProfile(user);

        const appUrl = getAppUrl();

        const checkoutParams = {
            mode: "subscription",
            line_items: [
                {
                    price: process.env.STRIPE_PRICE_ID,
                    quantity: 1
                }
            ],
            success_url: `${appUrl}/?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/?checkout=cancelled`,
            allow_promotion_codes: true,
            client_reference_id: user.id,
            metadata: {
                user_id: user.id,
                email: user.email || ""
            },
            subscription_data: {
                metadata: {
                    user_id: user.id,
                    email: user.email || ""
                }
            }
        };

        if (profile && profile.stripe_customer_id) {
            checkoutParams.customer = profile.stripe_customer_id;
        } else if (user.email) {
            checkoutParams.customer_email = user.email;
        }

        const session = await stripe.checkout.sessions.create(checkoutParams);

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

        const subscriptionId =
            typeof session.subscription === "string"
                ? session.subscription
                : session.subscription?.id;

        const customerId =
            typeof session.customer === "string"
                ? session.customer
                : session.customer?.id;

        const userId =
            session.metadata?.user_id ||
            session.client_reference_id;

        let subscriptionStatus = "unknown";
        let isPro = false;

        if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            subscriptionStatus = subscription.status;
            isPro = isSubscriptionPro(subscriptionStatus);
        }

        const isPaid =
            session.payment_status === "paid" ||
            session.status === "complete" ||
            isPro;

        if (userId && isPaid) {
            const { error } = await supabaseAdmin
                .from("profiles")
                .update({
                    stripe_customer_id: customerId || null,
                    stripe_subscription_id: subscriptionId || null,
                    subscription_status: subscriptionStatus,
                    is_pro: isPro,
                    updated_at: new Date().toISOString()
                })
                .eq("id", userId);

            if (error) {
                console.error("Verify checkout profile update error:", error);
            }
        }

        return res.json({
            paid: isPaid,
            customerEmail: session.customer_details?.email || null,
            subscriptionId: subscriptionId || null,
            subscriptionStatus,
            isPro
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
   PROFILE STATUS
========================== */

app.get("/profile-status", async function (req, res) {
    try {
        const user = await getUserFromRequest(req);
        const profile = await ensureProfile(user);

        return res.json({
            userId: user.id,
            email: user.email || null,
            isPro: Boolean(profile?.is_pro),
            subscriptionStatus: profile?.subscription_status || "free"
        });

    } catch (error) {
        console.error("Profile status error:", error.message);

        return res.status(401).json({
            error: error.message || "Could not load profile status."
        });
    }
});

/* ==========================
   SAVED JOBS API
========================== */

app.get("/api/jobs", async function (req, res) {
    try {
        const user = await getUserFromRequest(req);

        const { data, error } = await supabaseAdmin
            .from("jobs")
            .select("*")
            .eq("user_id", user.id)
            .order("saved_at", { ascending: false });

        if (error) {
            throw error;
        }

        return res.json({
            jobs: data || []
        });

    } catch (error) {
        console.error("Get jobs error:", error);

        return res.status(getRequestErrorStatus(error)).json({
            error: error.message || "Could not load saved jobs."
        });
    }
});

app.post("/api/jobs", async function (req, res) {
    try {
        const user = await getUserFromRequest(req);
        await ensureProfile(user);

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
        } = req.body || {};

        if (!customerName || String(customerName).trim() === "") {
            return res.status(400).json({
                error: "Customer name is required."
            });
        }

        if (!estimatedPrice || String(estimatedPrice).trim() === "") {
            return res.status(400).json({
                error: "Estimated price is required."
            });
        }

        if (!timeline || String(timeline).trim() === "") {
            return res.status(400).json({
                error: "Timeline is required."
            });
        }

        if (!projectNotes || String(projectNotes).trim() === "") {
            return res.status(400).json({
                error: "Project notes are required."
            });
        }

        console.info("Save job request:", {
            userId: user.id,
            customerName,
            projectType,
            jobStatus: jobStatus || "Lead"
        });

        const now = new Date().toISOString();

        const row = {
            user_id: user.id,
            business_name: businessName || "",
            customer_name: customerName || "",
            customer_email: customerEmail || "",
            customer_phone: customerPhone || "",
            project_type: projectType || "",
            estimated_price: estimatedPrice || "",
            timeline: timeline || "",
            project_notes: projectNotes || "",
            job_status: jobStatus || "Lead",
            follow_up_date: followUpDate || null,
            saved_at: now,
            updated_at: now
        };

        const { data, error } = await supabaseAdmin
            .from("jobs")
            .insert(row)
            .select()
            .single();

        if (error) {
            throw error;
        }

        return res.status(201).json({
            job: data
        });

    } catch (error) {
        console.error("Save job full error:", error);
        console.error("Save job error message:", error.message);
        console.error("Save job error details:", error.details);
        console.error("Save job error code:", error.code);
        console.error("Save job error hint:", error.hint);

        return res.status(getRequestErrorStatus(error)).json({
            error: error.message || "Could not save job.",
            details: error.details || null,
            code: error.code || null,
            hint: error.hint || null
        });
    }
});

app.get("/api/jobs/:id", async function (req, res) {
    try {
        const user = await getUserFromRequest(req);
        const jobId = req.params.id;

        const { data, error } = await supabaseAdmin
            .from("jobs")
            .select("*")
            .eq("id", jobId)
            .eq("user_id", user.id)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            return res.status(404).json({
                error: "Saved job was not found."
            });
        }

        return res.json({
            job: data
        });

    } catch (error) {
        console.error("Load single job error:", error);

        return res.status(getRequestErrorStatus(error)).json({
            error: error.message || "Could not load job."
        });
    }
});

app.delete("/api/jobs/:id", async function (req, res) {
    try {
        const user = await getUserFromRequest(req);
        const jobId = req.params.id;

        const { data, error } = await supabaseAdmin
            .from("jobs")
            .delete()
            .eq("id", jobId)
            .eq("user_id", user.id)
            .select("id")
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            return res.status(404).json({
                error: "Saved job was not found."
            });
        }

        return res.json({
            success: true
        });

    } catch (error) {
        console.error("Delete job error:", error);

        return res.status(getRequestErrorStatus(error)).json({
            error: error.message || "Could not delete job."
        });
    }
});

app.delete("/api/jobs", async function (req, res) {
    try {
        const user = await getUserFromRequest(req);

        const { error } = await supabaseAdmin
            .from("jobs")
            .delete()
            .eq("user_id", user.id);

        if (error) {
            throw error;
        }

        return res.json({
            success: true
        });

    } catch (error) {
        console.error("Clear jobs error:", error);

        return res.status(getRequestErrorStatus(error)).json({
            error: error.message || "Could not clear jobs."
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
    console.log(`Open OneToMany Contractors at http://localhost:${PORT}`);
});
