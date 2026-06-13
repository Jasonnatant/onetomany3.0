const generateButton = document.getElementById("generateAllBtn");
const saveJobButton = document.getElementById("saveJobBtn");
const clearFormBtn = document.getElementById("clearFormBtn");
const estimatedPriceInput = document.getElementById("estimatedPrice");
const savedJobsList = document.getElementById("savedJobsList");
const clearJobsBtn = document.getElementById("clearJobsBtn");

/* ==========================
   SUPABASE AUTH SETTINGS
========================== */

let supabaseClient = null;
let currentUser = null;
let supabaseSetupError = null;
let authInitialized = false;

const authSection = document.getElementById("authSection");
const authEmailInput = document.getElementById("authEmail");
const authPasswordInput = document.getElementById("authPassword");
const signupBtn = document.getElementById("signupBtn");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");
const navAuthStatus = document.getElementById("navAuthStatus");

function isSupabaseConfigured() {
    return !!supabaseClient;
}

function getApiUrl(path) {
    return path;
}

async function fetchSupabasePublicConfig() {
    const configUrl = "/supabase-config";

    try {
        const response = await fetch(configUrl, {
            cache: "no-store"
        });

        const config = await response.json();

        console.info("Supabase config response:", config);
        console.info("Supabase config status:", {
            url: configUrl,
            hasUrl: Boolean(config.url),
            hasAnonKey: Boolean(config.anonKey)
        });

        if (!response.ok) {
            throw new Error(config.error || "Could not load Supabase config.");
        }

        if (!config.url || !config.anonKey) {
            console.error("Invalid Supabase config object:", config);
            throw new Error("Supabase config is missing url or anonKey.");
        }

        return config;

    } catch (error) {
        console.error("Supabase config fetch failed:", {
            url: configUrl,
            error
        });
        throw error;
    }
}

async function setupSupabaseClient() {
    try {
        supabaseSetupError = null;

        console.info("window.supabase exists:", Boolean(window.supabase));

        if (!window.supabase || !window.supabase.createClient) {
            throw new Error("Supabase library failed to load.");
        }

        const config = await fetchSupabasePublicConfig();

        supabaseClient = window.supabase.createClient(
            config.url,
            config.anonKey
        );

        console.info("Supabase client created:", Boolean(supabaseClient));

        return true;

    } catch (error) {
        console.error("Supabase setup error:", error);
        supabaseSetupError = error;
        supabaseClient = null;
        return false;
    }
}

function showElement(element, shouldShow, displayValue = "") {
    if (!element) return;

    if (shouldShow) {
        element.classList.remove("hidden");
        element.style.display = displayValue;
    } else {
        element.classList.add("hidden");
        element.style.display = "none";
    }
}

function setAuthButtonsDisabled(isDisabled) {
    if (signupBtn) signupBtn.disabled = isDisabled;
    if (loginBtn) loginBtn.disabled = isDisabled;
    if (logoutBtn) logoutBtn.disabled = isDisabled;
}

function getAuthCredentials() {
    const email = authEmailInput ? authEmailInput.value.trim() : "";
    const password = authPasswordInput ? authPasswordInput.value : "";

    return {
        email,
        password
    };
}

function validateAuthCredentials(email, password) {
    if (!email) {
        showToast("Please enter your email.", "warning");
        return false;
    }

    if (!password || password.length < 6) {
        showToast("Please enter a password with at least 6 characters.", "warning");
        return false;
    }

    return true;
}

function updateAuthUI() {
    const configured = isSupabaseConfigured();

    if (!configured) {
        showElement(authSection, false);

        if (authStatus) {
            authStatus.textContent = supabaseSetupError
                ? supabaseSetupError.message
                : "Login is loading...";
        }

        if (navAuthStatus) {
            navAuthStatus.textContent = "Auth setup pending";
        }

        showElement(logoutBtn, false);
        document.body.classList.remove("auth-locked");
        return;
    }

    if (currentUser) {
        showElement(authSection, false);

        if (authStatus) {
            authStatus.textContent = `Signed in as ${currentUser.email}`;
        }

        if (navAuthStatus) {
            navAuthStatus.textContent = currentUser.email || "Signed in";
        }

        showElement(logoutBtn, true, "inline-flex");
        document.body.classList.remove("auth-locked");

        refreshProfileStatus();

        return;
    }

    showElement(authSection, true, "block");

    if (authStatus) {
        authStatus.textContent = "Not signed in. Create an account or log in to use the app.";
    }

    if (navAuthStatus) {
        navAuthStatus.textContent = "Not signed in";
    }

    showElement(logoutBtn, false);
    document.body.classList.add("auth-locked");
}

function isUserSignedIn() {
    return !!currentUser;
}

function requireSignedIn() {
    if (!authInitialized) {
        showToast("Login is still loading. Try again in a second.", "warning");
        return false;
    }

    if (!isSupabaseConfigured()) {
        showToast("Supabase auth setup failed. Check /supabase-config.", "error");
        return false;
    }

    if (currentUser) {
        return true;
    }

    showToast("Please create an account or log in first.", "warning");

    if (authSection) {
        authSection.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }

    return false;
}

async function getSupabaseAccessToken() {
    if (!supabaseClient) {
        return null;
    }

    const { data, error } = await supabaseClient.auth.getSession();

    if (error || !data.session) {
        return null;
    }

    return data.session.access_token;
}

async function refreshProfileStatus() {
    if (!isSupabaseConfigured() || !currentUser) {
        return;
    }

    try {
        const accessToken = await getSupabaseAccessToken();

        if (!accessToken) return;

        const response = await fetch("/profile-status", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not load profile status.");
        }

        if (data.isPro) {
            localStorage.setItem("oneToManyPro", "yes");
        } else {
            localStorage.removeItem("oneToManyPro");
        }

        updateTrialStatus();

    } catch (error) {
        console.error("Profile status refresh failed:", error);
    }
}

async function handleSignup() {
    if (!authInitialized) {
        showToast("Login is still loading. Try again in a second.", "warning");
        return;
    }

    if (!supabaseClient) {
        showToast("Supabase auth setup failed. Check /supabase-config.", "warning");
        return;
    }

    const { email, password } = getAuthCredentials();

    if (!validateAuthCredentials(email, password)) return;

    try {
        setAuthButtonsDisabled(true);

        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password
        });

        if (error) {
            throw error;
        }

        if (data.session && data.session.user) {
            currentUser = data.session.user;
            updateAuthUI();
            await displaySavedJobs();
            showToast("Account created. You are signed in.", "success");
        } else {
            currentUser = null;
            updateAuthUI();
            await displaySavedJobs();
            showToast("Account created. Check your email to confirm, then log in.", "success");
        }

    } catch (error) {
        console.error("Signup error:", error);
        showToast(error.message || "Could not create account.", "error");
    } finally {
        setAuthButtonsDisabled(false);
    }
}

async function handleLogin() {
    if (!authInitialized) {
        showToast("Login is still loading. Try again in a second.", "warning");
        return;
    }

    if (!supabaseClient) {
        showToast("Supabase auth setup failed. Check /supabase-config.", "warning");
        return;
    }

    const { email, password } = getAuthCredentials();

    if (!validateAuthCredentials(email, password)) return;

    try {
        setAuthButtonsDisabled(true);

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            throw error;
        }

        currentUser = data.user || null;

        updateAuthUI();
        await displaySavedJobs();

        showToast("Logged in successfully.", "success");

    } catch (error) {
        console.error("Login error:", error);
        showToast(error.message || "Could not log in.", "error");
    } finally {
        setAuthButtonsDisabled(false);
    }
}

async function handleLogout() {
    if (!supabaseClient) return;

    try {
        setAuthButtonsDisabled(true);

        const { error } = await supabaseClient.auth.signOut();

        if (error) {
            throw error;
        }

        currentUser = null;
        localStorage.removeItem("oneToManyPro");

        updateAuthUI();
        updateTrialStatus();
        await displaySavedJobs();

        showToast("Logged out.", "success");

    } catch (error) {
        console.error("Logout error:", error);
        showToast(error.message || "Could not log out.", "error");
    } finally {
        setAuthButtonsDisabled(false);
    }
}

async function initializeAuth() {
    authInitialized = false;

    const configured = await setupSupabaseClient();

    if (!configured) {
        updateAuthUI();
        await displaySavedJobs();
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.getSession();

        if (error) {
            throw error;
        }

        currentUser =
            data.session && data.session.user
                ? data.session.user
                : null;

        authInitialized = true;
        updateAuthUI();
        await displaySavedJobs();

        supabaseClient.auth.onAuthStateChange(async function (_event, session) {
            currentUser = session && session.user ? session.user : null;
            updateAuthUI();
            await displaySavedJobs();
        });

    } catch (error) {
        console.error("Auth initialization error:", error);
        showToast("Could not initialize login. Check Supabase settings.", "error");
        updateAuthUI();
        await displaySavedJobs();
    }
}

if (signupBtn) {
    signupBtn.addEventListener("click", handleSignup);
}

if (loginBtn) {
    loginBtn.addEventListener("click", handleLogin);
}

if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
}

/* ==========================
   TOAST NOTIFICATIONS
========================== */

function showToast(message, type = "success") {
    const toast = document.getElementById("toast");

    if (!toast) {
        alert(message);
        return;
    }

    toast.textContent = message;
    toast.className = "toast show " + type;

    setTimeout(function () {
        toast.className = "toast";
    }, 2600);
}

/* ==========================
   TRIAL / PRO SETTINGS
========================== */

const TRIAL_LENGTH_DAYS = 7;
const FREE_AI_PER_DAY = 1;

function isProActive() {
    return localStorage.getItem("oneToManyPro") === "yes";
}

function activateProAccess() {
    localStorage.setItem("oneToManyPro", "yes");
    updateTrialStatus();
}

function getTodayKey() {
    return new Date().toISOString().split("T")[0];
}

function getTrialData() {
    let trialData;

    try {
        trialData = JSON.parse(localStorage.getItem("oneToManyTrial"));
    } catch (error) {
        trialData = null;
    }

    if (
        !trialData ||
        !trialData.trialStartedAt ||
        !trialData.aiUsageByDate ||
        typeof trialData.aiUsageByDate !== "object"
    ) {
        trialData = {
            trialStartedAt: new Date().toISOString(),
            aiUsageByDate: {}
        };

        localStorage.setItem("oneToManyTrial", JSON.stringify(trialData));
    }

    return trialData;
}

function saveTrialData(trialData) {
    localStorage.setItem("oneToManyTrial", JSON.stringify(trialData));
}

function getTrialDaysUsed(trialData) {
    const start = new Date(trialData.trialStartedAt);
    const now = new Date();

    const diffTime = now.getTime() - start.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    return diffDays + 1;
}

function isTrialExpired(trialData) {
    return getTrialDaysUsed(trialData) > TRIAL_LENGTH_DAYS;
}

function isTrialActive() {
    const trialData = getTrialData();
    return !isTrialExpired(trialData);
}

function requireActiveTrial() {
    if (!requireSignedIn()) {
        return false;
    }

    if (isProActive()) {
        return true;
    }

    if (!isTrialActive()) {
        showToast("Your free trial has ended. Upgrade to Pro for $20/month to continue using OneToMany Contractors.", "warning");
        return false;
    }

    return true;
}

function getTodayAIUsage(trialData) {
    const today = getTodayKey();

    if (!trialData.aiUsageByDate) {
        trialData.aiUsageByDate = {};
    }

    return trialData.aiUsageByDate[today] || 0;
}

function canUseFreeAI() {
    if (isProActive()) {
        return {
            allowed: true,
            reason: "pro"
        };
    }

    const trialData = getTrialData();

    if (isTrialExpired(trialData)) {
        return {
            allowed: false,
            reason: "expired"
        };
    }

    const todayUsage = getTodayAIUsage(trialData);

    if (todayUsage >= FREE_AI_PER_DAY) {
        return {
            allowed: false,
            reason: "daily-limit"
        };
    }

    return {
        allowed: true,
        reason: "allowed"
    };
}

function recordAIUsage() {
    const trialData = getTrialData();
    const today = getTodayKey();

    trialData.aiUsageByDate[today] = (trialData.aiUsageByDate[today] || 0) + 1;

    saveTrialData(trialData);
    updateTrialStatus();
}

function updateTrialStatus() {
    const trialStatus = document.getElementById("trialStatus");

    if (!trialStatus) return;

    if (isProActive()) {
        trialStatus.textContent = "Pro active • Unlimited access unlocked.";
        trialStatus.classList.remove("trial-ended");
        return;
    }

    const trialData = getTrialData();
    const daysUsed = getTrialDaysUsed(trialData);
    const daysLeft = Math.max(TRIAL_LENGTH_DAYS - daysUsed + 1, 0);
    const todayUsage = getTodayAIUsage(trialData);

    if (isTrialExpired(trialData)) {
        trialStatus.textContent = "Free trial ended. Upgrade to Pro for $20/month to keep using OneToMany Contractors.";
        trialStatus.classList.add("trial-ended");
        return;
    }

    trialStatus.classList.remove("trial-ended");

    trialStatus.textContent =
        `Free trial: ${daysLeft} day(s) left • Full access active • AI used today: ${todayUsage}/${FREE_AI_PER_DAY}`;
}

/* ==========================
   LIABILITY MODAL
========================== */

function setupLiabilityModal() {
    const liabilityModal = document.getElementById("liabilityModal");
    const acceptLiabilityBtn = document.getElementById("acceptLiabilityBtn");

    if (!liabilityModal || !acceptLiabilityBtn) return;

    const hasAcceptedLiability = localStorage.getItem("oneToManyLiabilityAccepted");

    if (hasAcceptedLiability === "yes") {
        liabilityModal.classList.add("hidden");
    } else {
        liabilityModal.classList.remove("hidden");
    }

    acceptLiabilityBtn.addEventListener("click", function () {
        localStorage.setItem("oneToManyLiabilityAccepted", "yes");
        liabilityModal.classList.add("hidden");
        showToast("Thanks. You can now use OneToMany Contractors.", "success");
    });
}

/* ==========================
   PRICE FORMATTER
========================== */

if (estimatedPriceInput) {
    estimatedPriceInput.addEventListener("input", function () {
        const numbersOnly = estimatedPriceInput.value.replace(/[^0-9]/g, "");

        if (numbersOnly === "") {
            estimatedPriceInput.value = "";
            return;
        }

        estimatedPriceInput.value = "$" + Number(numbersOnly).toLocaleString();
    });
}

function getCleanPrice() {
    const numbersOnly = estimatedPriceInput.value.replace(/[^0-9]/g, "");

    if (numbersOnly === "" || Number(numbersOnly) <= 0) {
        return null;
    }

    return "$" + Number(numbersOnly).toLocaleString();
}

/* ==========================
   FORM DATA
========================== */

function getFormData() {
    return {
        businessName: document.getElementById("businessName")
            ? document.getElementById("businessName").value.trim()
            : "",

        customerName: document.getElementById("customerName").value.trim(),
        customerEmail: document.getElementById("customerEmail").value.trim(),
        customerPhone: document.getElementById("customerPhone").value.trim(),
        projectType: document.getElementById("projectType").value,
        estimatedPrice: getCleanPrice(),
        timeline: document.getElementById("timeline").value.trim(),
        projectNotes: document.getElementById("projectNotes").value.trim(),

        jobStatus: document.getElementById("jobStatus")
            ? document.getElementById("jobStatus").value
            : "Lead",

        followUpDate: document.getElementById("followUpDate")
            ? document.getElementById("followUpDate").value
            : ""
    };
}

function validateJob(job) {
    if (job.customerName === "") {
        showToast("Please enter the customer's name.", "warning");
        return false;
    }

    if (job.estimatedPrice === null) {
        showToast("Please enter a valid estimated price.", "warning");
        return false;
    }

    if (job.timeline === "") {
        showToast("Please enter an estimated timeline.", "warning");
        return false;
    }

    if (job.projectNotes === "") {
        showToast("Please enter project notes.", "warning");
        return false;
    }

    return true;
}

/* ==========================
   DOCUMENT GENERATION
========================== */

function generateDocuments(job) {
    const businessName = job.businessName || "Your Company Name";

    document.getElementById("quoteOutput").value =
`QUOTE

Business: ${businessName}

Customer Information:
Customer: ${job.customerName}
Email: ${job.customerEmail || "Not provided"}
Phone: ${job.customerPhone || "Not provided"}

Project Information:
Project Type: ${job.projectType}
Estimated Cost: ${job.estimatedPrice}
Estimated Timeline: ${job.timeline}

Scope Of Work:
${job.projectNotes}

Quote Terms:
This quote is based on the project details provided above. Final pricing may change if the project scope, materials, labor requirements, or site conditions change. Any additional work should be approved before work continues.

Next Step:
Please review this quote and let us know if you would like to move forward.`;

    document.getElementById("invoiceOutput").value =
`INVOICE

Business: ${businessName}

Bill To:
Customer: ${job.customerName}
Email: ${job.customerEmail || "Not provided"}
Phone: ${job.customerPhone || "Not provided"}

Service Details:
Service: ${job.projectType}
Amount Due: ${job.estimatedPrice}
Timeline: ${job.timeline}

Description:
${job.projectNotes}

Payment Terms:
Payment is due according to the agreed project terms. Please contact us with any questions about this invoice.`;

    document.getElementById("agreementOutput").value =
`SERVICE AGREEMENT DRAFT

Business: ${businessName}

Customer:
${job.customerName}
${job.customerEmail || "Not provided"}
${job.customerPhone || "Not provided"}

Project:
${job.projectType}

Estimated Price:
${job.estimatedPrice}

Estimated Timeline:
${job.timeline}

Scope Of Work:
${job.projectNotes}

Payment Terms:
Customer agrees to pay the estimated amount of ${job.estimatedPrice} for the services described above, unless both parties agree to a different amount in writing.

Changes To Work:
Any additional work, changes, materials, delays, or extra costs should be approved by both parties before work continues.

Customer Responsibilities:
Customer agrees to provide reasonable access to the work area and communicate any known issues that may affect the project.

Contractor Responsibilities:
Contractor agrees to perform the described work in a professional manner based on the agreed scope.

Signatures:

Customer Signature: ___________________________
Date: ___________________

Contractor Signature: _________________________
Date: ___________________`;

    document.getElementById("emailOutput").value =
`Hello ${job.customerName},

Thank you for considering ${businessName} for your ${job.projectType} project.

Based on the information provided, we prepared an estimate of ${job.estimatedPrice}.

Estimated timeline: ${job.timeline}

Project notes:
${job.projectNotes}

Please review the attached/linked documents and let us know if you have any questions or would like to move forward.

Best regards,
${businessName}`;

    document.getElementById("smsOutput").value =
`Hi ${job.customerName}, this is ${businessName}. We prepared your ${job.projectType} estimate for ${job.estimatedPrice}. Let us know if you have any questions or would like to move forward.`;
}

if (generateButton) {
    generateButton.addEventListener("click", function () {
        if (!requireActiveTrial()) return;

        const job = getFormData();

        if (!validateJob(job)) return;

        generateDocuments(job);
        showToast("✅ Documents generated.", "success");
    });
}

/* ==========================
   CLEAR FORM
========================== */

if (clearFormBtn) {
    clearFormBtn.addEventListener("click", function () {
        if (!requireActiveTrial()) return;

        const confirmClear = confirm("Clear all form fields and generated documents?");

        if (!confirmClear) return;

        if (document.getElementById("businessName")) {
            document.getElementById("businessName").value = "";
        }

        if (document.getElementById("jobStatus")) {
            document.getElementById("jobStatus").value = "Lead";
        }

        if (document.getElementById("followUpDate")) {
            document.getElementById("followUpDate").value = "";
        }

        document.getElementById("customerName").value = "";
        document.getElementById("customerEmail").value = "";
        document.getElementById("customerPhone").value = "";
        document.getElementById("projectType").selectedIndex = 0;
        document.getElementById("estimatedPrice").value = "";
        document.getElementById("timeline").value = "";
        document.getElementById("projectNotes").value = "";

        document.getElementById("quoteOutput").value = "";
        document.getElementById("invoiceOutput").value = "";
        document.getElementById("agreementOutput").value = "";
        document.getElementById("emailOutput").value = "";
        document.getElementById("smsOutput").value = "";

        showToast("🧹 Form cleared!", "success");
    });
}

/* ==========================
   SUPABASE SAVED JOBS
========================== */

function mapDatabaseRowToJob(row) {
    return {
        id: row.id,
        businessName: row.business_name || "",
        customerName: row.customer_name || "",
        customerEmail: row.customer_email || "",
        customerPhone: row.customer_phone || "",
        projectType: row.project_type || "Deck Repair",
        estimatedPrice: row.estimated_price || "",
        timeline: row.timeline || "",
        projectNotes: row.project_notes || "",
        jobStatus: row.job_status || "Lead",
        followUpDate: row.follow_up_date || "",
        savedAt: row.saved_at
            ? new Date(row.saved_at).toLocaleString()
            : "Unknown"
    };
}

async function fetchSavedJobsApi(path, options = {}) {
    const accessToken = await getSupabaseAccessToken();

    if (!accessToken) {
        throw new Error("Please log in first.");
    }

    const headers = Object.assign({}, options.headers || {}, {
        Authorization: `Bearer ${accessToken}`
    });

    const method = options.method || "GET";
    const requestUrl = getApiUrl(path);
    const isSaveJobRequest = method === "POST" && path === "/api/jobs";
    let response;

    if (isSaveJobRequest) {
        console.log("Save Job URL:", "/api/jobs");
        console.log("Save Job origin:", window.location.origin);
    }

    try {
        response = await fetch(requestUrl, Object.assign({}, options, {
            headers
        }));
    } catch (error) {
        if (isSaveJobRequest) {
            console.error("Save Job network error:", error);
        }

        console.error("Saved jobs network error:", {
            url: requestUrl,
            error
        });
        throw new Error("Could not reach the saved jobs API. Make sure the server is running on localhost:3000.");
    }

    if (isSaveJobRequest) {
        console.log("Save Job response status:", response.status);
    }

    let data = {};

    try {
        data = await response.json();
    } catch (error) {
        data = {};
    }

    if (!response.ok) {
        if (isSaveJobRequest) {
            console.error("Save Job response error:", data);
        }

        console.error("Saved jobs API error:", {
            url: requestUrl,
            status: response.status,
            data
        });

        const messageParts = [data.error || "Saved jobs request failed."];

        if (data.details) {
            messageParts.push(data.details);
        }

        if (data.hint) {
            messageParts.push("Hint: " + data.hint);
        }

        if (data.code) {
            messageParts.push("Code: " + data.code);
        }

        throw new Error(messageParts.join(" "));
    }

    return data;
}

async function getSavedJobsFromSupabase() {
    if (!currentUser) {
        return [];
    }

    try {
        const data = await fetchSavedJobsApi("/api/jobs");
        return data.jobs || [];

    } catch (error) {
        console.error("Load saved jobs error:", error);
        showToast(error.message || "Could not load saved jobs.", "error");
        return [];
    }
}

if (saveJobButton) {
    saveJobButton.addEventListener("click", async function () {
        if (!requireActiveTrial()) return;

        const job = getFormData();

        if (!validateJob(job)) return;

        try {
            await fetchSavedJobsApi("/api/jobs", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(job)
            });

        } catch (error) {
            console.error("Save job error:", error);
            showToast(error.message || "Could not save job.", "error");
            return;
        }

        await displaySavedJobs();

        showToast("✅ Job saved successfully!", "success");
    });
}

async function displaySavedJobs() {
    if (!savedJobsList) return;

    if (!isSupabaseConfigured() || !currentUser) {
        savedJobsList.innerHTML = '<p class="empty-state">Log in to view saved jobs.</p>';
        return;
    }

    const rows = await getSavedJobsFromSupabase();

    if (rows.length === 0) {
        savedJobsList.innerHTML = '<p class="empty-state">No saved jobs yet</p>';
        return;
    }

    savedJobsList.innerHTML = "";

    rows.forEach(function (row) {
        const job = mapDatabaseRowToJob(row);

        const jobDiv = document.createElement("div");

        jobDiv.classList.add("job-item");

        const status = job.jobStatus || "Lead";
        const followUp = job.followUpDate ? job.followUpDate : "Not set";

        jobDiv.innerHTML = `
            <div class="job-item-header">${job.customerName}</div>

            <div class="job-item-details">
                <div><strong>Business:</strong> ${job.businessName || "Not set"}</div>
                <div><strong>Project:</strong> ${job.projectType}</div>
                <div><strong>Price:</strong> ${job.estimatedPrice}</div>
                <div><strong>Timeline:</strong> ${job.timeline}</div>
                <div><strong>Status:</strong> ${status}</div>
                <div><strong>Follow-Up:</strong> ${followUp}</div>
                <small>Saved: ${job.savedAt}</small>
            </div>

            <div class="job-item-actions">
                <button class="load-job-btn" data-id="${job.id}">
                    <i class="fas fa-folder-open"></i>
                    Load
                </button>

                <button class="delete-job-btn" data-id="${job.id}">
                    <i class="fas fa-trash"></i>
                    Delete
                </button>
            </div>
        `;

        savedJobsList.appendChild(jobDiv);
    });
}

if (savedJobsList) {
    savedJobsList.addEventListener("click", async function (event) {
        if (!requireActiveTrial()) return;

        const loadBtn = event.target.closest(".load-job-btn");
        const deleteBtn = event.target.closest(".delete-job-btn");

        if (loadBtn) {
            const jobId = loadBtn.dataset.id;

            let data;

            try {
                data = await fetchSavedJobsApi("/api/jobs/" + encodeURIComponent(jobId));

                if (!data.job) {
                    throw new Error("Saved job was not returned.");
                }

            } catch (error) {
                console.error("Load job error:", error);
                showToast(error.message || "Could not load this job.", "error");
                return;
            }

            const job = mapDatabaseRowToJob(data.job);

            if (document.getElementById("businessName")) {
                document.getElementById("businessName").value = job.businessName || "";
            }

            if (document.getElementById("jobStatus")) {
                document.getElementById("jobStatus").value = job.jobStatus || "Lead";
            }

            if (document.getElementById("followUpDate")) {
                document.getElementById("followUpDate").value = job.followUpDate || "";
            }

            document.getElementById("customerName").value = job.customerName || "";
            document.getElementById("customerEmail").value = job.customerEmail || "";
            document.getElementById("customerPhone").value = job.customerPhone || "";
            document.getElementById("projectType").value = job.projectType || "Deck Repair";
            document.getElementById("estimatedPrice").value = job.estimatedPrice || "";
            document.getElementById("timeline").value = job.timeline || "";
            document.getElementById("projectNotes").value = job.projectNotes || "";

            generateDocuments(job);

            showToast("📂 Saved job loaded.", "success");
        }

        if (deleteBtn) {
            const jobId = deleteBtn.dataset.id;

            try {
                await fetchSavedJobsApi("/api/jobs/" + encodeURIComponent(jobId), {
                    method: "DELETE"
                });

            } catch (error) {
                console.error("Delete job error:", error);
                showToast(error.message || "Could not delete job.", "error");
                return;
            }

            await displaySavedJobs();

            showToast("🗑️ Saved job deleted.", "success");
        }
    });
}

if (clearJobsBtn) {
    clearJobsBtn.addEventListener("click", async function () {
        if (!requireActiveTrial()) return;

        const confirmClear = confirm("Are you sure you want to clear all saved jobs?");

        if (!confirmClear) return;

        try {
            await fetchSavedJobsApi("/api/jobs", {
                method: "DELETE"
            });

        } catch (error) {
            console.error("Clear jobs error:", error);
            showToast(error.message || "Could not clear saved jobs.", "error");
            return;
        }

        await displaySavedJobs();

        showToast("🗑️ All saved jobs cleared.", "success");
    });
}

/* ==========================
   COPY BUTTONS
========================== */

const copyButtons = document.querySelectorAll(".copy-btn");

copyButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        if (!requireActiveTrial()) return;

        const outputCard = button.closest(".output-card");
        const textArea = outputCard.querySelector("textarea");

        if (textArea.value.trim() === "") {
            showToast("Generate documents first.", "warning");
            return;
        }

        navigator.clipboard.writeText(textArea.value);

        const originalHTML = button.innerHTML;
        button.innerHTML = '<i class="fas fa-check"></i> Copied!';

        showToast("📋 Text copied.", "success");

        setTimeout(function () {
            button.innerHTML = originalHTML;
        }, 2000);
    });
});

/* ==========================
   CLEAN PDF EXPORT
========================== */

function cleanPdfText(text) {
    return String(text || "")
        .replace(/[^\x00-\x7F]/g, "")
        .replace(/\r/g, "")
        .trim();
}

function addPdfFooter(doc, pageNumber) {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(18, 278, 192, 278);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);

    doc.text("Generated by OneToMany Contractors", 18, 286);
    doc.text(`Page ${pageNumber}`, 192, 286, { align: "right" });
}

function addNewPageIfNeeded(doc, currentY, neededSpace, pageNumberObj) {
    if (currentY + neededSpace > 270) {
        addPdfFooter(doc, pageNumberObj.value);
        doc.addPage();
        pageNumberObj.value += 1;
        return 24;
    }

    return currentY;
}

function drawPdfHeader(doc, businessName, documentTitle) {
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 36, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(businessName, 18, 16);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text("Generated: " + new Date().toLocaleDateString(), 18, 25);

    doc.setFillColor(34, 197, 94);
    doc.roundedRect(145, 10, 47, 14, 3, 3, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(documentTitle.toUpperCase(), 168.5, 19, { align: "center" });
}

function drawInfoBox(doc, title, rows, x, y, width) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, width, 12 + rows.length * 8, 3, 3, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(title, x + 5, y + 8);

    let rowY = y + 17;

    rows.forEach(function (row) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(71, 85, 105);
        doc.text(row.label + ":", x + 5, rowY);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(15, 23, 42);
        doc.text(String(row.value || "Not provided"), x + 35, rowY);

        rowY += 8;
    });

    return y + 16 + rows.length * 8;
}

function drawSectionTitle(doc, title, y) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(22, 101, 52);
    doc.text(title.toUpperCase(), 18, y);

    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(0.4);
    doc.line(18, y + 3, 192, y + 3);

    return y + 11;
}

function drawParagraph(doc, text, y, pageNumberObj) {
    const cleaned = cleanPdfText(text);
    const lines = doc.splitTextToSize(cleaned, 174);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);

    lines.forEach(function (line) {
        y = addNewPageIfNeeded(doc, y, 8, pageNumberObj);
        doc.text(line, 18, y);
        y += 6.5;
    });

    return y + 4;
}

function parseSections(content) {
    const lines = cleanPdfText(content)
        .split("\n")
        .map(function (line) {
            return line.trim();
        })
        .filter(function (line) {
            return line.length > 0;
        });

    const sections = [];
    let currentSection = {
        title: "Details",
        body: []
    };

    const sectionNames = [
        "CUSTOMER INFORMATION",
        "PROJECT INFORMATION",
        "SCOPE OF WORK",
        "QUOTE TERMS",
        "NEXT STEP",
        "BILL TO",
        "SERVICE DETAILS",
        "DESCRIPTION",
        "PAYMENT TERMS",
        "CUSTOMER",
        "PROJECT",
        "ESTIMATED PRICE",
        "ESTIMATED TIMELINE",
        "CHANGES TO WORK",
        "CUSTOMER RESPONSIBILITIES",
        "CONTRACTOR RESPONSIBILITIES",
        "SIGNATURES"
    ];

    lines.forEach(function (line) {
        const upper = line.replace(/:$/g, "").toUpperCase();

        if (
            upper === "QUOTE" ||
            upper === "INVOICE" ||
            upper === "SERVICE AGREEMENT DRAFT" ||
            upper === "SERVICE AGREEMENT"
        ) {
            return;
        }

        if (sectionNames.includes(upper)) {
            if (currentSection.body.length > 0) {
                sections.push(currentSection);
            }

            currentSection = {
                title: upper,
                body: []
            };
        } else {
            currentSection.body.push(line);
        }
    });

    if (currentSection.body.length > 0) {
        sections.push(currentSection);
    }

    return sections;
}

function getDocumentTitle(rawTitle) {
    const lower = rawTitle.toLowerCase();

    if (lower.includes("quote")) return "Quote";
    if (lower.includes("invoice")) return "Invoice";
    if (lower.includes("agreement")) return "Agreement";
    if (lower.includes("email")) return "Email";
    if (lower.includes("sms")) return "SMS";

    return rawTitle;
}

const exportButtons = document.querySelectorAll(".export-btn");

exportButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        if (!requireActiveTrial()) return;

        const outputCard = button.closest(".output-card");
        const textArea = outputCard.querySelector("textarea");

        if (textArea.value.trim() === "") {
            showToast("Generate documents first.", "warning");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const rawTitle = outputCard
            .querySelector("h3")
            .textContent
            .replace(/[^\x00-\x7F]/g, "")
            .trim();

        const documentTitle = getDocumentTitle(rawTitle);

        const businessNameInput = document.getElementById("businessName")
            ? document.getElementById("businessName").value.trim()
            : "";

        const businessName = businessNameInput || "Your Company Name";
        const job = getFormData();
        const pageNumberObj = { value: 1 };

        drawPdfHeader(doc, businessName, documentTitle);

        let y = 48;

        drawInfoBox(
            doc,
            "Customer",
            [
                { label: "Name", value: job.customerName },
                { label: "Email", value: job.customerEmail || "Not provided" },
                { label: "Phone", value: job.customerPhone || "Not provided" }
            ],
            18,
            y,
            82
        );

        drawInfoBox(
            doc,
            "Project",
            [
                { label: "Type", value: job.projectType },
                { label: "Price", value: job.estimatedPrice },
                { label: "Timeline", value: job.timeline }
            ],
            110,
            y,
            82
        );

        y += 48;

        const isAgreementPDF = documentTitle.toLowerCase().includes("agreement");

        if (isAgreementPDF) {
            y = addNewPageIfNeeded(doc, y, 28, pageNumberObj);

            doc.setFillColor(254, 242, 242);
            doc.setDrawColor(252, 165, 165);
            doc.roundedRect(18, y, 174, 25, 3, 3, "FD");

            doc.setFont("helvetica", "bold");
            doc.setFontSize(9.5);
            doc.setTextColor(153, 27, 27);
            doc.text("IMPORTANT: SERVICE AGREEMENT DRAFT ONLY", 23, y + 8);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            const warningLines = doc.splitTextToSize(
                "This document is not legal advice. Review this draft carefully and consider having a qualified professional review it before use.",
                164
            );

            doc.text(warningLines, 23, y + 15);
            y += 35;
        }

        const sections = parseSections(textArea.value);

        sections.forEach(function (section) {
            y = addNewPageIfNeeded(doc, y, 20, pageNumberObj);
            y = drawSectionTitle(doc, section.title, y);

            const bodyText = section.body.join("\n");
            y = drawParagraph(doc, bodyText, y, pageNumberObj);
        });

        y = addNewPageIfNeeded(doc, y, 24, pageNumberObj);

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(18, y, 174, 18, 3, 3, "FD");

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);

        const disclaimerLines = doc.splitTextToSize(
            "Draft generated for convenience only. User is responsible for reviewing all content before sending, signing, or using it.",
            164
        );

        doc.text(disclaimerLines, 23, y + 7);

        addPdfFooter(doc, pageNumberObj.value);

        const safeBusinessName = businessName.replace(/[^a-z0-9]/gi, "_");
        const safeTitle = documentTitle.replace(/[^a-z0-9]/gi, "_");
        const fileName = `${safeBusinessName}_${safeTitle}.pdf`;

        doc.save(fileName);

        showToast("📄 PDF exported.", "success");
    });
});

/* ==========================
   EMAIL BUTTON
========================== */

const emailOutput = document.getElementById("emailOutput");

if (emailOutput) {
    const emailButton = emailOutput
        .closest(".output-card")
        .querySelector(".send-btn");

    if (emailButton) {
        emailButton.addEventListener("click", function () {
            if (!requireActiveTrial()) return;

            const emailText = emailOutput.value;
            const customerEmail = document.getElementById("customerEmail").value.trim();

            if (emailText.trim() === "") {
                showToast("Generate the email first.", "warning");
                return;
            }

            const gmailUrl =
                "https://mail.google.com/mail/?view=cm&fs=1" +
                "&to=" + encodeURIComponent(customerEmail) +
                "&su=" + encodeURIComponent("Project Estimate") +
                "&body=" + encodeURIComponent(emailText);

            window.open(gmailUrl, "_blank");
            showToast("📨 Gmail opened.", "success");
        });
    }
}

/* ==========================
   AI IMPROVE
========================== */

const aiImproveBtn = document.getElementById("aiImproveBtn");

if (aiImproveBtn) {
    aiImproveBtn.addEventListener("click", async function () {
        try {
            if (!requireSignedIn()) return;

            const trialCheck = canUseFreeAI();

            if (!trialCheck.allowed) {
                if (trialCheck.reason === "expired") {
                    showToast("Your free trial has ended. Upgrade to Pro for $20/month to continue using OneToMany Contractors.", "warning");
                }

                if (trialCheck.reason === "daily-limit") {
                    showToast("Free trial AI limit reached. You get 1 AI generation per day. Upgrade to Pro for full access.", "warning");
                }

                return;
            }

            aiImproveBtn.disabled = true;
            aiImproveBtn.textContent = "⏳ Generating...";

            const job = getFormData();

            if (!validateJob(job)) {
                return;
            }

            const response = await fetch("/generate-ai", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(job)
            });

            let data;

            try {
                data = await response.json();
            } catch (jsonError) {
                throw new Error("Server did not return JSON.");
            }

            if (!response.ok) {
                throw new Error(data.error || "AI generation failed.");
            }

            const aiText = data.result
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim();

            const aiData = JSON.parse(aiText);

            document.getElementById("quoteOutput").value =
                typeof aiData.quote === "string"
                    ? aiData.quote
                    : JSON.stringify(aiData.quote, null, 2);

            document.getElementById("invoiceOutput").value =
                typeof aiData.invoice === "string"
                    ? aiData.invoice
                    : JSON.stringify(aiData.invoice, null, 2);

            document.getElementById("agreementOutput").value =
                typeof aiData.agreement === "string"
                    ? aiData.agreement
                    : JSON.stringify(aiData.agreement, null, 2);

            document.getElementById("emailOutput").value =
                aiData.email?.body || aiData.email || "";

            document.getElementById("smsOutput").value =
                aiData.sms?.message || aiData.sms || "";

            if (!isProActive()) {
                recordAIUsage();
            }

            showToast("🤖 AI documents generated!", "success");

        } catch (error) {
            console.error("AI generation failed:", error);
            showToast("❌ AI generation failed. Please try again.", "error");
        } finally {
            aiImproveBtn.disabled = false;
            aiImproveBtn.textContent = "✨ Improve With AI";
        }
    });
}

/* ==========================
   UPGRADE TO PRO
========================== */

const upgradeProBtn = document.getElementById("upgradeProBtn");

if (upgradeProBtn) {
    upgradeProBtn.addEventListener("click", async function () {
        try {
            if (!requireSignedIn()) return;

            upgradeProBtn.disabled = true;
            upgradeProBtn.textContent = "Opening Checkout...";

            const accessToken = await getSupabaseAccessToken();

            if (!accessToken) {
                showToast("Please log in again before upgrading.", "warning");
                return;
            }

            const response = await fetch("/create-checkout-session", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${accessToken}`
                }
            });

            const data = await response.json();

            if (!response.ok || !data.url) {
                throw new Error(data.error || "Could not start checkout.");
            }

            window.location.href = data.url;

        } catch (error) {
            console.error("Checkout error:", error);
            showToast("Could not open Stripe checkout. Please try again.", "error");
        } finally {
            upgradeProBtn.disabled = false;
            upgradeProBtn.innerHTML = '<i class="fas fa-crown"></i> Upgrade to Pro';
        }
    });
}

/* ==========================
   VERIFY STRIPE SUCCESS
========================== */

async function checkStripeSuccess() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const checkoutStatus = params.get("checkout");

    if (checkoutStatus === "cancelled") {
        showToast("Checkout cancelled.", "warning");
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }

    if (!sessionId) return;

    try {
        showToast("Verifying payment...", "success");

        const response = await fetch(`/verify-checkout-session?session_id=${encodeURIComponent(sessionId)}`);
        const data = await response.json();

        if (data.paid) {
            activateProAccess();
            await refreshProfileStatus();
            showToast("Pro unlocked. Thank you for subscribing!", "success");
        } else {
            showToast("Payment could not be verified yet. Contact support if you were charged.", "warning");
        }

    } catch (error) {
        console.error("Payment verification error:", error);
        showToast("Could not verify payment. Contact support if you were charged.", "error");
    } finally {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

/* ==========================
   INITIALIZE APP
========================== */

async function startApp() {
    setupLiabilityModal();
    await initializeAuth();
    await checkStripeSuccess();
    updateTrialStatus();
}

startApp();
