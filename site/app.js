/* Texas A&M campus amenity map. Data is site/data/campus.json. */

const MILE_METERS = 1609.344;

const NOUN = {
  microwave: ["microwave", "microwaves"],
  snack_vending: ["snack machine", "snack machines"],
  drink_vending: ["drink machine", "drink machines"],
  lost_and_found: ["lost and found", "lost and founds"],
  printer: ["printer", "printers"],
};

function noun(categoryId, count) {
  const [one, many] = NOUN[categoryId];
  return count === 1 ? one : many;
}

const CONFIDENCE = {
  explicit: "",
  presence_only: "Counted as 1",
  inferred_from_locations: "Counted as 1 per place listed",
  unspecified: "No count available",
  unconfirmed: "Not confirmed",
};

const STUDY = {
  yes: "Yes",
  no: "No",
  not_really: "Not really",
  unknown: "Not listed",
};

const PIN = {
  counted: { color: "#fffdfb", weight: 2, fillColor: "#500000", fillOpacity: 0.95, radius: 8 },
  unconfirmed: { color: "#fffdfb", weight: 2, fillColor: "#8d5c10", fillOpacity: 0.95, radius: 8 },
  empty: { color: "#fffdfb", weight: 2, fillColor: "#8d827b", fillOpacity: 0.92, radius: 7 },
};

const VISITOR_SWAPS = [
  ["The team also calls this building Jackie B.", "Also known as Jackie B."],
  [
    'A second sheet row labeled Civil Engineering Building (DLEB) said "Floor 1, 2 microwaves". That row is this building. Those are the same 2 microwaves already listed on the 1st floor, so they were not counted again.',
    "Also known as the Civil Engineering Building. The two first-floor microwaves are already included above.",
  ],
  [
    "Chargers / lab equipment cell: 12th Man Technology store, lower level (a retail store, not a vending machine) This was not counted as a microwave, printer, lost and found, or snack or drink machine.",
    "12th Man Technology is a retail store on the lower level, not a vending machine.",
  ],
  [
    "Food vending cell: None. A marketplace with set hours instead. No snack vending machine was counted.",
    "A marketplace with set hours is here. It is not a snack machine.",
  ],
  [
    "Chargers / lab equipment cell: Tech vending machine on the 3rd floor This was not counted as a microwave, printer, lost and found, or snack or drink machine.",
    "A tech vending machine is on the 3rd floor. It does not sell snacks or drinks.",
  ],
  [
    "Notes: Bagel Block (a food spot). Not counted as a vending machine.",
    "Bagel Block, a food counter, is in this building. It is not a vending machine.",
  ],
  ["The cell says yes rather than a number, so this is counted as 1.", "Listed as available. Counted as 1."],
  ["The cell says this is not confirmed, so it is not included in campus totals.", "Not confirmed, so it is not included in the campus total."],
  [
    "No number was stated, so each listed place is counted as 1. The sheet says the exact spot was not given; the microwave is still treated as stated.",
    "No exact number was given, so each place is counted as 1. The exact spot on this floor was not specified.",
  ],
  ["No number was stated, so each listed place is counted as 1.", "No exact number was given, so each place is counted as 1."],
  ["No number was stated, so each named floor is counted as 1.", "No exact number was given, so each floor listed is counted as 1."],
  ["No number was stated, so this is counted as 1.", "No exact number was given, so this is counted as 1."],
  ["A place is described but no number is given, so this is counted as 1.", "A place is described, but no number was given, so this is counted as 1."],
  ["Only a floor is stated, so this is counted as 1.", "Only a floor is listed, so this is counted as 1."],
  ["No number of machines was stated, so this is one microwave per named floor.", "No number of machines was given, so this counts one microwave per floor listed."],
  ["Microwaves are mentioned, but no number or list of places is given, so nothing was added to the campus total.", "Microwaves are mentioned, but no count was given, so they are not in the campus total."],
  ["More than one place is described and no number is given, so each place is counted as 1.", "More than one place is listed and no number was given, so each place is counted as 1."],
  ["The cell gives this total and then names the places, so the places were not counted again.", "This is the total for the places listed."],
  ["Listed on a TAMU OAL line in the same cell as a separate printer total, so it was not added again.", "Also appears on the library print list and is not added again."],
  [
    "Medical Sciences Library: 1 printers listed but not added. Listed on a TAMU OAL line in the same cell as a separate printer total, so it was not added again.",
    "Medical Sciences Library also lists 1 printer on the library print list. It is not added again.",
  ],
  [
    'Mitchell Physics Building is not in the snack vending total: "Probably yes, 3rd floor (not confirmed)".',
    "Mitchell Physics may have a snack machine on the 3rd floor. That is not confirmed, so it is not in the total.",
  ],
  [
    "Academic Building mentions microwaves, but the sheet gives no number, so that row is not in the campus total.",
    "Academic Building has microwaves, but no count was given, so they are not in the total.",
  ],
  ["TAMU OAL list", "Library print list"],
];

const state = {
  data: null,
  active: new Set(),
  studyOnly: false,
  query: "",
  selectedId: null,
  markers: new Map(),
  map: null,
  locationLayers: null,
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function visitorCopy(text) {
  if (!text) return "";
  let value = String(text);
  for (const [from, to] of VISITOR_SWAPS) {
    if (value.includes(from)) value = value.split(from).join(to);
  }
  return value
    .replace(/^Notes:\s*/i, "")
    .replace(/\bthe team\b/gi, "")
    .replace(/\bdatathon\b/gi, "")
    .replace(/\bthe sheet\b/gi, "the listing")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

function byId(id) {
  return state.data.buildings.find((building) => building.building_id === id);
}

function pinKind(building) {
  const counted = state.data.categories.some((category) => building.counts[category.id] > 0);
  const unspecified = building.amenities.some((item) => item.count_confidence === "unspecified");
  if (counted || unspecified) return "counted";
  if (building.amenities.some((item) => !item.confirmed)) return "unconfirmed";
  return "empty";
}

function matches(building) {
  const query = state.query.trim().toLowerCase();
  if (query) {
    const haystack = [
      building.building_name,
      building.sheet_abbrev,
      building.official_name,
      building.official_abbrev,
      building.address,
    ].join(" ").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (state.studyOnly && building.study_friendly !== "yes") return false;
  if (building.amenities.length === 0) return state.active.size === state.data.categories.length;
  return building.amenities.some((item) => state.active.has(item.category));
}

function visibleBuildings() {
  return state.data.buildings.filter(matches);
}

function haversine(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

function formatDistance(meters) {
  const miles = meters / MILE_METERS;
  if (miles < 0.1) return `${Math.max(1, Math.round(meters * 3.28084))} ft`;
  if (miles < 10) return `${miles.toFixed(miles < 1 ? 2 : 1)} mi`;
  return `${Math.round(miles)} mi`;
}

function distancesFrom(latitude, longitude) {
  return state.data.buildings
    .filter((building) => building.mapped)
    .map((building) => ({
      building,
      meters: haversine(latitude, longitude, building.latitude, building.longitude),
    }))
    .sort((left, right) => left.meters - right.meters);
}

function popupHtml(building) {
  const address = building.address ? ` · ${escapeHtml(building.address)}` : "";
  const also = building.official_abbrev && building.official_abbrev !== building.sheet_abbrev
    ? `<br>Also labeled ${escapeHtml(building.official_abbrev)}`
    : "";
  let html = `<div class="popup"><h2>${escapeHtml(building.building_name)}</h2>`;
  html += `<p class="meta">${escapeHtml(building.sheet_abbrev)}${address}${also}<br>Study friendly: ${escapeHtml(STUDY[building.study_friendly] || "Not listed")}</p>`;

  if (!building.amenities.length) {
    html += "<p>No microwaves, snack machines, drink machines, printers, or lost and found are listed here.</p>";
  }

  for (const category of state.data.categories) {
    const items = building.amenities.filter((item) => item.category === category.id);
    if (!items.length) continue;
    const counted = building.counts[category.id];
    html += `<h3>${escapeHtml(category.label)}${counted ? ` · ${counted}` : ""}</h3>`;
    for (const item of items) {
      const countText = item.count == null ? "No count" : String(item.count);
      let placeText = visitorCopy(item.location_detail);
      if (item.count != null) {
        placeText = placeText.replace(new RegExp(`^${item.count}\\s+microwaves?,\\s*`, "i"), "");
      }
      const place = escapeHtml(placeText || "Location not listed");
      const section = item.section ? `<span class="confidence">${escapeHtml(visitorCopy(item.section))}</span><br>` : "";
      html += `<p class="item">${section}<span class="count">${escapeHtml(countText)}</span> — ${place}`;
      if (item.restrictions) html += `<br><span class="restriction">Restriction: ${escapeHtml(visitorCopy(item.restrictions))}</span>`;
      const note = visitorCopy(item.parse_notes);
      const confidence = CONFIDENCE[item.count_confidence] || "";
      if (note) html += `<br><span class="confidence">${escapeHtml(note)}</span>`;
      else if (confidence) html += `<br><span class="confidence">${escapeHtml(confidence)}</span>`;
      html += "</p>";
    }
  }

  const mentions = building.other_mentions.map(visitorCopy).filter(Boolean);
  if (mentions.length) {
    html += `<div class="other"><h3>Other notes</h3>`;
    for (const mention of mentions) html += `<p class="item">${escapeHtml(mention)}</p>`;
    html += "</div>";
  }

  html += building.mapped
    ? `<p class="geo">Location is approximate and marks the building, not a specific room.</p>`
    : `<p class="geo">This building is not on the map yet.</p>`;
  html += "</div>";
  return html;
}

function countLine(building) {
  const parts = [];
  for (const category of state.data.categories) {
    const count = building.counts[category.id];
    if (count > 0) parts.push(`${count} ${noun(category.id, count)}`);
  }
  const flags = [];
  for (const item of building.amenities) {
    if (item.count_confidence === "unspecified") flags.push(`${noun(item.category, 2)}, no count`);
    if (item.count_confidence === "unconfirmed") flags.push(`${noun(item.category, 2)} not confirmed`);
  }
  return { parts, flags: [...new Set(flags)] };
}

function renderTotals() {
  const root = document.getElementById("totals");
  root.replaceChildren();
  for (const category of state.data.categories) {
    const total = state.data.totals[category.id];
    const row = document.createElement("div");
    row.className = "total-row";
    const label = document.createElement("span");
    const buildings = total.buildings_with_counted.length === 1
      ? "1 building"
      : `${total.buildings_with_counted.length} buildings`;
    label.innerHTML = `${escapeHtml(category.label)}<small>${escapeHtml(buildings)}</small>`;
    const value = document.createElement("b");
    value.textContent = String(total.counted);
    row.append(label, value);
    root.append(row);
  }
  const notes = document.getElementById("total-notes");
  notes.replaceChildren();
  for (const note of state.data.total_notes) {
    const item = document.createElement("li");
    item.textContent = visitorCopy(note);
    notes.append(item);
  }
}

function renderDetail() {
  const root = document.getElementById("detail");
  const building = state.selectedId ? byId(state.selectedId) : null;
  if (!building || building.mapped) {
    root.hidden = true;
    root.replaceChildren();
    return;
  }
  root.hidden = false;
  root.innerHTML = popupHtml(building);
}

function renderList() {
  const root = document.getElementById("building-list");
  const buildings = visibleBuildings();
  document.getElementById("showing").textContent = buildings.length
    ? `Showing ${buildings.length} of ${state.data.buildings.length} buildings.`
    : "No buildings match these filters.";
  root.replaceChildren();
  renderDetail();
  if (!buildings.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Turn a category back on, or clear the search.";
    root.append(empty);
    return;
  }
  for (const building of buildings) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "building";
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-current", building.building_id === state.selectedId ? "true" : "false");
    const { parts, flags } = countLine(building);
    const line = parts.length ? parts.join(" · ") : "Nothing listed yet";
    const tags = [
      `Study friendly: ${STUDY[building.study_friendly]}`,
      ...flags,
      building.mapped ? "" : "Not on the map",
    ].filter(Boolean);
    button.innerHTML = `<strong>${escapeHtml(building.building_name)}</strong><span class="sub">${escapeHtml(building.sheet_abbrev)} · ${escapeHtml(line)}</span><span class="tags">${tags.map((tag) => {
      const kind = tag.startsWith("Not") || tag.includes("not ") ? "warn" : "muted";
      return `<span class="tag ${kind}">${escapeHtml(tag)}</span>`;
    }).join("")}</span>`;
    button.addEventListener("click", () => select(building.building_id, true));
    root.append(button);
  }
}

function styleFor(building) {
  const kind = pinKind(building);
  const selected = building.building_id === state.selectedId;
  return { ...PIN[kind], radius: selected ? 11 : PIN[kind].radius, weight: selected ? 3 : 2 };
}

function syncMarkers() {
  const visible = new Set(visibleBuildings().filter((building) => building.mapped).map((building) => building.building_id));
  for (const [id, marker] of state.markers) {
    if (!visible.has(id)) {
      marker.remove();
      state.markers.delete(id);
    }
  }
  for (const building of state.data.buildings) {
    if (!visible.has(building.building_id) || state.markers.has(building.building_id)) continue;
    const marker = L.circleMarker([building.latitude, building.longitude], styleFor(building));
    marker.bindPopup(popupHtml(building), { maxWidth: 320 });
    marker.on("click", () => select(building.building_id, false));
    marker.addTo(state.map);
    state.markers.set(building.building_id, marker);
  }
  for (const [id, marker] of state.markers) marker.setStyle(styleFor(byId(id)));
}

function syncToggleButtons() {
  document.querySelectorAll(".toggle").forEach((button) => {
    const match = state.data.categories.find((item) => item.label === button.textContent);
    if (match) button.setAttribute("aria-pressed", state.active.has(match.id) ? "true" : "false");
  });
}

function select(id, openPopup) {
  state.selectedId = id;
  renderList();
  syncMarkers();
  const building = byId(id);
  const marker = state.markers.get(id);
  if (openPopup && marker) {
    state.map.setView([building.latitude, building.longitude], Math.max(state.map.getZoom(), 16));
    marker.openPopup();
    if (window.matchMedia("(max-width: 860px)").matches) {
      document.querySelector(".map-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  const current = document.querySelector('.building[aria-current="true"]');
  if (current && !openPopup) current.scrollIntoView({ block: "nearest" });
}

function revealAndSelect(id) {
  const building = byId(id);
  state.studyOnly = false;
  document.getElementById("study-only").checked = false;
  if (!building.amenities.length) {
    for (const category of state.data.categories) state.active.add(category.id);
  } else {
    for (const item of building.amenities) state.active.add(item.category);
  }
  syncToggleButtons();
  select(id, true);
}

function renderNearby(ranked) {
  const list = document.getElementById("nearby-list");
  const status = document.getElementById("location-status");
  const nearby = ranked.filter((item) => item.meters <= MILE_METERS);
  list.replaceChildren();
  if (!nearby.length) {
    list.hidden = true;
    const closest = ranked[0];
    status.textContent = closest
      ? `No buildings on this map are within 1 mile. The closest is ${closest.building.building_name}, about ${formatDistance(closest.meters)} away.`
      : "No buildings on this map are within 1 mile.";
    return;
  }
  status.textContent = nearby.length === 1
    ? "1 building within 1 mile."
    : `${nearby.length} buildings within 1 mile.`;
  list.hidden = false;
  for (const item of nearby) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "building";
    button.innerHTML = `<strong>${escapeHtml(item.building.building_name)}</strong><span class="sub">${escapeHtml(formatDistance(item.meters))} away</span>`;
    button.addEventListener("click", () => revealAndSelect(item.building.building_id));
    list.append(button);
  }
}

function showLocation(position) {
  const { latitude, longitude, accuracy } = position.coords;
  state.locationLayers.clearLayers();
  if (typeof accuracy === "number" && accuracy > 0) {
    L.circle([latitude, longitude], {
      radius: accuracy,
      color: "#1f4e79",
      weight: 1,
      fillColor: "#1f4e79",
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(state.locationLayers);
  }
  const mile = L.circle([latitude, longitude], {
    radius: MILE_METERS,
    color: "#500000",
    weight: 2,
    dashArray: "7 7",
    fillColor: "#500000",
    fillOpacity: 0.04,
    interactive: false,
  }).addTo(state.locationLayers);
  const marker = L.circleMarker([latitude, longitude], {
    radius: 8,
    color: "#fffdfb",
    weight: 3,
    fillColor: "#1f4e79",
    fillOpacity: 1,
  }).addTo(state.locationLayers);
  marker.bindTooltip("You are here", { permanent: true, direction: "right", offset: [8, 0] });
  const ranked = distancesFrom(latitude, longitude);
  renderNearby(ranked);
  const bounds = mile.getBounds();
  if (!ranked.some((item) => item.meters <= MILE_METERS) && ranked[0]) {
    bounds.extend([ranked[0].building.latitude, ranked[0].building.longitude]);
  }
  state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
}

function locateUser() {
  const status = document.getElementById("location-status");
  if (!navigator.geolocation) {
    status.textContent = "Location is not available in this browser. Search still works.";
    return;
  }
  status.textContent = "Finding your location…";
  navigator.geolocation.getCurrentPosition(showLocation, (error) => {
    document.getElementById("nearby-list").hidden = true;
    if (error.code === 1) {
      status.textContent = "Location permission was denied. You can still search by building name.";
    } else if (error.code === 3) {
      status.textContent = "Location took too long. Try again, or search by building name.";
    } else {
      status.textContent = "Location is unavailable right now. You can still search by building name.";
    }
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
}

function siteConfig() {
  return window.SITE_CONFIG || {};
}

function suggestionStatus(kind) {
  if (kind === "sent" || kind === "google") return "Thanks. Your suggestion was sent.";
  if (kind === "mailto") return "Your email app should open with this note.";
  if (kind === "google-unmapped") return "A Google Form address is set, but the question IDs are missing. The connection steps are in the project README.";
  if (kind === "unconfigured") return "Suggestions are not connected yet. You can still use the map.";
  return "The suggestion could not be sent. Try again in a moment.";
}

function postGoogleForm(endpoint, fields, payload) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = endpoint;
  form.target = "suggest-frame";
  form.hidden = true;
  const add = (name, value) => {
    if (!name) return;
    const input = document.createElement("input");
    input.name = name;
    input.value = value || "";
    form.append(input);
  };
  add(fields.building, payload.building);
  add(fields.category, payload.category);
  add(fields.location, payload.location);
  add(fields.note, payload.note);
  add(fields.email, payload.email);
  add("submit", "Submit");
  document.body.append(form);
  form.submit();
  form.remove();
}

async function sendSuggestion(payload) {
  const endpoint = String(siteConfig().suggestionEndpoint || "").trim();
  const email = String(siteConfig().contactEmail || "").trim();
  const fields = siteConfig().suggestionFields;
  if (!endpoint) {
    if (!email) return "unconfigured";
    const lines = [
      `Building: ${payload.building}`,
      `Category: ${payload.category}`,
      `Location: ${payload.location}`,
      payload.note ? `Note: ${payload.note}` : "",
      payload.email ? `From: ${payload.email}` : "",
    ].filter(Boolean);
    window.location.href = `mailto:${email}?subject=${encodeURIComponent("Campus amenity update")}&body=${encodeURIComponent(lines.join("\n"))}`;
    return "mailto";
  }
  if (/docs\.google\.com\/forms/i.test(endpoint)) {
    if (!fields || !fields.building || !fields.category || !fields.location) return "google-unmapped";
    postGoogleForm(endpoint, fields, payload);
    return "google";
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      building: payload.building,
      category: payload.category,
      location: payload.location,
      note: payload.note,
      email: payload.email,
      _subject: "Campus amenity suggestion",
    }),
  });
  if (!response.ok) throw new Error(String(response.status));
  return "sent";
}

function wireSuggestions() {
  const dialog = document.getElementById("suggest-dialog");
  const form = document.getElementById("suggest-form");
  const status = document.getElementById("suggest-status");
  document.getElementById("suggest-open").addEventListener("click", () => {
    status.textContent = "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
  document.getElementById("suggest-cancel").addEventListener("click", () => {
    dialog.close();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      building: document.getElementById("suggest-building").value.trim(),
      category: document.getElementById("suggest-category").value,
      location: document.getElementById("suggest-location").value.trim(),
      note: document.getElementById("suggest-note").value.trim(),
      email: document.getElementById("suggest-email").value.trim(),
    };
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      status.textContent = suggestionStatus(await sendSuggestion(payload));
      if (status.textContent.startsWith("Thanks")) form.reset();
    } catch (error) {
      status.textContent = suggestionStatus("error");
    } finally {
      submit.disabled = false;
    }
  });
}

function renderToggles() {
  const root = document.getElementById("toggles");
  root.replaceChildren();
  for (const category of state.data.categories) {
    state.active.add(category.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toggle";
    button.textContent = category.label;
    button.setAttribute("aria-pressed", "true");
    button.addEventListener("click", () => {
      if (state.active.has(category.id)) state.active.delete(category.id);
      else state.active.add(category.id);
      button.setAttribute("aria-pressed", state.active.has(category.id) ? "true" : "false");
      if (state.selectedId && !matches(byId(state.selectedId))) state.selectedId = null;
      renderList();
      syncMarkers();
    });
    root.append(button);
  }
}

function wireControls() {
  document.getElementById("search").addEventListener("input", (event) => {
    state.query = event.target.value;
    if (state.selectedId && !matches(byId(state.selectedId))) state.selectedId = null;
    renderList();
    syncMarkers();
  });
  document.getElementById("study-only").addEventListener("change", (event) => {
    state.studyOnly = event.target.checked;
    if (state.selectedId && !matches(byId(state.selectedId))) state.selectedId = null;
    renderList();
    syncMarkers();
  });
  document.getElementById("locate").addEventListener("click", locateUser);
  wireSuggestions();
}

function showProblem(error) {
  const box = document.getElementById("load-error");
  box.hidden = false;
  box.textContent = "The map did not load. Refresh the page.";
  console.error(error);
}

function start(data) {
  state.data = data;
  state.map = L.map("map", { scrollWheelZoom: true }).setView([30.6155, -96.3415], 15);
  state.locationLayers = L.layerGroup().addTo(state.map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);
  renderToggles();
  renderTotals();
  wireControls();
  renderList();
  syncMarkers();
  const bounds = data.buildings
    .filter((building) => building.mapped)
    .map((building) => [building.latitude, building.longitude]);
  state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  window.addEventListener("resize", () => state.map.invalidateSize());
  state.map.invalidateSize();
}

fetch("data/campus.json")
  .then((response) => {
    if (!response.ok) throw new Error(`Could not load campus data (${response.status}).`);
    return response.json();
  })
  .then(start)
  .catch(showProblem);
