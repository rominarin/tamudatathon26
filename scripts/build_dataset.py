#!/usr/bin/env python3
"""Turn the team's amenity sheet into a structured dataset and the site JSON.

Inputs (both committed):
  data/amenities_raw.csv          the Google Sheet export, unchanged
  data/building_coordinates.csv   supplementary coordinates from the public
                                  Texas A&M campus GIS, keyed by sheet building

Outputs:
  data/amenities_clean.csv        one row per stated amenity
  data/buildings.csv              one row per sheet building
  site/data/campus.json           the file the static map loads

No third-party packages. Re-run from the repository root:

  python3 scripts/build_dataset.py
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_PATH = ROOT / "data" / "amenities_raw.csv"
COORD_PATH = ROOT / "data" / "building_coordinates.csv"
AMENITY_PATH = ROOT / "data" / "amenities_clean.csv"
BUILDING_PATH = ROOT / "data" / "buildings.csv"
JSON_PATH = ROOT / "site" / "data" / "campus.json"

CATEGORIES = (
    "microwave",
    "snack_vending",
    "drink_vending",
    "lost_and_found",
    "printer",
)

CATEGORY_LABELS = {
    "microwave": "Microwaves",
    "snack_vending": "Snack vending",
    "drink_vending": "Drink vending",
    "lost_and_found": "Lost and found",
    "printer": "Printers",
}

UNCONFIRMED_RE = re.compile(r"not confirmed|unconfirmed|\bprobably\b", re.IGNORECASE)
EXPLICIT_MICROWAVE_RE = re.compile(r"(\d+)\s+microwaves?\b", re.IGNORECASE)
ORDINAL_FLOOR_RE = re.compile(r"\d+(?:st|nd|rd|th)\s+floor", re.IGNORECASE)
FLOOR_LIST_RE = re.compile(
    r"floors?\s+((?:\d+\s*,\s*|\d+\s+and\s+)+\d+)",
    re.IGNORECASE,
)


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def amenity(
    *,
    category: str,
    count: int | None,
    count_confidence: str,
    confirmed: bool,
    include_in_total: bool,
    location_detail: str,
    restrictions: str = "",
    section: str = "",
    raw_text: str,
    parse_notes: str = "",
) -> dict:
    return {
        "category": category,
        "section": section,
        "count": count,
        "count_confidence": count_confidence,
        "confirmed": confirmed,
        "include_in_total": include_in_total,
        "location_detail": clean(location_detail),
        "restrictions": clean(restrictions),
        "raw_text": clean(raw_text),
        "parse_notes": clean(parse_notes),
    }


def parse_microwaves(text: str, restrictions: str) -> list[dict]:
    text = clean(text)
    if not text:
        return []
    restrictions = clean(restrictions)
    if UNCONFIRMED_RE.search(text):
        return [
            amenity(
                category="microwave",
                count=1,
                count_confidence="unconfirmed",
                confirmed=False,
                include_in_total=False,
                location_detail=text,
                restrictions=restrictions,
                raw_text=text,
                parse_notes="The cell says this is not confirmed, so it is not included in campus totals.",
            )
        ]
    explicit = EXPLICIT_MICROWAVE_RE.search(text)
    if explicit:
        return [
            amenity(
                category="microwave",
                count=int(explicit.group(1)),
                count_confidence="explicit",
                confirmed=True,
                include_in_total=True,
                location_detail=text,
                restrictions=restrictions,
                raw_text=text,
            )
        ]
    if re.search(r"\bvarious places\b", text, re.IGNORECASE):
        return [
            amenity(
                category="microwave",
                count=None,
                count_confidence="unspecified",
                confirmed=True,
                include_in_total=False,
                location_detail=text,
                restrictions=restrictions,
                raw_text=text,
                parse_notes="Microwaves are mentioned, but no number or list of places is given, so nothing was added to the campus total.",
            )
        ]
    if re.search(r"\byes\b", text, re.IGNORECASE):
        return [
            amenity(
                category="microwave",
                count=1,
                count_confidence="presence_only",
                confirmed=True,
                include_in_total=True,
                location_detail=text,
                restrictions=restrictions,
                raw_text=text,
                parse_notes="The cell says yes rather than a number, so this is counted as 1.",
            )
        ]
    if ";" in text:
        parts = [clean(part) for part in text.split(";") if clean(part)]
        records = []
        for part in parts:
            note = "No number was stated, so each listed place is counted as 1."
            if re.search(r"not given|exact spot", part, re.IGNORECASE):
                note += " The sheet says the exact spot was not given; the microwave is still treated as stated."
            records.append(
                amenity(
                    category="microwave",
                    count=1,
                    count_confidence="inferred_from_locations",
                    confirmed=True,
                    include_in_total=True,
                    location_detail=part,
                    restrictions=restrictions,
                    raw_text=text,
                    parse_notes=note,
                )
            )
        return records
    floor_list = FLOOR_LIST_RE.fullmatch(text)
    if floor_list:
        floors = re.findall(r"\d+", floor_list.group(1))
        return [
            amenity(
                category="microwave",
                count=len(floors),
                count_confidence="inferred_from_locations",
                confirmed=True,
                include_in_total=True,
                location_detail=text,
                restrictions=restrictions,
                raw_text=text,
                parse_notes="No number of machines was stated, so this is one microwave per named floor.",
            )
        ]
    floors = list(ORDINAL_FLOOR_RE.finditer(text))
    if len(floors) >= 2:
        records = []
        for index, match in enumerate(floors):
            end = floors[index + 1].start() if index + 1 < len(floors) else len(text)
            records.append(
                amenity(
                    category="microwave",
                    count=1,
                    count_confidence="inferred_from_locations",
                    confirmed=True,
                    include_in_total=True,
                    location_detail=text[match.start() : end].strip(" ,;."),
                    restrictions=restrictions,
                    raw_text=text,
                    parse_notes="No number was stated, so each named floor is counted as 1.",
                )
            )
        return records
    return [
        amenity(
            category="microwave",
            count=1,
            count_confidence="inferred_from_locations",
            confirmed=True,
            include_in_total=True,
            location_detail=text,
            restrictions=restrictions,
            raw_text=text,
            parse_notes="A place is described but no number is given, so this is counted as 1.",
        )
    ]


def parse_vending_piece(text: str, category: str, raw_text: str) -> dict:
    text = clean(text)
    leading = re.match(r"^(\d+)\s+(.+)$", text)
    if leading and not re.match(r"^\d+(?:st|nd|rd|th)\b", text, re.IGNORECASE):
        detail = re.sub(r"^on\s+", "", leading.group(2), flags=re.IGNORECASE)
        if re.fullmatch(r"(?:snack|drink)\s+machines?", detail, re.IGNORECASE):
            detail = "Location not stated"
        return amenity(
            category=category,
            count=int(leading.group(1)),
            count_confidence="explicit",
            confirmed=True,
            include_in_total=True,
            location_detail=detail,
            raw_text=raw_text,
        )
    if re.fullmatch(
        r"(?:on\s+)?(?:the\s+)?(?:floor\s+)?\d+(?:st|nd|rd|th)?(?:\s+floor)?",
        text,
        re.IGNORECASE,
    ):
        return amenity(
            category=category,
            count=1,
            count_confidence="inferred_from_locations",
            confirmed=True,
            include_in_total=True,
            location_detail=text,
            raw_text=raw_text,
            parse_notes="Only a floor is stated, so this is counted as 1.",
        )
    return amenity(
        category=category,
        count=1,
        count_confidence="inferred_from_locations",
        confirmed=True,
        include_in_total=True,
        location_detail=text,
        raw_text=raw_text,
        parse_notes="No number was stated, so this is counted as 1.",
    )


def parse_vending(text: str, category: str) -> list[dict]:
    text = clean(text)
    if not text or re.match(r"none\b", text, re.IGNORECASE):
        return []
    if UNCONFIRMED_RE.search(text):
        return [
            amenity(
                category=category,
                count=1,
                count_confidence="unconfirmed",
                confirmed=False,
                include_in_total=False,
                location_detail=text,
                raw_text=text,
                parse_notes="The cell says this is not confirmed, so it is not included in campus totals.",
            )
        ]
    if re.fullmatch(r"yes\.?", text, re.IGNORECASE):
        return [
            amenity(
                category=category,
                count=1,
                count_confidence="presence_only",
                confirmed=True,
                include_in_total=True,
                location_detail="Yes, no location or number given",
                raw_text=text,
                parse_notes="The cell says yes rather than a number, so this is counted as 1.",
            )
        ]
    pieces = [clean(part) for part in text.split(";") if clean(part)]
    return [parse_vending_piece(part, category, text) for part in pieces]


def parse_lost_and_found(text: str) -> list[dict]:
    text = clean(text)
    if not text:
        return []
    parts = [clean(part) for part in re.split(r"(?<=\.)\s+Also\s+", text, flags=re.IGNORECASE) if clean(part)]
    note = (
        "More than one place is described and no number is given, so each place is counted as 1."
        if len(parts) > 1
        else "A place is described but no number is given, so this is counted as 1."
    )
    return [
        amenity(
            category="lost_and_found",
            count=1,
            count_confidence="inferred_from_locations",
            confirmed=True,
            include_in_total=True,
            location_detail=part,
            raw_text=text,
            parse_notes=note,
        )
        for part in parts
    ]


def parse_printers(text: str) -> list[dict]:
    text = clean(text)
    if not text:
        return []
    records: list[dict] = []
    for section in [clean(part) for part in re.split(r"\s+\|\s+", text) if clean(part)]:
        label = ""
        body = section
        label_match = re.match(r"^(?P<label>[^:\d][^:]{0,140}?):\s*(?P<body>.+)$", section)
        if label_match:
            label = clean(label_match.group("label").strip(" -"))
            body = clean(label_match.group("body"))
        overlap = bool(re.search(r"oal list", label, re.IGNORECASE))
        total_match = re.match(r"^(\d+)\s+printers?\s*:\s*(.+)$", body, re.IGNORECASE)
        if total_match:
            rest = total_match.group(2)
            restriction = ""
            needs = re.search(r"\b(Needs\b.*)$", rest, re.IGNORECASE)
            if needs:
                restriction = clean(needs.group(1)).strip(".")
                rest = clean(rest[: needs.start()])
            locations = [clean(part).strip(".") for part in rest.split(";") if clean(part)]
            records.append(
                amenity(
                    category="printer",
                    count=int(total_match.group(1)),
                    count_confidence="explicit",
                    confirmed=True,
                    include_in_total=not overlap,
                    location_detail="; ".join(locations),
                    restrictions=restriction,
                    section=label,
                    raw_text=text,
                    parse_notes=(
                        "The cell gives this total and then names the places, so the places were not counted again."
                        if not overlap
                        else "This official-list line was not added on top of the printer total already stated in the same cell."
                    ),
                )
            )
            continue
        restrictions = []
        parsed = []
        for item in [clean(part) for part in body.split(";") if clean(part)]:
            item = item.strip(" *")
            if re.match(r"^(Needs|Requires|Must)\b", item, re.IGNORECASE) or (
                "allocation" in item.lower() and not re.match(r"^\d+\s", item)
            ):
                restrictions.append(item.strip("."))
                continue
            count_match = re.match(r"^(\d+)\s+(.+)$", item)
            if count_match and not re.match(r"^\d+(?:st|nd|rd|th)\b", item, re.IGNORECASE):
                parsed.append(
                    amenity(
                        category="printer",
                        count=int(count_match.group(1)),
                        count_confidence="explicit",
                        confirmed=True,
                        include_in_total=not overlap,
                        location_detail=count_match.group(2).strip(" *"),
                        section=label,
                        raw_text=text,
                        parse_notes=(
                            "Listed on a TAMU OAL line in the same cell as a separate printer total, so it was not added again."
                            if overlap
                            else ""
                        ),
                    )
                )
            else:
                parsed.append(
                    amenity(
                        category="printer",
                        count=1,
                        count_confidence="inferred_from_locations",
                        confirmed=True,
                        include_in_total=not overlap,
                        location_detail=item,
                        section=label,
                        raw_text=text,
                        parse_notes="No number was stated, so this listed place is counted as 1.",
                    )
                )
        for record in parsed:
            if restrictions:
                record["restrictions"] = " ".join(restrictions)
            records.append(record)
    return records


def other_mentions(row: dict[str, str]) -> list[str]:
    mentions = []
    food = clean(row.get("Food Vending"))
    chargers = clean(row.get("Chargers / Lab Equipment"))
    notes = clean(row.get("Notes"))
    if re.match(r"none\b", food, re.IGNORECASE):
        mentions.append(
            f"Food vending cell: {food} No snack vending machine was counted."
        )
    if chargers:
        mentions.append(
            "Chargers / lab equipment cell: "
            f"{chargers} This was not counted as a microwave, printer, lost and found, or snack or drink machine."
        )
    if notes:
        repeated_marketplace = "marketplace" in notes.lower() and any(
            "marketplace" in mention.lower() for mention in mentions
        )
        if not repeated_marketplace:
            suffix = ""
            if re.search(r"bagel|marketplace|food spot|retail store", notes, re.IGNORECASE):
                suffix = " Not counted as a vending machine."
            mentions.append(f"Notes: {notes}.{suffix}" if suffix else f"Notes: {notes}")
    return mentions


def study_friendly(value: str) -> str:
    text = clean(value).lower()
    if text == "yes":
        return "yes"
    if text == "no":
        return "no"
    if text in {"not really", "not_really"}:
        return "not_really"
    if not text:
        return "unknown"
    return "unknown"


def parse_row(row: dict[str, str]) -> list[dict]:
    records = []
    records.extend(
        parse_microwaves(row.get("Microwave / Location", ""), row.get("Microwave Restrictions", ""))
    )
    records.extend(parse_vending(row.get("Food Vending", ""), "snack_vending"))
    records.extend(parse_vending(row.get("Drink Vending", ""), "drink_vending"))
    records.extend(parse_lost_and_found(row.get("Lost and Found Location", "")))
    records.extend(parse_printers(row.get("Printer Location", "")))
    return records


def counted(records: list[dict], category: str) -> int:
    return sum(
        record["count"] or 0
        for record in records
        if record["category"] == category and record["include_in_total"]
    )


def parse_workbook(rows: list[dict[str, str]], coordinates: list[dict[str, str]]) -> dict:
    by_name = {coord["sheet_building"]: coord for coord in coordinates}
    missing = [row["Building"] for row in rows if row["Building"] not in by_name]
    extra = [coord["sheet_building"] for coord in coordinates if coord["sheet_building"] not in {row["Building"] for row in rows}]
    if missing or extra:
        raise SystemExit(f"Coordinate table does not match the sheet. Missing {missing}. Extra {extra}.")

    buildings = []
    amenity_rows = []
    for row in rows:
        coord = by_name[row["Building"]]
        building_id = clean(row["Abbrev"]).lower()
        if not building_id:
            building_id = re.sub(r"[^a-z0-9]+", "-", clean(row["Building"]).lower()).strip("-") or "building"
        records = parse_row(row)
        for index, record in enumerate(records, start=1):
            record["amenity_id"] = f"{building_id}-{record['category']}-{index}"
            record["building_id"] = building_id
            record["building_name"] = row["Building"]
            record["sheet_abbrev"] = row["Abbrev"]
            amenity_rows.append(record)
        lat = coord.get("latitude") or ""
        lon = coord.get("longitude") or ""
        mapped = bool(lat and lon)
        buildings.append(
            {
                "building_id": building_id,
                "building_name": row["Building"],
                "sheet_abbrev": row["Abbrev"],
                "official_name": coord.get("official_name", ""),
                "official_abbrev": coord.get("official_abbrev", ""),
                "gis_building_number": coord.get("gis_building_number", ""),
                "address": coord.get("address", ""),
                "latitude": float(lat) if mapped else None,
                "longitude": float(lon) if mapped else None,
                "mapped": mapped,
                "coordinate_method": coord.get("coordinate_method", ""),
                "coordinate_source": coord.get("coordinate_source", ""),
                "source_url": coord.get("source_url", ""),
                "retrieved_on": coord.get("retrieved_on", ""),
                "geocode_notes": coord.get("geocode_notes", ""),
                "study_friendly": study_friendly(row.get("Study Friendly Level", "")),
                "study_friendly_raw": clean(row.get("Study Friendly Level", "")),
                "sheet_notes": clean(row.get("Notes", "")),
                "other_mentions": other_mentions(row),
                "amenities": records,
                "counts": {category: counted(records, category) for category in CATEGORIES},
            }
        )
    return {"buildings": buildings, "amenities": amenity_rows}


def campus_totals(buildings: list[dict]) -> dict:
    totals = {}
    for category in CATEGORIES:
        counted_sum = 0
        unconfirmed = 0
        unspecified = []
        counted_buildings = []
        for building in buildings:
            records = [item for item in building["amenities"] if item["category"] == category]
            if any(item["include_in_total"] for item in records):
                counted_buildings.append(building["building_name"])
                counted_sum += building["counts"][category]
            unconfirmed += sum(
                item["count"] or 0
                for item in records
                if item["count_confidence"] == "unconfirmed"
            )
            if any(item["count_confidence"] == "unspecified" for item in records):
                unspecified.append(building["building_name"])
        totals[category] = {
            "counted": counted_sum,
            "buildings_with_counted": counted_buildings,
            "unconfirmed": unconfirmed,
            "unspecified_buildings": unspecified,
        }
    return totals


def total_notes(buildings: list[dict]) -> list[str]:
    notes = []
    for building in buildings:
        for item in building["amenities"]:
            if item["count_confidence"] == "unspecified":
                notes.append(
                    f"{building['building_name']} mentions {CATEGORY_LABELS[item['category']].lower()}, but the sheet gives no number, so that row is not in the campus total."
                )
            elif item["count_confidence"] == "unconfirmed":
                notes.append(
                    f"{building['building_name']} is not in the {CATEGORY_LABELS[item['category']].lower()} total: \"{item['raw_text']}\"."
                )
            elif item["confirmed"] and not item["include_in_total"] and item["count"]:
                notes.append(
                    f"{building['building_name']}: {item['count']} {CATEGORY_LABELS[item['category']].lower()} listed but not added. {item['parse_notes']}"
                )
    return notes


def write_amenities(path: Path, amenities: list[dict]) -> None:
    fields = [
        "amenity_id",
        "building_id",
        "building_name",
        "sheet_abbrev",
        "category",
        "section",
        "count",
        "count_confidence",
        "confirmed",
        "include_in_total",
        "location_detail",
        "restrictions",
        "raw_text",
        "parse_notes",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for record in amenities:
            row = dict(record)
            row["count"] = "" if record["count"] is None else record["count"]
            row["confirmed"] = "true" if record["confirmed"] else "false"
            row["include_in_total"] = "true" if record["include_in_total"] else "false"
            writer.writerow(row)


def write_buildings(path: Path, buildings: list[dict]) -> None:
    fields = [
        "building_id",
        "building_name",
        "sheet_abbrev",
        "official_name",
        "official_abbrev",
        "gis_building_number",
        "address",
        "latitude",
        "longitude",
        "mapped",
        "coordinate_method",
        "coordinate_source",
        "source_url",
        "retrieved_on",
        "geocode_notes",
        "study_friendly",
        "study_friendly_raw",
        "sheet_notes",
        "other_mentions",
        "microwave_count",
        "snack_vending_count",
        "drink_vending_count",
        "lost_and_found_count",
        "printer_count",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for building in buildings:
            writer.writerow(
                {
                    "building_id": building["building_id"],
                    "building_name": building["building_name"],
                    "sheet_abbrev": building["sheet_abbrev"],
                    "official_name": building["official_name"],
                    "official_abbrev": building["official_abbrev"],
                    "gis_building_number": building["gis_building_number"],
                    "address": building["address"],
                    "latitude": "" if building["latitude"] is None else f"{building['latitude']:.6f}",
                    "longitude": "" if building["longitude"] is None else f"{building['longitude']:.6f}",
                    "mapped": "true" if building["mapped"] else "false",
                    "coordinate_method": building["coordinate_method"],
                    "coordinate_source": building["coordinate_source"],
                    "source_url": building["source_url"],
                    "retrieved_on": building["retrieved_on"],
                    "geocode_notes": building["geocode_notes"],
                    "study_friendly": building["study_friendly"],
                    "study_friendly_raw": building["study_friendly_raw"],
                    "sheet_notes": building["sheet_notes"],
                    "other_mentions": " | ".join(building["other_mentions"]),
                    "microwave_count": building["counts"]["microwave"],
                    "snack_vending_count": building["counts"]["snack_vending"],
                    "drink_vending_count": building["counts"]["drink_vending"],
                    "lost_and_found_count": building["counts"]["lost_and_found"],
                    "printer_count": building["counts"]["printer"],
                }
            )


def write_json(path: Path, buildings: list[dict], totals: dict, notes: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "title": "Texas A&M campus amenities",
        "coordinate_note": (
            "Building coordinates are supplementary. They come from the public "
            "Texas A&M Facilities Coordination GIS (University Building layer, "
            "service FCOR/TAMU_BaseMap_060826), retrieved 2026-11-08. "
            "The team did not collect coordinates."
        ),
        "source_url": "https://gis.tamu.edu/arcgis/rest/services/FCOR/TAMU_BaseMap_060826/MapServer/2",
        "retrieved_on": "2026-11-08",
        "categories": [
            {"id": category, "label": CATEGORY_LABELS[category]} for category in CATEGORIES
        ],
        "totals": totals,
        "total_notes": notes,
        "buildings": buildings,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build() -> dict:
    rows = load_csv(RAW_PATH)
    coordinates = load_csv(COORD_PATH)
    parsed = parse_workbook(rows, coordinates)
    totals = campus_totals(parsed["buildings"])
    notes = total_notes(parsed["buildings"])
    write_amenities(AMENITY_PATH, parsed["amenities"])
    write_buildings(BUILDING_PATH, parsed["buildings"])
    write_json(JSON_PATH, parsed["buildings"], totals, notes)
    return {"buildings": parsed["buildings"], "amenities": parsed["amenities"], "totals": totals, "notes": notes}


def main() -> None:
    result = build()
    print(f"buildings: {len(result['buildings'])}")
    print(f"amenity rows: {len(result['amenities'])}")
    for category, total in result["totals"].items():
        print(
            f"{category}: counted={total['counted']} "
            f"buildings={len(total['buildings_with_counted'])} "
            f"unconfirmed={total['unconfirmed']} "
            f"unspecified={total['unspecified_buildings']}"
        )
    for building in result["buildings"]:
        if not building["mapped"]:
            print(f"UNMAPPED: {building['building_name']}")
    for note in result["notes"]:
        print(f"NOTE: {note}")


if __name__ == "__main__":
    main()
