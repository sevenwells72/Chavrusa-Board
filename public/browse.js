const categoryFilter = document.getElementById("categoryFilter");
const formatFilter = document.getElementById("formatFilter");
const timeZoneFilter = document.getElementById("timeZoneFilter");
const results = document.getElementById("results");

const formatLabels = {
  in_person_only: "In-person only",
  in_person_preferred: "In-person preferred",
  remote_only: "Remote only",
  flexible: "Flexible"
};

let posts = [];

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

function render(items) {
  if (!items.length) {
    results.innerHTML = '<article class="card"><p>No active posts match these filters.</p></article>';
    return;
  }

  results.innerHTML = items
    .map(
      (post) => `
        <article class="card">
          <h3>${escapeHtml(post.topic)}</h3>
          <div class="meta">
            <span class="tag">${escapeHtml(post.category)}</span>
            <span class="tag">${escapeHtml(formatLabels[post.format] || post.format)}</span>
            <span class="tag">${escapeHtml(post.timeZone)}</span>
            <span class="tag">${escapeHtml(post.familiarityLevel)}</span>
          </div>
          <p><strong>Learning style:</strong> ${escapeHtml(post.learningStyle)}</p>
          <p><strong>Availability:</strong> ${escapeHtml(post.availability)}</p>
          ${
            post.city && post.state
              ? `<p><strong>Location:</strong> ${escapeHtml(post.city)}, ${escapeHtml(post.state)}</p>`
              : ""
          }
          <p class="muted">Active until ${toDateLabel(post.expiresAt)}</p>
          <p><a class="button-link" href="/respond/${post.id}">Respond</a></p>
        </article>
      `
    )
    .join("");
}

async function init() {
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

  const zones = [...new Set(posts.map((post) => post.timeZone))].sort();
  zones.forEach((zone) => {
    const option = document.createElement("option");
    option.value = zone;
    option.textContent = zone;
    timeZoneFilter.appendChild(option);
  });

  const applyFilters = () => {
    const filtered = posts.filter((post) => {
      const categoryMatch = !categoryFilter.value || post.category === categoryFilter.value;
      const formatMatch = !formatFilter.value || post.format === formatFilter.value;
      const zoneMatch = !timeZoneFilter.value || post.timeZone === timeZoneFilter.value;
      return categoryMatch && formatMatch && zoneMatch;
    });
    render(filtered);
  };

  [categoryFilter, formatFilter, timeZoneFilter].forEach((el) =>
    el.addEventListener("change", applyFilters)
  );
  applyFilters();
}

init();
