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

function stripeTimestampToIso(timestamp) {
    if (!timestamp) return null;

    const date = new Date(timestamp * 1000);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
}

function getSubscriptionProfileUpdate(subscription, options = {}) {
    const forceInactive = Boolean(options.forceInactive);
    const status = forceInactive ? "canceled" : subscription?.status || "unknown";
    const isPro = forceInactive ? false : isSubscriptionPro(status);
    const customerId =
        typeof subscription?.customer === "string"
            ? subscription.customer
            : subscription?.customer?.id;

    return {
        stripe_customer_id: options.customerId || customerId || null,
        stripe_subscription_id: options.subscriptionId || subscription?.id || null,
        subscription_status: status,
        is_pro: isPro,
        stripe_trial_end: stripeTimestampToIso(subscription?.trial_end),
        stripe_current_period_end: stripeTimestampToIso(subscription?.current_period_end),
        updated_at: new Date().toISOString()
    };
}

function isMissingStripeDateColumnError(error) {
    const errorText = [
        error?.code,
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(" ");

    return (
        error?.code === "42703" ||
        error?.code === "PGRST204" ||
        errorText.includes("stripe_trial_end") ||
        errorText.includes("stripe_current_period_end")
    );
}

async function updateProfileById(profileId, update, context) {
    const { error } = await supabaseAdmin
        .from("profiles")
        .update(update)
        .eq("id", profileId);

    if (!error) return;

    if (isMissingStripeDateColumnError(error)) {
        const fallbackUpdate = {
            ...update
        };

        delete fallbackUpdate.stripe_trial_end;
        delete fallbackUpdate.stripe_current_period_end;

        console.warn(
            "Stripe date columns are missing on public.profiles. Run supabase_stripe_subscription_columns.sql."
        );

        const { error: fallbackError } = await supabaseAdmin
            .from("profiles")
            .update(fallbackUpdate)
            .eq("id", profileId);

        if (!fallbackError) return;

        console.error(context, fallbackError);
        throw fallbackError;
    }

    console.error(context, error);
    throw error;
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

function getProfileResponse(user, profile) {
    const subscriptionStatus = profile?.subscription_status || "free";
    const isPro = Boolean(profile?.is_pro);

    return {
        userId: user.id,
        email: user.email || null,
        isPro,
        is_pro: isPro,
        subscriptionStatus,
        subscription_status: subscriptionStatus,
        stripeCustomerId: profile?.stripe_customer_id || null,
        stripe_customer_id: profile?.stripe_customer_id || null,
        stripeSubscriptionId: profile?.stripe_subscription_id || null,
        stripe_subscription_id: profile?.stripe_subscription_id || null,
        stripeTrialEnd: profile?.stripe_trial_end || null,
        stripe_trial_end: profile?.stripe_trial_end || null,
        stripeCurrentPeriodEnd: profile?.stripe_current_period_end || null,
        stripe_current_period_end: profile?.stripe_current_period_end || null
    };
}

async function ensureProfile(user) {
    if (!user || !user.id) return null;

    const now = new Date().toISOString();

    const { data: existingProfile, error: findError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

    if (findError) {
        console.error("Profile lookup error:", findError);
        throw new Error("Could not load user profile.");
    }

    if (existingProfile) {
        const update = {
            email: user.email || null,
            updated_at: now
        };

        const { data, error } = await supabaseAdmin
            .from("profiles")
            .update(update)
            .eq("id", user.id)
            .select()
            .single();

        if (error) {
            console.error("Profile update error:", error);
            throw new Error("Could not update user profile.");
        }

        return data;
    }

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .insert({
            id: user.id,
            email: user.email || null,
            subscription_status: "free",
            is_pro: false,
            updated_at: now
        })
        .select()
        .single();

    if (error) {
        console.error("Profile insert error:", error);
        throw new Error("Could not create user profile.");
    }

    return data;
}

async function findProfileForSubscription(subscription) {
    const userIdFromMetadata =
        subscription.metadata?.supabase_user_id ||
        subscription.metadata?.user_id;

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

    const update = getSubscriptionProfileUpdate(subscription, {
        forceInactive
    });

    console.log("Subscription status:", update.subscription_status);

    await updateProfileById(profile.id, update, "Subscription profile update error:");

    console.log(
        "Profile subscription updated:",
        profile.id,
        update.subscription_status,
        "is_pro:",
        update.is_pro
    );
}

async function updateProfileFromInvoicePaymentFailed(invoice) {
    const subscriptionId =
        typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;

    const customerId =
        typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;

    let query = supabaseAdmin
        .from("profiles")
        .update({
            subscription_status: "past_due",
            is_pro: false,
            updated_at: new Date().toISOString()
        });

    if (subscriptionId) {
        query = query.eq("stripe_subscription_id", subscriptionId);
    } else if (customerId) {
        query = query.eq("stripe_customer_id", customerId);
    } else {
        console.warn("invoice.payment_failed missing subscription/customer.");
        return;
    }

    const { error } = await query;

    if (error) {
        console.error("Invoice payment failed profile update error:", error);
        throw new Error("Could not update failed-payment profile.");
    }

    console.log("Subscription status:", "past_due");
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
            console.log("Stripe webhook received:", event.type);

            if (event.type === "checkout.session.completed") {
                const session = event.data.object;

                const userId =
                    session.client_reference_id ||
                    session.metadata?.supabase_user_id ||
                    session.metadata?.user_id;

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

                let subscription = null;

                if (subscriptionId) {
                    subscription = await stripe.subscriptions.retrieve(subscriptionId);
                }

                const update = subscription
                    ? getSubscriptionProfileUpdate(subscription, {
                        customerId,
                        subscriptionId
                    })
                    : {
                        stripe_customer_id: customerId || null,
                        stripe_subscription_id: subscriptionId || null,
                        subscription_status: "active",
                        is_pro: true,
                        stripe_trial_end: null,
                        stripe_current_period_end: null,
                        updated_at: new Date().toISOString()
                    };

                console.log("Subscription status:", update.subscription_status);

                await updateProfileById(userId, update, "Checkout profile update error:");

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

            if (event.type === "invoice.payment_failed") {
                const invoice = event.data.object;
                await updateProfileFromInvoicePaymentFailed(invoice);
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
        await ensureProfile(user);

        const appUrl = getAppUrl();

        const checkoutParams = {
            mode: "subscription",
            line_items: [
                {
                    price: process.env.STRIPE_PRICE_ID,
                    quantity: 1
                }
            ],
            success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/?checkout=cancel`,
            allow_promotion_codes: true,
            client_reference_id: user.id,
            customer_email: user.email || undefined,
            metadata: {
                supabase_user_id: user.id,
                email: user.email || ""
            },
            subscription_data: {
                trial_period_days: 7,
                metadata: {
                    supabase_user_id: user.id,
                    email: user.email || ""
                }
            }
        };

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

app.post("/create-billing-portal-session", async function (req, res) {
    try {
        if (!process.env.STRIPE_SECRET_KEY) {
            return res.status(500).json({
                error: "Stripe secret key is missing."
            });
        }

        const user = await getUserFromRequest(req);

        const { data: profile, error } = await supabaseAdmin
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .maybeSingle();

        if (error) {
            console.error("Billing portal profile lookup error:", error);
            return res.status(500).json({
                error: "Could not load profile."
            });
        }

        if (!profile || !profile.stripe_customer_id) {
            return res.status(400).json({
                error: "No Stripe customer found for this account."
            });
        }

        console.log("Creating billing portal session for customer:", profile.stripe_customer_id);

        const session = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: getAppUrl()
        });

        return res.json({
            url: session.url
        });

    } catch (error) {
        console.error("Stripe billing portal error message:", error.message);
        console.error("Stripe billing portal full error:", error);

        return res.status(getRequestErrorStatus(error)).json({
            error: error.message || "Unable to create billing portal session."
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
            session.client_reference_id ||
            session.metadata?.supabase_user_id ||
            session.metadata?.user_id;

        let subscription = null;
        let subscriptionStatus = "unknown";
        let isPro = false;
        let stripeTrialEnd = null;
        let stripeCurrentPeriodEnd = null;

        if (subscriptionId) {
            subscription = await stripe.subscriptions.retrieve(subscriptionId);
            subscriptionStatus = subscription.status;
            isPro = isSubscriptionPro(subscriptionStatus);
            stripeTrialEnd = stripeTimestampToIso(subscription.trial_end);
            stripeCurrentPeriodEnd = stripeTimestampToIso(subscription.current_period_end);
        }

        const isPaid =
            session.payment_status === "paid" ||
            session.status === "complete" ||
            isPro;

        if (userId && isPaid) {
            const update = subscription
                ? getSubscriptionProfileUpdate(subscription, {
                    customerId,
                    subscriptionId
                })
                : {
                    stripe_customer_id: customerId || null,
                    stripe_subscription_id: subscriptionId || null,
                    subscription_status: subscriptionStatus,
                    is_pro: isPro,
                    stripe_trial_end: stripeTrialEnd,
                    stripe_current_period_end: stripeCurrentPeriodEnd,
                    updated_at: new Date().toISOString()
                };

            console.log("Subscription status:", update.subscription_status);

            await updateProfileById(userId, update, "Verify checkout profile update error:");
        }

        return res.json({
            paid: isPaid,
            customerEmail: session.customer_details?.email || null,
            subscriptionId: subscriptionId || null,
            subscriptionStatus,
            isPro,
            stripeTrialEnd,
            stripeCurrentPeriodEnd
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

        return res.json(getProfileResponse(user, profile));

    } catch (error) {
        console.error("Profile status error:", error.message);

        return res.status(401).json({
            error: error.message || "Could not load profile status."
        });
    }
});

app.post("/api/profile", async function (req, res) {
    try {
        const user = await getUserFromRequest(req);
        const profile = await ensureProfile(user);

        return res.json(getProfileResponse(user, profile));

    } catch (error) {
        console.error("Profile sync error:", error);

        return res.status(getRequestErrorStatus(error)).json({
            error: error.message || "Could not sync profile."
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
