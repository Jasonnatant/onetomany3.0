const generateButton = document.getElementById("generateAllBtn");
const saveJobButton = document.getElementById("saveJobBtn");
const clearFormBtn = document.getElementById("clearFormBtn");
const estimatedPriceInput = document.getElementById("estimatedPrice");
const savedJobsList = document.getElementById("savedJobsList");
const clearJobsBtn = document.getElementById("clearJobsBtn");

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

const PRO_PAYMENT_LINK = "https://buy.stripe.com/dRm28q9se7HWcLLayU4ow00";

const TRIAL_LENGTH_DAYS = 7;
const FREE_AI_PER_DAY = 1;

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
   SAVE JOB
========================== */

if (saveJobButton) {
    saveJobButton.addEventListener("click", function () {
        if (!requireActiveTrial()) return;

        const job = getFormData();

        if (!validateJob(job)) return;

        job.savedAt = new Date().toLocaleString();

        const savedJobs = JSON.parse(localStorage.getItem("savedJobs")) || [];

        savedJobs.push(job);

        localStorage.setItem("savedJobs", JSON.stringify(savedJobs));

        displaySavedJobs();

        showToast("✅ Job saved successfully!", "success");
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
   SAVED JOBS DISPLAY
========================== */

function displaySavedJobs() {
    if (!savedJobsList) return;

    const savedJobs = JSON.parse(localStorage.getItem("savedJobs")) || [];

    if (savedJobs.length === 0) {
        savedJobsList.innerHTML = '<p class="empty-state">No saved jobs yet</p>';
        return;
    }

    savedJobsList.innerHTML = "";

    savedJobs.forEach(function (job, index) {
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
                <button class="load-job-btn" data-index="${index}">
                    <i class="fas fa-folder-open"></i>
                    Load
                </button>

                <button class="delete-job-btn" data-index="${index}">
                    <i class="fas fa-trash"></i>
                    Delete
                </button>
            </div>
        `;

        savedJobsList.appendChild(jobDiv);
    });
}

if (savedJobsList) {
    savedJobsList.addEventListener("click", function (event) {
        const savedJobs = JSON.parse(localStorage.getItem("savedJobs")) || [];

        const loadBtn = event.target.closest(".load-job-btn");
        const deleteBtn = event.target.closest(".delete-job-btn");

        if (loadBtn) {
            if (!requireActiveTrial()) return;

            const index = loadBtn.dataset.index;
            const job = savedJobs[index];

            if (!job) {
                showToast("Could not load this job.", "error");
                return;
            }

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
            if (!requireActiveTrial()) return;

            const index = deleteBtn.dataset.index;

            savedJobs.splice(index, 1);

            localStorage.setItem("savedJobs", JSON.stringify(savedJobs));

            displaySavedJobs();

            showToast("🗑️ Saved job deleted.", "success");
        }
    });
}

if (clearJobsBtn) {
    clearJobsBtn.addEventListener("click", function () {
        if (!requireActiveTrial()) return;

        const confirmClear = confirm("Are you sure you want to clear all saved jobs?");

        if (!confirmClear) return;

        localStorage.removeItem("savedJobs");

        displaySavedJobs();

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

            recordAIUsage();
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
    upgradeProBtn.addEventListener("click", function () {
        if (PRO_PAYMENT_LINK === "PASTE_YOUR_STRIPE_PAYMENT_LINK_HERE") {
            showToast("Stripe payment link has not been added yet.", "warning");
            return;
        }

        window.open(PRO_PAYMENT_LINK, "_blank");
    });
}

/* ==========================
   INITIALIZE APP
========================== */

setupLiabilityModal();
updateTrialStatus();
displaySavedJobs();