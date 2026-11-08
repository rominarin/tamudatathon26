# Texas A&M campus amenities

A static map of microwaves, snack vending machines, drink vending machines, lost and founds, and printers in Texas A&M buildings. The team wrote the notes by hand during TAMU Datathon 2026 (Build Your Own Dataset). This repository turns that sheet into a dataset and a map that can be hosted on GitHub Pages. There is no server.

The map is a sample of buildings, not a directory of the whole campus.

## Run it locally

Python 3 is enough. No extra packages.

```bash
python3 -m http.server 8000 -d site
```

Open http://localhost:8000.

Opening `site/index.html` as a file will not load the data. The page fetches `site/data/campus.json`.

Rebuild the dataset after editing the sheet or the coordinate table:

```bash
python3 scripts/build_dataset.py
python3 scripts/test_dataset.py
```

## What’s in the repo

| Path | Role |
| --- | --- |
| `data/amenities_raw.csv` | The Google Sheet export, unchanged |
| `data/building_coordinates.csv` | Latitude and longitude from the public campus GIS. Not collected by the team |
| `data/amenities_clean.csv` | One row per amenity the parser kept |
| `data/buildings.csv` | One row per building, including counts |
| `site/` | The map. GitHub Pages publishes this folder, including `site/CNAME` |
| `scripts/build_dataset.py` | Rebuilds the clean files and `site/data/campus.json` |
| `DATA_DICTIONARY.md` | Every field |

## Deploy to GitHub Pages

The workflow is `.github/workflows/pages.yml`. It publishes the `site` directory when `main` changes, and it can also be started by hand from the Actions tab.

After this pull request is merged, turn Pages on with these clicks:

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**. Do not choose “Deploy from a branch” unless you drop the workflow. The workflow is what uploads `site/`.
4. If Actions are disabled, go to **Settings → Actions → General** and allow actions for this repository.
5. Merge the pull request into `main`. The workflow **Deploy to GitHub Pages** should run. If GitHub asks you to approve the `github-pages` environment, that approval is the remaining click.
6. When the workflow is green, the default Pages URL is `https://rominarin.github.io/tamudatathon26/`. After DNS for the custom domain is in place, the same site is at `https://tamueats.us/`.

To publish again without another commit, open **Actions → Deploy to GitHub Pages → Run workflow**.

### Custom domain

The custom domain is `tamueats.us`. `site/CNAME` contains only that name. The Pages workflow uploads the whole `site` directory, so that file is `CNAME` at the root of the published site. Styles, scripts, Leaflet, and `data/campus.json` use relative URLs, so they load from `https://tamueats.us/` rather than from a `/tamudatathon26/` path.

Pages source is already **GitHub Actions**. After this change is on `main`:

1. Open **Settings → Pages**.
2. Under **Custom domain**, enter `tamueats.us` and click **Save**.
3. At the registrar, remove any old apex records that point somewhere else, then add these records. The name is the apex (`@` or a blank name, depending on the host).

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |

Optional: a `CNAME` record named `www` whose value is `rominarin.github.io` (no repository name, and not `tamueats.us`). GitHub Pages will redirect `www.tamueats.us` to `https://tamueats.us/`.

4. When the apex resolves to those addresses, return to **Settings → Pages** and turn on **Enforce HTTPS**. The checkbox can stay unavailable for up to 24 hours after DNS starts pointing at GitHub.

## Suggest an update

The map has a **Suggest an update** button. With `suggestionEndpoint` left empty in `site/config.js`, Send shows a thank-you and does not store the suggestion anywhere. It does not open an email app, and it does not change the map.

Submissions are reviewed manually before anything is added to the map. A suggestion does not change the map on its own. If you later paste an endpoint into `suggestionEndpoint`, Send posts the form and shows the thank-you only after that post succeeds. A failed post shows an error instead.

To receive submissions with Formspree:

1. Create a form at [formspree.io](https://formspree.io) with fields named `building`, `category`, `location`, `note`, and `email`. Do not change those names.
2. Copy the form endpoint, which looks like `https://formspree.io/f/abcdwxyz`.
3. Paste it into `suggestionEndpoint` in `site/config.js`.
4. Commit that file and let the **Deploy to GitHub Pages** workflow finish. The button then posts to Formspree from the browser.

To receive submissions with a Google Form:

1. Create a form with the same five questions, in any order.
2. Open the form, choose the three-dot menu, and click **Get pre-filled link**. Fill each answer with a placeholder, then copy the link. Each answer appears as `entry.#########=`.
3. Set `suggestionEndpoint` to the form response URL: `https://docs.google.com/forms/d/e/FORM_ID/formResponse` (the public form link with `viewform` replaced by `formResponse`).
4. Set `suggestionFields` to those entry ids:

```javascript
suggestionFields: {
  building: "entry.1111111111",
  category: "entry.2222222222",
  location: "entry.3333333333",
  note: "entry.4444444444",
  email: "entry.5555555555",
},
```

5. Commit `site/config.js` and wait for Pages to redeploy.

No account is created by this repository. Until `suggestionEndpoint` is filled in, suggestions are not stored anywhere.

## Methodology

### What the team collected

The source is one row per building in a Google Sheet, exported to `data/amenities_raw.csv`. Cells are free text, not counts. Columns are Building, Abbrev, Microwave / Location, Microwave Restrictions, Printer Location, Lost and Found Location, Food Vending, Drink Vending, Chargers / Lab Equipment, Study Friendly Level, and Notes.

**TODO (team):** the dates and times of collection. They are not in the sheet, so they are not filled in here.

**TODO (team):** who recorded which buildings.

**TODO (team):** the walk-through rules (whether every floor was checked, whether closed rooms were skipped, and whether a second person confirmed a count).

### How the sheet was parsed

`scripts/build_dataset.py` reads the raw CSV and writes the clean tables. Rules, applied in order:

- Blank cells add nothing.
- A food-vending cell that starts with “None” adds no snack machine. The sentence is kept as a note. The ILCB marketplace is in that category of note.
- “Probably”, “not confirmed”, or “unconfirmed” is stored with `count_confidence = unconfirmed`, `confirmed = false`, and `include_in_total = false`. Mitchell Physics is the only row like this.
- A stated number is an explicit count. “2 microwaves, 1st floor” is 2. “4 drink machines” is 4. Printer lines such as “2 Color MFP Printers in Room 219” are 2.
- “Yes”, with or without a floor, is counted as 1 and marked `presence_only`. That may be low if several machines were present and nobody wrote a number.
- A place with no number is counted as 1 per listed place (`inferred_from_locations`). Semicolons split places. “Floors 1, 2 and 3” is 3. Two named floors in one microwave cell, as in Zachry, are 2. The Academic Building cell “Various places” has no list and no number, so the count is blank and it is left out of the total.
- Lost and found text split on “Also” is two places. ILCB has the staircase and the IMS office.
- A printer cell can name a total (“3 printers:” plus the places). The places are not added on top of that total. The Medical Sciences Library also cites “TAMU OAL list: 1 Black/White Printer in Room 109”. That 1 is kept on the building and is not added to the campus total, because it may already be inside the stated 3.
- Evans Library, the Evans Library Annex, and the Student Computing Center are separate sections of the Evans printer cell. Their stated numbers are added together and stay on the Evans pin, because the sheet put them in the Evans row.
- Microwave restrictions are copied onto every microwave record for that building. Zachry’s note “ZLP students only, 1st Gen Students” is a restriction. “No tray, so the food does not spin” at the Medical Sciences Library is a description of the machine, not an access rule. Hotard’s “Available to students” is kept in the location text, not treated as a restriction.
- The chargers / lab equipment column is not one of the five categories. The 12th Man Technology store is a retail store. Zachry’s tech vending machine is not a snack or drink machine. Bagel Block is a food counter. All three are kept under “written down, not counted”.

Campus totals from this parse:

| Category | Counted | Also in the sheet, not in the count |
| --- | ---: | --- |
| Microwaves | 19 | Academic Building, number not stated |
| Snack vending | 5 | Mitchell Physics, “Probably yes, 3rd floor (not confirmed)” |
| Drink vending | 12 | |
| Lost and found | 4 | |
| Printers | 44 | Medical Sciences Library, 1 OAL printer not added to the 3 already stated |

### Where the coordinates came from

Building coordinates are supplementary external data. The team did not collect them.

On 2026-11-08 the public Texas A&M Facilities Coordination layer was queried:

`https://gis.tamu.edu/arcgis/rest/services/FCOR/TAMU_BaseMap_060826/MapServer/2`

Each sheet row was matched by building name to that layer’s `BldgName`, `BldgAbbrev`, address, and latitude/longitude. The match, including cases where the sheet abbreviation is not the official code, is stored in `data/building_coordinates.csv`. The Innovative Learning Classroom Building feature had a footprint but empty latitude and longitude attributes, so the pin is the centroid of that polygon.

OpenStreetMap tiles are only the basemap. The pins are not OSM centroids.

These name decisions are in the coordinate file, and on each pin:

- Rudder is Rudder Tower (the Forum and Rudder Plaza), not Rudder Residence Hall.
- The J. Mike Walker ’66 Department of Mechanical Engineering row is pinned to the James J. Cain ’51 Building, whose code is JCAIN.
- Dwight Look Engineering Building is the official DLEB building. The sheet abbreviated that row DWEB and also had a row labeled Civil Engineering Building (DLEB). Those rows were merged onto this pin. Both described 2 microwaves on the 1st floor, so the count stays 2.
- Student Recreation Center is SREC, not the Southside Recreation Center.
- EIC is the Engineering Innovation Center at 233 Ireland St. Blocker is 155 Ireland St, which matches the sheet’s “building next to Blocker”.
- West Campus Library is the GIS building of that name, not the Wehner Building. BARC is not a separate building in the layer.

## Limitations

 ## About this data

> [!NOTE]
> This site is a student project. It is not run, endorsed or reviewed by Texas A&M University. Building names and codes come from public TAMU sources and may not match official records.

- Nothing here is a live inventory. Machines move, rooms close, and restrictions change.
- Data was collected by student volunteers, so coverage leans toward the engineering and academic core. Dorms, apartments and non-public buildings were left out on purpose.
- Collection dates, collectors, and the exact survey procedure are on our [data sheet](https://docs.google.com/spreadsheets/d/12WLBW1zNqTBp67t4CrOgGyRAV87L5BIzy7u9PrSXHy4/edit?gid=0#gid=0).
- **Last updated:** 11/8/2026

## Limitations

### Coverage

- Coverage is whatever buildings are in the sheet. Most of campus is missing.
- A missing entry means "not recorded," not "doesn't exist." We have no estimate of how complete the data is.
- Not all buildings were fully open, and not all floors of every building were explored.
- 3 microwave entries started as Reddit reports.
- Academic building microwaves still need to be verified.

### How the notes became numbers

- The notes are free text, so counts are approximate.
  - "Yes" was counted as 1, which can undercount.
  - A floor listed with no number was counted as 1. This can undercount, or overcount if the writer was listing an area and not a machine.
- Some sheet rows mixed a building with nearby rooms (Evans Annex, Student Computing Center, BARC Room 124A). We did not split these into new buildings the sheet did not list.
- Jack E. Brown (JEB, also called Jackie B.) has 3 microwaves inside the glass-door lounge. These were added to the existing JEB pin.
- "Study friendly" ratings are subjective, but they are based on the availability of seating, whiteboards, study rooms, and charging ports.

### Map and "Find nearest"

- Pins are the GIS point for the building, not the room where the microwave sits.
- "Find nearest" is a straight line from your browser's location to a building point.
  - It is not a walking route.
  - It ignores floors and building hours.
  - It skips anything that could not be geolocated.

### What we did not record

- Building hours, Aggie ID or card access, after-hours locks, and event closures. Some microwaves are limited to certain groups, and our restriction notes may be incomplete.
- Whether a machine was working, whether a microwave had a turntable, or how clean it was. We only noted what was there when we visited.
- Vending machine contents, prices, and payment types.
- Accessibility, such as elevator access, door width, or reach height.

> [!WARNING]
> Please don't use this site to judge accessibility.

- For lost items, contact the official office (for example, MSC Programs, Suite 2240). Pins here may not show every drop-off point.

## Suggestions and privacy

- Suggestions are reviewed promptly.
- The optional email is used only to tell you when your suggestion is approved. It is deleted afterward and is not shared.
- To report an error, contact ap65693@tamu.edu.

## Map behavior

- **Category buttons** hide buildings that have none of the selected categories. Buildings with nothing recorded stay visible only while every category is on.
- **Search** matches the sheet name, the official name, abbreviations, and the address.
- **"Study friendly only"** keeps rows marked Yes.
- **Campus totals** do not change when you filter. The building list does.
- **Clicking a pin** lists each category with the count, the place, any restriction, and whether the number was stated, inferred, or unconfirmed.
