const statusEl = document.getElementById("status");
const postDetails = document.getElementById("postDetails");
const form = document.getElementById("respondForm");

const formatLabels = {
  in_person_only: "In-person only",
  in_person_preferred: "In-person preferred",
  remote_only: "Remote only",
  flexible: "In person or remote"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function postIdFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[1] || "";
}

function renderPost(post) {
  const slots = Array.isArray(post.availabilitySlots) ? post.availabilitySlots : [];
  const slotText = slots.length
    ? slots
        .map((slot) =>
          slot.flexible ? `${slot.day} flexible` : `${slot.day} ${slot.start}-${slot.end}`
        )
        .join(", ")
    : "";

  postDetails.innerHTML = `
    <h2>${escapeHtml(post.topic)}</h2>
    <p class="muted">Post code: <strong>${escapeHtml(post.postCode || "")}</strong></p>
    <div class="meta">
      <span class="tag">${escapeHtml(post.category)}</span>
      ${post.seferName ? `<span class="tag">${escapeHtml(post.seferName)}</span>` : ""}
      <span class="tag">${escapeHtml(formatLabels[post.format] || post.format)}</span>
      <span class="tag">${escapeHtml(post.timeZone)}</span>
      <span class="tag">${escapeHtml(post.familiarityLevel)}</span>
    </div>
    <p><strong>Learning style:</strong> ${escapeHtml(post.learningStyle)}</p>
    ${slotText ? `<p><strong>Times:</strong> ${escapeHtml(slotText)}</p>` : ""}
    ${
      post.availabilityNotes
        ? `<p><strong>Availability notes:</strong> ${escapeHtml(post.availabilityNotes)}</p>`
        : ""
    }
    ${post.openToOtherTimes ? `<p class="muted"><em>Open to other times too.</em></p>` : ""}
    ${
      post.location
        ? `<p><strong>Location:</strong> ${escapeHtml(post.location)}</p>`
        : post.city && post.state
          ? `<p><strong>Location:</strong> ${escapeHtml(post.city)}, ${escapeHtml(post.state)}</p>`
          : ""
    }
    <p class="muted">Contact is relayed privately. Your email is not shown publicly.</p>
  `;
}

async function init() {
  const postId = postIdFromPath();
  if (!postId) {
    postDetails.innerHTML = "<p>Post not found.</p>";
    form.classList.add("hidden");
    return;
  }

  const response = await fetch(`/api/posts/${postId}`);
  const data = await response.json();
  if (!response.ok) {
    postDetails.innerHTML = `<p>${data.error || "Post not found."}</p>`;
    form.classList.add("hidden");
    return;
  }

  renderPost(data.post);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusEl.classList.remove("error");
    statusEl.textContent = "Sending...";

    const payload = Object.fromEntries(new FormData(form).entries());
    const sendResponse = await fetch(`/api/posts/${postId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const sendData = await sendResponse.json();
    if (!sendResponse.ok) {
      statusEl.classList.add("error");
      statusEl.textContent = sendData.error || "Could not send response.";
      return;
    }

    form.reset();
    if (sendData.warning) {
      statusEl.classList.remove("error");
      statusEl.textContent = sendData.warning;
      return;
    }

    statusEl.textContent = "Message sent privately to the poster.";
  });
}

init().catch(() => {
  postDetails.innerHTML = "<p>Could not load this post right now.</p>";
  form.classList.add("hidden");
});
