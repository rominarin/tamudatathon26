#!/usr/bin/env python3
"""Checks the amenity parse against the decisions documented in the README."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_dataset as dataset


def records(result, building_id, category):
    building = next(item for item in result["buildings"] if item["building_id"] == building_id)
    return [item for item in building["amenities"] if item["category"] == category]


def main() -> None:
    result = dataset.build()
    totals = result["totals"]
    assert len(result["buildings"]) == 22
    assert sum(1 for building in result["buildings"] if building["mapped"]) == 21
    unmapped = [building["building_name"] for building in result["buildings"] if not building["mapped"]]
    assert unmapped == ["Civil Engineering Building"]

    assert totals["microwave"]["counted"] == 18
    assert totals["snack_vending"]["counted"] == 5
    assert totals["snack_vending"]["unconfirmed"] == 1
    assert totals["drink_vending"]["counted"] == 12
    assert totals["lost_and_found"]["counted"] == 4
    assert totals["printer"]["counted"] == 44
    assert totals["microwave"]["unspecified_buildings"] == ["Academic Building"]

    zach_microwaves = records(result, "zach", "microwave")
    assert [item["location_detail"] for item in zach_microwaves] == ["4th floor", "3rd floor SEAS Office"]
    assert all(item["restrictions"] == "ZLP students only, 1st Gen Students" for item in zach_microwaves)

    assert [item["count"] for item in records(result, "rudder", "drink_vending")] == [2, 1]
    assert [item["count"] for item in records(result, "jcain", "drink_vending")] == [4]
    assert records(result, "jcain", "snack_vending")[0]["location_detail"] == "Location not stated"

    ilcb_categories = {item["category"] for item in records(result, "ilcb", "snack_vending")}
    assert ilcb_categories == set()
    ilcb = next(item for item in result["buildings"] if item["building_id"] == "ilcb")
    assert any("marketplace" in mention.lower() for mention in ilcb["other_mentions"])
    assert len(records(result, "ilcb", "lost_and_found")) == 2

    msl_printers = records(result, "msl", "printer")
    assert [(item["count"], item["include_in_total"]) for item in msl_printers] == [(3, True), (1, False)]
    assert "OAL print allocation" in msl_printers[0]["restrictions"]

    mphy = records(result, "mphy", "snack_vending")
    assert mphy[0]["count_confidence"] == "unconfirmed"
    assert mphy[0]["include_in_total"] is False

    acad = records(result, "acad", "microwave")
    assert acad[0]["count"] is None
    assert acad[0]["count_confidence"] == "unspecified"

    evans = records(result, "evans", "printer")
    assert sum(item["count"] for item in evans) == 18
    assert any(item["section"].startswith("Evans Library Annex") for item in evans)
    assert any(item["section"] == "Student Computing Center" for item in evans)

    msc = next(item for item in result["buildings"] if item["building_id"] == "msc")
    assert any("retail store" in mention for mention in msc["other_mentions"])
    zach = next(item for item in result["buildings"] if item["building_id"] == "zach")
    assert any("Tech vending" in mention for mention in zach["other_mentions"])
    bloc = next(item for item in result["buildings"] if item["building_id"] == "bloc")
    assert any("Bagel Block" in mention for mention in bloc["other_mentions"])

    for building in result["buildings"]:
        assert building["coordinate_source"].startswith("Texas A&M Facilities Coordination")
        for item in building["amenities"]:
            assert item["category"] in dataset.CATEGORIES
        if building["mapped"]:
            assert 30.58 <= building["latitude"] <= 30.65
            assert -96.37 <= building["longitude"] <= -96.32
        else:
            assert building["latitude"] is None

    ilcb_building = next(item for item in result["buildings"] if item["building_id"] == "ilcb")
    assert ilcb_building["coordinate_method"] == "footprint_centroid"
    dwight = next(item for item in result["buildings"] if item["building_id"] == "dweb")
    assert dwight["official_abbrev"] == "DLEB"
    assert dwight["sheet_abbrev"] == "DWEB"
    print("dataset checks passed")


if __name__ == "__main__":
    main()
