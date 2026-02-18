const form = document.getElementById("requestForm");
const statusEl = document.getElementById("status");
const formatSelect = document.getElementById("formatSelect");
const locationFields = document.getElementById("locationFields");
const cityInput = document.getElementById("cityInput");
const stateInput = document.getElementById("stateInput");
const manageBox = document.getElementById("manageBox");
const manageLink = document.getElementById("manageLink");
const timeZoneSelect = document.getElementById("timeZoneSelect");
const slotList = document.getElementById("slotList");
const addSlotBtn = document.getElementById("addSlotBtn");
const availabilitySlotsInput = document.getElementById("availabilitySlotsInput");

const dayOptions = ["Daily", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Motzei Shabbos"];

function toTitleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

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
}

function buildDaySelect(selected = "") {
  return `
    <select class="slot-day">
      <option value="">Day</option>
      ${dayOptions
        .map(
          (day) => `<option value="${day}" ${selected === day ? "selected" : ""}>${day}</option>`
        )
        .join("")}
    </select>
  `;
}

function addSlot(slot = {}) {
  const row = document.createElement("div");
  row.className = "slot-row";
  row.innerHTML = `
    <div class="slot-row-grid">
      <label>
        Day
        ${buildDaySelect(slot.day || "")}
      </label>
      <label>
        Start
        <input class="slot-start" type="time" value="${slot.start || ""}" />
      </label>
      <label>
        End
        <input class="slot-end" type="time" value="${slot.end || ""}" />
      </label>
      <label class="toggle">
        <input class="slot-flex" type="checkbox" ${slot.flexible ? "checked" : ""} />
        Flexible this day
      </label>
      <button type="button" class="secondary slot-remove">Remove</button>
    </div>
  `;

  const flexInput = row.querySelector(".slot-flex");
  const startInput = row.querySelector(".slot-start");
  const endInput = row.querySelector(".slot-end");
  const removeBtn = row.querySelector(".slot-remove");

  const refreshFlex = () => {
    const disabled = flexInput.checked;
    startInput.disabled = disabled;
    endInput.disabled = disabled;
    if (disabled) {
      startInput.value = "";
      endInput.value = "";
    }
  };

  flexInput.addEventListener("change", refreshFlex);
  removeBtn.addEventListener("click", () => row.remove());
  refreshFlex();
  slotList.appendChild(row);
}

function collectSlots() {
  const rows = Array.from(slotList.querySelectorAll(".slot-row"));
  const slots = [];

  for (const row of rows) {
    const day = row.querySelector(".slot-day").value;
    const start = row.querySelector(".slot-start").value;
    const end = row.querySelector(".slot-end").value;
    const flexible = row.querySelector(".slot-flex").checked;
    if (!day) {
      continue;
    }
    if (!flexible && (!start || !end || start >= end)) {
      return { error: "Each non-flexible slot must include a valid start/end time." };
    }
    slots.push({
      day,
      start: flexible ? "" : start,
      end: flexible ? "" : end,
      flexible
    });
  }

  return { slots };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.classList.remove("error");
  statusEl.textContent = "Posting...";

  const slotResult = collectSlots();
  if (slotResult.error) {
    statusEl.classList.add("error");
    statusEl.textContent = slotResult.error;
    return;
  }

  availabilitySlotsInput.value = JSON.stringify(slotResult.slots);
  if (form.elements.posterName.value) {
    form.elements.posterName.value = toTitleCase(form.elements.posterName.value);
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const request = async () =>
      fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    let response = await request();
    if (!response.ok && response.status >= 500) {
      // One retry for transient deploy/restart blips.
      response = await request();
    }

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_error) {
      data = {};
    }

    if (!response.ok) {
      statusEl.classList.add("error");
      const detail = data.error || `Request failed (${response.status}).`;
      statusEl.textContent = detail;
      return;
    }

    statusEl.textContent = "Post is live.";
    manageBox.classList.remove("hidden");
    manageLink.href = data.manageUrl;
    manageLink.textContent = data.manageUrl;
    form.reset();
    slotList.innerHTML = "";
    addSlot();
    setLocationRequirement();
  } catch (_error) {
    statusEl.classList.add("error");
    statusEl.textContent = "Network error while sending request.";
  }
});

addSlotBtn.addEventListener("click", () => addSlot());
loadTimeZones();
formatSelect.addEventListener("change", setLocationRequirement);
setLocationRequirement();
addSlot();
