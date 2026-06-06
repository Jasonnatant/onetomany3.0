const generateButton = document.getElementById("generateAllBtn");
const saveJobButton = document.getElementById("saveJobBtn");
const clearFormBtn = document.getElementById("clearFormBtn");
const estimatedPriceInput = document.getElementById("estimatedPrice");
const savedJobsList = document.getElementById("savedJobsList");
const clearJobsBtn = document.getElementById("clearJobsBtn");

/* ==========================
   PRICE FORMATTER
========================== */

estimatedPriceInput.addEventListener("input", function () {
    const numbersOnly = estimatedPriceInput.value.replace(/[^0-9]/g, "");

    if (numbersOnly === "") {
        estimatedPriceInput.value = "";
        return;
    }

    estimatedPriceInput.value = "$" + Number(numbersOnly).toLocaleString();
});

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
        alert("Please enter the customer's name.");
        return false;
    }

    if (job.estimatedPrice === null) {
        alert("Please enter a valid estimated price.");
        return false;
    }

    if (job.timeline === "") {
        alert("Please enter an estimated timeline.");
        return false;
    }

    if (job.projectNotes === "") {
        alert("Please enter project notes.");
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
Email: ${job.customerEmail}
Phone: ${job.customerPhone}

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
Email: ${job.customerEmail}
Phone: ${job.customerPhone}

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
${job.customerEmail}
${job.customerPhone}

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

generateButton.addEventListener("click", function () {
    const job = getFormData();

    if (!validateJob(job)) return;

    generateDocuments(job);
});

/* ==========================
   SAVE JOB
========================== */

saveJobButton.addEventListener("click", function () {
    const job = getFormData();

    if (!validateJob(job)) return;

    job.savedAt = new Date().toLocaleString();

    const savedJobs = JSON.parse(localStorage.getItem("savedJobs")) || [];

    savedJobs.push(job);

    localStorage.setItem("savedJobs", JSON.stringify(savedJobs));

    displaySavedJobs();

    alert("✅ Job saved successfully!");
});

/* ==========================
   CLEAR FORM
========================== */

clearFormBtn.addEventListener("click", function () {
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

    alert("🧹 Form cleared!");
});

/* ==========================
   SAVED JOBS DISPLAY
========================== */

function displaySavedJobs() {
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

savedJobsList.addEventListener("click", function (event) {
    const savedJobs = JSON.parse(localStorage.getItem("savedJobs")) || [];

    const loadBtn = event.target.closest(".load-job-btn");
    const deleteBtn = event.target.closest(".delete-job-btn");

    if (loadBtn) {
        const index = loadBtn.dataset.index;
        const job = savedJobs[index];

        if (!job) {
            alert("Could not load this job.");
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
    }

    if (deleteBtn) {
        const index = deleteBtn.dataset.index;

        savedJobs.splice(index, 1);

        localStorage.setItem("savedJobs", JSON.stringify(savedJobs));

        displaySavedJobs();
    }
});

clearJobsBtn.addEventListener("click", function () {
    const confirmClear = confirm("Are you sure you want to clear all saved jobs?");

    if (!confirmClear) return;

    localStorage.removeItem("savedJobs");

    displaySavedJobs();

    alert("🗑️ All saved jobs cleared.");
});

/* ==========================
   COPY BUTTONS
========================== */

const copyButtons = document.querySelectorAll(".copy-btn");

copyButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        const outputCard = button.closest(".output-card");
        const textArea = outputCard.querySelector("textarea");

        if (textArea.value.trim() === "") {
            alert("Generate documents first.");
            return;
        }

        navigator.clipboard.writeText(textArea.value);

        const originalHTML = button.innerHTML;
        button.innerHTML = '<i class="fas fa-check"></i> Copied!';

        setTimeout(function () {
            button.innerHTML = originalHTML;
        }, 2000);
    });
});

/* ==========================
   PDF EXPORT
========================== */

const exportButtons = document.querySelectorAll(".export-btn");

exportButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        const outputCard = button.closest(".output-card");
        const textArea = outputCard.querySelector("textarea");

        if (textArea.value.trim() === "") {
            alert("Generate documents first.");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const title = outputCard
            .querySelector("h3")
            .textContent
            .replace(/[^\x00-\x7F]/g, "")
            .trim();

        const businessNameInput = document.getElementById("businessName")
            ? document.getElementById("businessName").value.trim()
            : "";

        const pdfBusinessName = businessNameInput || "Your Company Name";

        let content = textArea.value
            .replace(/[{}"]/g, "")
            .replace(/_/g, " ")
            .replace(/,/g, "")
            .replace(/[^\x00-\x7F]/g, "");

        const isAgreementPDF = title.toLowerCase().includes("agreement");

        doc.setFillColor(0, 0, 0);
        doc.rect(0, 0, 210, 35, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.text(pdfBusinessName, 105, 18, { align: "center" });

        doc.setTextColor(100, 116, 139);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Generated: " + new Date().toLocaleDateString(), 20, 48);

        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.7);
        doc.line(20, 54, 190, 54);

        // Document Title
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.setTextColor(15, 23, 42);

        if (title.toLowerCase().includes("quote")) {
            doc.text("QUOTE:", 20, 68);
        } else if (title.toLowerCase().includes("invoice")) {
            doc.text("INVOICE:", 20, 68);
        } else if (title.toLowerCase().includes("agreement")) {
            doc.text("SERVICE AGREEMENT:", 20, 68);
        } else {
            doc.text(title.toUpperCase() + ":", 20, 68);
        }

        let y = 82;

        if (isAgreementPDF) {
            doc.setFillColor(254, 242, 242);
            doc.rect(20, y - 8, 170, 30, "F");

            doc.setTextColor(153, 27, 27);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("IMPORTANT: SERVICE AGREEMENT DRAFT ONLY", 25, y);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8.5);

            const disclaimerLines = doc.splitTextToSize(
                "This document is not legal advice, does not create an attorney-client relationship, and should be reviewed by the user and/or a qualified professional before use.",
                160
            );

            doc.text(disclaimerLines, 25, y + 8);

            y += 38;
        }

        const rawLines = content
            .split("\n")
            .map(function (line) {
                return line.trim();
            })
            .filter(function (line) {
                return line !== "";
            });

        rawLines.forEach(function (line) {
            if (y > 265) {
                doc.addPage();
                y = 25;
            }

            const lowerLine = line.toLowerCase();

            const isSectionTitle =
                lowerLine === "quote" ||
                lowerLine === "invoice" ||
                lowerLine === "service agreement" ||
                lowerLine === "service agreement draft" ||
                lowerLine === "scope of work" ||
                lowerLine === "payment terms" ||
                lowerLine === "changes to work" ||
                lowerLine === "signatures" ||
                lowerLine === "quote terms" ||
                lowerLine === "next step" ||
                lowerLine === "customer responsibilities" ||
                lowerLine === "contractor responsibilities" ||
                lowerLine === "terms" ||
                lowerLine === "notes";

            const isLabel =
                lowerLine.startsWith("business") ||
                lowerLine.startsWith("customer") ||
                lowerLine.startsWith("email") ||
                lowerLine.startsWith("phone") ||
                lowerLine.startsWith("project") ||
                lowerLine.startsWith("estimated") ||
                lowerLine.startsWith("amount") ||
                lowerLine.startsWith("timeline") ||
                lowerLine.startsWith("service");

            if (isSectionTitle) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(14);
                doc.setTextColor(15, 23, 42);

                // Skip duplicate section title if it matches the main document title
                if (
                    (lowerLine === "quote" && title.toLowerCase().includes("quote")) ||
                    (lowerLine === "invoice" && title.toLowerCase().includes("invoice")) ||
                    ((lowerLine === "service agreement" || lowerLine === "service agreement draft") && title.toLowerCase().includes("agreement"))
                ) {
                    return;
                }

                doc.text(line.toUpperCase() + ":", 20, y);
                y += 10;
                return;
            }

            if (isLabel) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(11);
                doc.setTextColor(17, 24, 39);
            } else {
                doc.setFont("helvetica", "normal");
                doc.setFontSize(10.5);
                doc.setTextColor(51, 65, 85);
            }

            const wrappedLines = doc.splitTextToSize(line, 165);

            wrappedLines.forEach(function (wrappedLine) {
                if (y > 265) {
                    doc.addPage();
                    y = 25;
                }

                doc.text(wrappedLine, 20, y);
                y += 7;
            });

            y += 3;
        });

        doc.setDrawColor(226, 232, 240);
        doc.line(20, 276, 190, 276);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text("Generated by OneToMany Contractors", 20, 285);

        const fileName = title.replace(/[^a-z0-9]/gi, "_") + ".pdf";

        doc.save(fileName);
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
            const emailText = emailOutput.value;
            const customerEmail = document.getElementById("customerEmail").value.trim();

            if (emailText.trim() === "") {
                alert("Generate the email first.");
                return;
            }

            const gmailUrl =
                "https://mail.google.com/mail/?view=cm&fs=1" +
                "&to=" + encodeURIComponent(customerEmail) +
                "&su=" + encodeURIComponent("Project Estimate") +
                "&body=" + encodeURIComponent(emailText);

            window.open(gmailUrl, "_blank");
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

            alert("🤖 AI documents generated!");

        } catch (error) {
            console.error("AI generation failed:", error);
            alert("❌ AI generation failed. Check the console and terminal.");
        } finally {
            aiImproveBtn.disabled = false;
            aiImproveBtn.textContent = "✨ Improve With AI";
        }
    });
}

displaySavedJobs();