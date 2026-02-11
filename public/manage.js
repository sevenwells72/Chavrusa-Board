const manageStatus = document.getElementById("manageStatus");
const editStatus = document.getElementById("editStatus");
const conversationList = document.getElementById("conversationList");
const editForm = document.getElementById("editForm");
const renewBtn = document.getElementById("renewBtn");
const renewDuration = document.getElementById("renewDuration");
const deactivateBtn = document.getElementById("deactivateBtn");
const formatSelect = document.getElementById("formatSelect");
const locationFields = document.getElementById("locationFields");
const cityInput = document.getElementById("cityInput");
const stateInput = document.getElementById("stateInput");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tokenFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[1] || "";
}

function setLocationRequirement() {
  const needsLocation =
    formatSelect.value === "in_person_only" || formatSelect.value === "in_person_preferred";
  locationFields.classList.toggle("hidden", !needsLocation);
  cityInput.required = needsLocation;
  stateInput.required = needsLocation;
}

function dateLabel(value) {
  return new Date(value).toLocaleString();
}

function setFormValues(post) {
  const fields = [
    "category",
    "topic",
    "learningStyle",
    "familiarityLevel",
    "timeZone",
    "availability",
    "format",
    "city",
    "state",
    "email",
    "posterName"
  ];

  for (const field of fields) {
    if (editForm.elements[field]) {
      editForm.elements[field].value = post[field] || "";
    }
  }
  setLocationRequirement();
}

function renderConversations(conversations, token) {
  if (!conversations.length) {
    conversationList.innerHTML = '<p class="muted">No responses yet.</p>';
    return;
  }

  conversationList.innerHTML = conversations
    .map(
      (conversation) => `
      <article class="card stack">
        <p><strong>Received:</strong> ${dateLabel(conversation.createdAt)}</p>
        <p>${escapeHtml(conversation.message)}</p>
        ${
          conversation.timeZone
            ? `<p><strong>Responder time zone:</strong> ${escapeHtml(conversation.timeZone)}</p>`
            : ""
        }
        ${
          conversation.availability
            ? `<p><strong>Responder availability:</strong> ${escapeHtml(conversation.availability)}</p>`
            : ""
        }
        <p class="muted">Replies sent: ${conversation.replyCount}</p>
        <form data-conversation-id="${conversation.id}" class="replyForm stack">
          <label>
            Reply through relay
            <textarea name="message" required placeholder="Write a private reply."></textarea>
          </label>
          <button type="submit">Send Reply</button>
          <p class="status"></p>
        </form>
      </article>
    `
    )
    .join("");

  document.querySelectorAll(".replyForm").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const statusEl = form.querySelector(".status");
      statusEl.classList.remove("error");
      statusEl.textContent = "Sending...";

      const payload = {
        conversationId: form.getAttribute("data-conversation-id"),
        message: new FormData(form).get("message")
      };

      const response = await fetch(`/api/manage/${token}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        statusEl.classList.add("error");
        statusEl.textContent = data.error || "Could not send relay reply.";
        return;
      }

      form.reset();
      statusEl.textContent = "Reply sent.";
    });
  });
}

async function loadManageView(token) {
  const response = await fetch(`/api/manage/${token}`);
  const data = await response.json();
  if (!response.ok) {
    manageStatus.classList.add("error");
    manageStatus.textContent = data.error || "Could not load this manage link.";
    editForm.classList.add("hidden");
    conversationList.innerHTML = "";
    return;
  }

  const { post, conversations } = data;
  manageStatus.textContent = `Status: ${post.status}. Expires: ${dateLabel(post.expiresAt)}.`;
  setFormValues(post);
  renderConversations(conversations, token);
}

async function init() {
  const token = tokenFromPath();
  if (!token) {
    manageStatus.classList.add("error");
    manageStatus.textContent = "Manage link is invalid.";
    editForm.classList.add("hidden");
    return;
  }

  formatSelect.addEventListener("change", setLocationRequirement);

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    editStatus.classList.remove("error");
    editStatus.textContent = "Saving...";
    const payload = Object.fromEntries(new FormData(editForm).entries());
    const response = await fetch(`/api/manage/${token}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      editStatus.classList.add("error");
      editStatus.textContent = data.error || "Could not save changes.";
      return;
    }
    editStatus.textContent = "Saved.";
    await loadManageView(token);
  });

  renewBtn.addEventListener("click", async () => {
    const selectedDuration = Number(renewDuration.value || 14);
    editStatus.classList.remove("error");
    editStatus.textContent = "Renewing...";
    const response = await fetch(`/api/manage/${token}/renew`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationDays: selectedDuration })
    });
    const data = await response.json();
    if (!response.ok) {
      editStatus.classList.add("error");
      editStatus.textContent = data.error || "Could not renew post.";
      return;
    }
    editStatus.textContent = `Renewed for ${selectedDuration} days.`;
    await loadManageView(token);
  });

  deactivateBtn.addEventListener("click", async () => {
    editStatus.classList.remove("error");
    editStatus.textContent = "Updating...";
    const response = await fetch(`/api/manage/${token}/deactivate`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      editStatus.classList.add("error");
      editStatus.textContent = data.error || "Could not deactivate post.";
      return;
    }
    editStatus.textContent = "Post marked inactive.";
    await loadManageView(token);
  });

  await loadManageView(token);
}

init().catch(() => {
  manageStatus.classList.add("error");
  manageStatus.textContent = "Could not load this manage page.";
  editForm.classList.add("hidden");
});
