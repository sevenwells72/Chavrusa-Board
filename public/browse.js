const categoryFilter = document.getElementById("categoryFilter");
const formatFilter = document.getElementById("formatFilter");
const levelFilter = document.getElementById("levelFilter");
const timeZoneFilter = document.getElementById("timeZoneFilter");
const seferFilter = document.getElementById("seferFilter");
const dayFilter = document.getElementById("dayFilter");
const timeFilter = document.getElementById("timeFilter");
const results = document.getElementById("results");
const siteTitle = document.getElementById("siteTitle");

const formatLabels = {
  in_person_only: "In-person only",
  in_person_preferred: "In-person preferred",
  remote_only: "Remote only",
  flexible: "Flexible"
};

const formatIcons = {
  in_person_only: "📍",
  in_person_preferred: "🤝",
  remote_only: "💻",
  flexible: "🔁"
};

let posts = [];
let adminMode = false;
let ownerDeleteKey = sessionStorage.getItem("ownerDeleteKey") || "";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toDateLabel(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function timeToMinutes(value) {
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return null;
  }
  return h * 60 + m;
}

function formatTimeLabel(value) {
  const minutes = timeToMinutes(value);
  if (minutes === null) {
    return "";
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  const min = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
  return `${hour}${min}${suffix}`;
}

function formatSlot(slot) {
  if (slot.flexible) {
    return `${slot.day} flexible`;
  }
  return `${slot.day} ${formatTimeLabel(slot.start)}-${formatTimeLabel(slot.end)}`;
}

function isOverlapMatch(post, day, time) {
  if (!day && !time) {
    return true;
  }
  if (post.openToOtherTimes) {
    return true;
  }
  const slots = Array.isArray(post.availabilitySlots) ? post.availabilitySlots : [];
  if (!slots.length) {
    return false;
  }

  const selectedMinutes = time ? timeToMinutes(time) : null;
  return slots.some((slot) => {
    if (day && slot.day !== day) {
      return false;
    }
    if (slot.flexible) {
      return true;
    }
    if (selectedMinutes === null) {
      return true;
    }
    const start = timeToMinutes(slot.start);
    const end = timeToMinutes(slot.end);
    if (start === null || end === null) {
      return false;
    }
    return selectedMinutes >= start && selectedMinutes <= end;
  });
}

function setAdminMode(enabled) {
  adminMode = enabled;
  document.body.classList.toggle("admin-mode", adminMode);
}

function render(items) {
  if (!items.length) {
    results.innerHTML = '<article class="card"><p>No active posts match these filters.</p></article>';
    return;
  }

  results.innerHTML = items
    .map((post) => {
      const slots = Array.isArray(post.availabilitySlots) ? post.availabilitySlots : [];
      const slotsText = slots.length ? slots.map(formatSlot).join(", ") : "No time slots listed";
      const displayName = post.posterName ? post.posterName : "Anonymous learner";

      return `
        <article class="card post-card">
          <button class="owner-delete-btn" data-post-id="${escapeHtml(post.id)}" title="Owner delete">Delete</button>
          <div class="post-head">
            <p class="display-name">${escapeHtml(displayName)}</p>
            <h3>${escapeHtml(post.topic)}</h3>
            <p class="muted">Post code: <strong>${escapeHtml(post.postCode || "")}</strong></p>
          </div>
          <div class="meta">
            <span class="tag">${escapeHtml(post.category)}</span>
            ${post.seferName ? `<span class="tag">${escapeHtml(post.seferName)}</span>` : ""}
            <span class="tag">${escapeHtml(post.timeZone)}</span>
            <span class="tag">${escapeHtml(post.familiarityLevel)}</span>
            <span class="tag">${escapeHtml(formatIcons[post.format] || "•")} ${escapeHtml(formatLabels[post.format] || post.format)}</span>
          </div>
          <div class="post-body">
            <p><strong>Learning style:</strong> ${escapeHtml(post.learningStyle)}</p>
            <p><strong>Times:</strong> ${escapeHtml(slotsText)}</p>
            ${
              post.openToOtherTimes
                ? '<p class="muted"><em>Open to other times too.</em></p>'
                : ""
            }
            ${
              post.availabilityNotes
                ? `<p><strong>Availability notes:</strong> ${escapeHtml(post.availabilityNotes)}</p>`
                : ""
            }
            ${
              post.city && post.state
                ? `<p><strong>Location:</strong> ${escapeHtml(post.city)}, ${escapeHtml(post.state)}</p>`
                : ""
            }
          </div>
          <div class="post-foot">
            <p class="muted">Active until ${toDateLabel(post.expiresAt)}</p>
            <p><a class="button-link" href="/respond/${post.id}">Respond</a></p>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".owner-delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!adminMode) {
        return;
      }
      const postId = button.getAttribute("data-post-id");
      const confirmed = window.confirm("Delete this post permanently?");
      if (!confirmed) {
        return;
      }

      const response = await fetch("/api/admin/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, key: ownerDeleteKey })
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || "Could not delete post.");
        return;
      }

      posts = posts.filter((post) => post.id !== postId);
      applyFilters();
    });
  });
}

function populateTimeOptions() {
  for (let hour = 6; hour <= 23; hour += 1) {
    for (let minute = 0; minute < 60; minute += 30) {
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const option = document.createElement("option");
      option.value = value;
      option.textContent = formatTimeLabel(value);
      timeFilter.appendChild(option);
    }
  }
}

function applyFilters() {
  const seferQuery = (seferFilter.value || "").trim().toLowerCase();
  const day = dayFilter.value;
  const time = timeFilter.value;

  const filtered = posts.filter((post) => {
    const categoryMatch = !categoryFilter.value || post.category === categoryFilter.value;
    const formatMatch = !formatFilter.value || post.format === formatFilter.value;
    const zoneMatch = !timeZoneFilter.value || post.timeZone === timeZoneFilter.value;
    const levelMatch = !levelFilter.value || post.familiarityLevel === levelFilter.value;
    const seferText = `${post.seferName || ""} ${post.topic || ""}`.toLowerCase();
    const seferMatch = !seferQuery || seferText.includes(seferQuery);
    const overlapMatch = isOverlapMatch(post, day, time);
    return categoryMatch && formatMatch && zoneMatch && levelMatch && seferMatch && overlapMatch;
  });

  filtered.sort((a, b) => {
    const aOverlap = isOverlapMatch(a, day, time) ? 1 : 0;
    const bOverlap = isOverlapMatch(b, day, time) ? 1 : 0;
    if (bOverlap !== aOverlap) {
      return bOverlap - aOverlap;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  render(filtered);
}

async function init() {
  populateTimeOptions();

  try {
    const response = await fetch("/api/posts");
    const data = await response.json();
    posts = data.posts || [];
  } catch (_error) {
    results.innerHTML = '<article class="card"><p>Could not load posts right now.</p></article>';
    return;
  }

  const categories = [...new Set(posts.map((post) => post.category))].sort();
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });

  const levels = [...new Set(posts.map((post) => post.familiarityLevel).filter(Boolean))].sort();
  levels.forEach((level) => {
    const option = document.createElement("option");
    option.value = level;
    option.textContent = level;
    levelFilter.appendChild(option);
  });

  const zones = [...new Set(posts.map((post) => post.timeZone))].sort();
  zones.forEach((zone) => {
    const option = document.createElement("option");
    option.value = zone;
    option.textContent = zone;
    timeZoneFilter.appendChild(option);
  });

  [
    categoryFilter,
    formatFilter,
    levelFilter,
    timeZoneFilter,
    dayFilter,
    timeFilter
  ].forEach((el) => el.addEventListener("change", applyFilters));
  seferFilter.addEventListener("input", applyFilters);

  siteTitle?.addEventListener("dblclick", () => {
    if (adminMode) {
      setAdminMode(false);
      return;
    }
    const key = window.prompt("Owner key");
    if (!key) {
      return;
    }
    ownerDeleteKey = key.trim();
    sessionStorage.setItem("ownerDeleteKey", ownerDeleteKey);
    setAdminMode(true);
    applyFilters();
  });

  applyFilters();
}

init();
