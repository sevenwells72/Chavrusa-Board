const form = document.getElementById("requestForm");
const statusEl = document.getElementById("status");
const formatSelect = document.getElementById("formatSelect");
const locationFields = document.getElementById("locationFields");
const cityInput = document.getElementById("cityInput");
const stateInput = document.getElementById("stateInput");
const manageBox = document.getElementById("manageBox");
const manageLink = document.getElementById("manageLink");
const timeZoneSelect = document.getElementById("timeZoneSelect");

function loadTimeZones() {
  const fallback = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Asia/Jerusalem"
  ];
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : fallback;

  zones.forEach((zone) => {
    const option = document.createElement("option");
    option.value = zone;
    option.textContent = zone;
    if (zone === Intl.DateTimeFormat().resolvedOptions().timeZone) {
      option.selected = true;
    }
    timeZoneSelect.appendChild(option);
  });
}

function setLocationRequirement() {
  const needsLocation =
    formatSelect.value === "in_person_only" || formatSelect.value === "in_person_preferred";
  locationFields.classList.toggle("hidden", !needsLocation);
  cityInput.required = needsLocation;
  stateInput.required = needsLocation;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.classList.remove("error");
  statusEl.textContent = "Posting...";

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok) {
      statusEl.classList.add("error");
      statusEl.textContent = data.error || "Could not submit request.";
      return;
    }

    statusEl.textContent = "Post is live.";
    manageBox.classList.remove("hidden");
    manageLink.href = data.manageUrl;
    manageLink.textContent = data.manageUrl;
    form.reset();
    setLocationRequirement();
  } catch (_error) {
    statusEl.classList.add("error");
    statusEl.textContent = "Network error while sending request.";
  }
});

loadTimeZones();
formatSelect.addEventListener("change", setLocationRequirement);
setLocationRequirement();
