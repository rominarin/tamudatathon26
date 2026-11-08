# Data dictionary

Coordinates in `data/building_coordinates.csv`, `data/buildings.csv`, and `site/data/campus.json` are supplementary. They come from the public Texas A&M Facilities Coordination GIS (University Building layer, service `FCOR/TAMU_BaseMap_060826`), retrieved 2026-11-08. The team did not survey coordinates. See the methodology in the README.

## `data/amenities_raw.csv`

The Google Sheet export. One row is one building. Cells are the original free text. This file is the input to `scripts/build_dataset.py` and is not rewritten by it.

| Field | Meaning |
| --- | --- |
| Building | Name the team wrote for the building |
| Abbrev | Abbreviation the team wrote. It is not always the official campus code |
| Microwave / Location | Free text about microwaves. Blank means none recorded |
| Microwave Restrictions | Who can use the microwave, when the team wrote that down. Applies to the microwave cell on the same row |
| Printer Location | Free text about printers. Several rooms are often separated by semicolons. A `\|` separates a second list, such as an annex or an official print list |
| Lost and Found Location | Free text about where lost items are taken |
| Food Vending | Snack machines. “None” means the team said there is no snack machine. A marketplace or food counter in this cell is not a vending machine |
| Drink Vending | Drink machines, separate from snack machines |
| Chargers / Lab Equipment | Other notes the team put in this column, including a retail store and a tech vending machine. Not one of the five mapped categories |
| Study Friendly Level | The team’s label: `Yes`, `No`, `Not Really`, or blank |
| Notes | Extra free text, such as Bagel Block |

## `data/building_coordinates.csv`

One row per sheet building. Join key is `sheet_building`, which matches `Building` in the raw file. Blank latitude and longitude mean the building was not placed on the map.

| Field | Meaning |
| --- | --- |
| sheet_building | Building name copied from the sheet |
| sheet_abbrev | Abbreviation copied from the sheet |
| official_name | Name on the TAMU GIS building that was matched. Blank if unresolved |
| official_abbrev | Abbreviation on that GIS building. May differ from `sheet_abbrev` |
| gis_building_number | Building number on the GIS layer |
| address | Street address on the GIS layer |
| latitude | WGS84 latitude of the GIS point, or the footprint centroid when the point attribute was empty. Blank if unresolved |
| longitude | WGS84 longitude, same rules as latitude |
| coordinate_method | `gis_point` (the layer’s latitude/longitude), `footprint_centroid` (centroid of the GIS polygon because the point was empty), or `unresolved` |
| coordinate_source | Human-readable source name. This is external campus data, not the team sheet |
| source_url | Map service that was queried |
| retrieved_on | Date the layer was queried, `YYYY-MM-DD` |
| geocode_notes | Why this GIS building was chosen, or why the row was left unplaced |

## `data/buildings.csv`

One row per sheet building, produced by the script. Counts include only amenity rows with `include_in_total = true`.

| Field | Meaning |
| --- | --- |
| building_id | Lowercase sheet abbreviation. Stable id used by the map |
| building_name | Sheet building name |
| sheet_abbrev | Abbreviation from the sheet |
| official_name | From the coordinate table |
| official_abbrev | From the coordinate table |
| gis_building_number | From the coordinate table |
| address | From the coordinate table |
| latitude | Decimal degrees, six places, or blank |
| longitude | Decimal degrees, six places, or blank |
| mapped | `true` if latitude and longitude are present |
| coordinate_method | Same values as the coordinate table |
| coordinate_source | Same text as the coordinate table |
| source_url | Same URL as the coordinate table |
| retrieved_on | Same date as the coordinate table |
| geocode_notes | Same note as the coordinate table |
| study_friendly | Normalized sheet label: `yes`, `no`, `not_really`, or `unknown` (blank or unrecognized) |
| study_friendly_raw | The sheet cell before normalization |
| sheet_notes | The Notes cell, whitespace collapsed. Does not include every side comment; those are in `other_mentions` |
| other_mentions | Notes that are not one of the five categories, separated by ` \| `. Retail stores, a marketplace, a food counter, and a tech vending machine live here |
| microwave_count | Microwaves included in the campus total |
| snack_vending_count | Snack machines included in the campus total |
| drink_vending_count | Drink machines included in the campus total |
| lost_and_found_count | Lost and found places included in the campus total |
| printer_count | Printers included in the campus total |

## `data/amenities_clean.csv`

One row per amenity the parser kept. A building can have several rows in one category when the sheet listed several places. Rows with `include_in_total = false` are still in the file so an unconfirmed note or a possible duplicate is not thrown away.

| Field | Meaning |
| --- | --- |
| amenity_id | `{building_id}-{category}-{n}` within that building and category |
| building_id | Matches `buildings.csv` |
| building_name | Sheet building name |
| sheet_abbrev | Sheet abbreviation |
| category | One of `microwave`, `snack_vending`, `drink_vending`, `lost_and_found`, `printer` |
| section | A label from the same cell when the sheet split a list with a colon, such as `Evans Library Annex - Part of Evans Library` or `TAMU OAL list`. Blank if the cell had no section label |
| count | Integer machines or places, or blank when the sheet gave no number (`unspecified`) |
| count_confidence | How `count` was chosen. Values below |
| confirmed | `true` or `false`. `false` only for unconfirmed wording |
| include_in_total | `true` or `false`. Campus totals and the count columns add only `true` rows |
| location_detail | Floor, room, or the phrase that was left after the number was read |
| restrictions | Access limit copied from the sheet, such as a printer allocation or a microwave limited to certain students. Blank if none was written |
| raw_text | The whole source cell, whitespace collapsed |
| parse_notes | Why the count was inferred, left out, or not added on top of another number in the same cell |

### `count_confidence`

| Value | Meaning |
| --- | --- |
| explicit | The cell states a number |
| presence_only | The cell says yes and does not state a number. Counted as 1 |
| inferred_from_locations | No number. Counted as 1 for each place or floor the cell actually lists |
| unspecified | Something is mentioned, but there is no number and no list of places. `count` is blank and the row is not in the total |
| unconfirmed | Wording such as “probably” or “not confirmed”. Stored, not included in the total |

## `site/data/campus.json`

The file the map fetches. It is the buildings, nested amenities, and campus totals from the same script run.

| Field | Meaning |
| --- | --- |
| title | Map title |
| coordinate_note | Statement that coordinates are external campus GIS data |
| source_url | GIS service URL |
| retrieved_on | Date the GIS layer was queried |
| categories | `{id, label}` for the five categories, in display order |
| totals | One object per category id |
| totals.\*.counted | Sum of `count` where `include_in_total` is true |
| totals.\*.buildings_with_counted | Sheet names of buildings that contribute to `counted` |
| totals.\*.unconfirmed | Sum of counts on `unconfirmed` rows. Not part of `counted` |
| totals.\*.unspecified_buildings | Sheet names with an `unspecified` row in that category |
| total_notes | Sentences for anything deliberately left out of `counted` |
| buildings | Same fields as `buildings.csv`, with `latitude` and `longitude` as numbers or `null`, `mapped` as a boolean, `other_mentions` as an array, and `counts` as an object keyed by category id |
| buildings.\*.amenities | The amenity rows for that building. `count` is a number or `null`. `confirmed` and `include_in_total` are booleans |

## Category ids

| Id | Sheet column | What it is |
| --- | --- | --- |
| microwave | Microwave / Location | Microwaves |
| snack_vending | Food Vending | Snack vending machines only |
| drink_vending | Drink Vending | Drink vending machines only |
| lost_and_found | Lost and Found Location | Lost and found desks or spots |
| printer | Printer Location | Printers, including a plotter when the sheet calls it a printer |

A marketplace, a food counter, a retail tech store, and a tech vending machine are not given a category id. They remain in `other_mentions`.
