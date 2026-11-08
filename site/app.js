/* Texas A&M campus amenity map. Data is site/data/campus.json, built by scripts/build_dataset.py. */

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
  explicit: "Number stated in the sheet",
  presence_only: "Sheet says yes, counted as 1",
  inferred_from_locations: "No number stated, counted as 1 per place listed",
  unspecified: "Mentioned, but no number to add",
  unconfirmed: "Sheet says this is not confirmed",
};

const STUDY = {
  yes: "Yes",
  no: "No",
  not_really: "Not really",
  unknown: "Not recorded",
};

const PIN = {
  counted: { color: "#fffdfb", weight: 2, fillColor: "#500000", fillOpacity: 0.95, radius: 8 },
  unconfirmed: { color: "#fffdfb", weight: 2, fillColor: "#8d5c10", fillOpacity: 0.95, radius: 8 },
  empty: { color: "#fffdfb", weight: 2, fillColor: "#8d827b", fillOpacity: 0.92, radius: 7 },
};

const state = {
  data: null,
  active: new Set(),
  studyOnly: false,
  query: "",
  selectedId: null,
  markers: new Map(),
  userMarker: null,
  map: null,
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

function usableForNearest(item) {
  return item.confirmed && (item.include_in_total || item.count_confidence === "unspecified");
}

function nearestBuilding(latitude, longitude, category) {
  let best = null;
  for (const building of state.data.buildings) {
    if (!building.mapped) continue;
    if (!building.amenities.some((item) => item.category === category && usableForNearest(item))) continue;
    const meters = haversine(latitude, longitude, building.latitude, building.longitude);
    if (!best || meters < best.meters) best = { building, meters };
  }
  return best;
}

function popupHtml(building) {
  const address = building.address ? ` · ${escapeHtml(building.address)}` : "";
  const official = building.official_abbrev && building.official_abbrev !== building.sheet_abbrev
    ? `Official code ${escapeHtml(building.official_abbrev)}. `
    : "";
  let html = `<div class="popup"><h2>${escapeHtml(building.building_name)}</h2>`;
  html += `<p class="meta">${escapeHtml(building.sheet_abbrev)}${address}<br>${official}Study friendly: ${escapeHtml(STUDY[building.study_friendly] || "Not recorded")}</p>`;

  if (!building.amenities.length) {
    html += "<p>No microwaves, snack machines, drink machines, printers, or lost and found were recorded for this building.</p>";
  }

  for (const category of state.data.categories) {
    const items = building.amenities.filter((item) => item.category === category.id);
    if (!items.length) continue;
    const counted = building.counts[category.id];
    html += `<h3>${escapeHtml(category.label)}${counted ? ` · ${counted}` : ""}</h3>`;
    for (const item of items) {
      const countText = item.count == null ? "Number not stated" : String(item.count);
      const place = item.location_detail ? escapeHtml(item.location_detail) : "Location not stated";
      const section = item.section ? `<span class="confidence">${escapeHtml(item.section)}</span><br>` : "";
      html += `<p class="item">${section}<span class="count">${escapeHtml(countText)}</span> — ${place}`;
      if (item.restrictions) html += `<br><span class="restriction">Restriction: ${escapeHtml(item.restrictions)}</span>`;
      const confidence = CONFIDENCE[item.count_confidence] || item.count_confidence;
      html += `<br><span class="confidence">${escapeHtml(confidence)}</span>`;
      if (!item.include_in_total && item.parse_notes) {
        html += `<br><span class="confidence">${escapeHtml(item.parse_notes)}</span>`;
      }
      html += "</p>";
    }
  }

  if (building.other_mentions.length) {
    html += `<div class="other"><h3>Written down, not counted in the five categories</h3>`;
    for (const mention of building.other_mentions) html += `<p class="item">${escapeHtml(mention)}</p>`;
    html += "</div>";
  }

  const pinSummary = building.mapped ? "Where this pin comes from" : "Why this building is not on the map";
  html += `<details><summary>${pinSummary}</summary><p class="geo">${escapeHtml(building.geocode_notes)} ${escapeHtml(state.data.coordinate_note)}</p></details>`;
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
    if (item.count_confidence === "unspecified") flags.push(`${noun(item.category, 2)} mentioned, number not stated`);
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
    label.textContent = category.label;
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
    item.textContent = note;
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
  const mapped = buildings.filter((building) => building.mapped).length;
  const totalMapped = state.data.buildings.filter((building) => building.mapped).length;
  document.getElementById("showing").textContent = buildings.length
    ? `Showing ${buildings.length} of ${state.data.buildings.length} buildings in the sheet (${mapped} of ${totalMapped} mapped).`
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
    const line = parts.length ? parts.join(" · ") : "Nothing counted in the five categories";
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

function renderToggles() {
  const root = document.getElementById("toggles");
  const select = document.getElementById("nearest-category");
  root.replaceChildren();
  select.replaceChildren();
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
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.label;
    select.append(option);
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
  document.getElementById("locate").addEventListener("click", () => {
    const result = document.getElementById("nearest-result");
    if (!navigator.geolocation) {
      result.textContent = "This browser does not share a location. Search still works.";
      return;
    }
    result.textContent = "Asking for your location…";
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      if (state.userMarker) state.userMarker.remove();
      state.userMarker = L.circleMarker([latitude, longitude], {
        radius: 7,
        color: "#1f4e79",
        weight: 2,
        fillColor: "#7eb6e0",
        fillOpacity: 0.95,
      }).addTo(state.map).bindTooltip("You");
      const category = document.getElementById("nearest-category").value;
      state.studyOnly = false;
      document.getElementById("study-only").checked = false;
      state.active.add(category);
      document.querySelectorAll(".toggle").forEach((button) => {
        const match = state.data.categories.find((item) => item.label === button.textContent);
        if (match) button.setAttribute("aria-pressed", state.active.has(match.id) ? "true" : "false");
      });
      const label = state.data.categories.find((item) => item.id === category).label.toLowerCase();
      const found = nearestBuilding(latitude, longitude, category);
      const skipped = state.data.buildings
        .filter((building) => !building.mapped && building.amenities.some((item) => item.category === category && usableForNearest(item)))
        .map((building) => building.building_name);
      if (!found) {
        result.textContent = `No mapped building has confirmed ${label}.`;
        return;
      }
      const meters = Math.round(found.meters);
      const distance = meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(2)} km`;
      let text = `${found.building.building_name} is the closest mapped building with ${label}, about ${distance} in a straight line, not a walking route.`;
      const vague = found.building.amenities.some((item) => item.category === category && item.count_confidence === "unspecified");
      if (vague) text += " The sheet does not say how many.";
      if (skipped.length) text += ` Skipped because they are not on the map: ${skipped.join(", ")}.`;
      result.textContent = text;
      select(found.building.building_id, true);
    }, (error) => {
      result.textContent = error.code === 1
        ? "Location permission was denied. Search still works without it."
        : "The browser could not determine a location.";
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

function showProblem(error) {
  const box = document.getElementById("load-error");
  box.hidden = false;
  box.textContent = error && (error.stack || error.message) ? (error.stack || error.message) : String(error);
}

function start(data) {
  state.data = data;
  state.map = L.map("map", { scrollWheelZoom: true }).setView([30.6155, -96.3415], 15);
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
