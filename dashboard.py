"""TAMU Datathon 2026 project dashboard.

How to run
----------
    pip install -r requirements.txt
    streamlit run dashboard.py

Data
----
The app reads the first CSV it can find:

    1. The path in the DATA_PATH environment variable
    2. data/metrics.csv (relative to this file)

Required columns, with accepted aliases:

    timestamp   date, time, datetime, ds
    value       amount, y, count, score

Optional columns:

    segment     category, group, label, series   (default: "all")
    metric      measure, kpi, name               (default: "value")

Until that file exists, the page shows seeded PLACEHOLDER series so the
layout can be reviewed. Those numbers are not project measurements.
Replace the CSV and rerun; nothing else in this file needs to change.
"""

from __future__ import annotations

import math
import os
import random
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

ROOT = Path(__file__).resolve().parent
PLACEHOLDER_NOTE = (
    "Placeholder data. These numbers are a seeded stand-in, not analysis output. "
    "Add data/metrics.csv (columns: timestamp, segment, metric, value) or set "
    "DATA_PATH, then rerun."
)

COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "timestamp": ("timestamp", "date", "time", "datetime", "ds"),
    "segment": ("segment", "category", "group", "label", "series"),
    "metric": ("metric", "measure", "kpi", "name"),
    "value": ("value", "amount", "y", "count", "score"),
}

COLORWAY = ["#500000", "#8C4A3A", "#1F4E79", "#3D5A4C", "#6B4C7A", "#A67C2D"]


def candidate_paths() -> list[Path]:
    """CSV locations checked in order. Missing paths are skipped."""
    paths: list[Path] = []
    env_path = os.environ.get("DATA_PATH", "").strip()
    if env_path:
        paths.append(Path(env_path).expanduser())
    paths.append(ROOT / "data" / "metrics.csv")
    return paths


def resolve_data_path() -> Path | None:
    for path in candidate_paths():
        if path.is_file():
            return path
    return None


def parse_timestamps(series: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(series, errors="coerce", format="mixed")
    if getattr(parsed.dt, "tz", None) is not None:
        parsed = parsed.dt.tz_convert(None)
    return parsed


def normalize_frame(raw: pd.DataFrame) -> pd.DataFrame:
    """Map a project CSV onto timestamp, segment, metric, and value."""
    lookup = {str(column).strip().lower(): column for column in raw.columns}
    rename: dict[object, str] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in lookup:
                rename[lookup[alias]] = canonical
                break

    frame = raw.rename(columns=rename).copy()
    missing = [name for name in ("timestamp", "value") if name not in frame.columns]
    if missing:
        found = ", ".join(map(str, raw.columns)) or "(none)"
        raise ValueError(
            "CSV needs a timestamp column (timestamp/date/time) and a value "
            f"column (value/amount/y). Missing {missing}. Found columns: {found}."
        )

    if "segment" not in frame.columns:
        frame["segment"] = "all"
    if "metric" not in frame.columns:
        frame["metric"] = "value"

    frame["timestamp"] = parse_timestamps(frame["timestamp"])
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
    frame = frame.dropna(subset=["timestamp", "value"])
    frame["segment"] = frame["segment"].astype(str)
    frame["metric"] = frame["metric"].astype(str)
    return frame[["timestamp", "segment", "metric", "value"]].sort_values(
        ["metric", "segment", "timestamp"]
    )


def placeholder_frame(end: datetime | None = None) -> pd.DataFrame:
    """Stable fake series so the dashboard renders before real outputs exist.

    The seed is fixed. Edit this function, or replace it by adding a CSV,
    when the project has real columns.
    """
    rng = random.Random(2026)
    last_day = (end or datetime(2026, 11, 7)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    segments = ("north", "south", "east", "west")
    rows: list[dict[str, object]] = []
    for day_index in range(30):
        day = last_day - timedelta(days=29 - day_index)
        for segment_index, segment in enumerate(segments):
            phase = segment_index * 0.7
            volume = (
                100
                + 1.6 * day_index
                + 14 * math.sin(day_index / 4 + phase)
                + rng.uniform(-5, 5)
                + segment_index * 9
            )
            score = (
                0.61
                + 0.007 * day_index
                + 0.045 * math.sin(day_index / 5 + phase)
                + rng.uniform(-0.012, 0.012)
            )
            latency = (
                290
                - 2.4 * day_index
                + 16 * math.sin(day_index / 3.5 + phase)
                + rng.uniform(-7, 7)
                + segment_index * 12
            )
            values = {
                "volume": max(0.0, volume),
                "score": min(0.99, max(0.0, score)),
                "latency_ms": max(1.0, latency),
            }
            for metric, value in values.items():
                rows.append(
                    {
                        "timestamp": day,
                        "segment": segment,
                        "metric": metric,
                        "value": float(value),
                    }
                )
    return pd.DataFrame(rows)


def load_metrics() -> tuple[pd.DataFrame, str, str | None]:
    """Return the frame, a source label, and an optional error message.

    On a missing or unreadable file the frame is placeholder data and the
    label is ``placeholder``.
    """
    path = resolve_data_path()
    if path is None:
        return placeholder_frame(), "placeholder", None

    try:
        frame = normalize_frame(pd.read_csv(path))
    except Exception as exc:  # surface schema and parse problems in the UI
        return placeholder_frame(), "placeholder", f"Could not use {path}: {exc}"

    if frame.empty:
        return (
            placeholder_frame(),
            "placeholder",
            f"{path} did not contain any rows with a timestamp and a numeric value.",
        )
    return frame, str(path), None


def format_number(metric: str, value: float) -> str:
    if metric == "score" or (0 <= abs(value) <= 1.5 and metric != "volume"):
        return f"{value:.3f}"
    if abs(value) >= 100:
        return f"{value:,.1f}"
    return f"{value:,.2f}"


def latest_change(frame: pd.DataFrame) -> tuple[float | None, float | None]:
    """Mean value on the newest timestamp, and the change from the one before."""
    if frame.empty:
        return None, None
    latest = frame["timestamp"].max()
    latest_mean = float(frame.loc[frame["timestamp"] == latest, "value"].mean())
    earlier = frame.loc[frame["timestamp"] < latest, "timestamp"]
    if earlier.empty:
        return latest_mean, None
    previous = earlier.max()
    previous_mean = float(frame.loc[frame["timestamp"] == previous, "value"].mean())
    return latest_mean, latest_mean - previous_mean


def filter_frame(
    frame: pd.DataFrame,
    metric: str,
    segments: list[str],
    start: datetime,
    end: datetime,
) -> pd.DataFrame:
    mask = (
        (frame["metric"] == metric)
        & (frame["segment"].isin(segments))
        & (frame["timestamp"] >= start)
        & (frame["timestamp"] <= end)
    )
    return frame.loc[mask].sort_values(["timestamp", "segment"])


def line_chart(frame: pd.DataFrame, metric: str):
    figure = px.line(
        frame,
        x="timestamp",
        y="value",
        color="segment",
        markers=True,
        template="plotly_white",
        color_discrete_sequence=COLORWAY,
        labels={"timestamp": "Date", "value": metric, "segment": "Segment"},
    )
    figure.update_layout(
        margin=dict(l=8, r=8, t=28, b=8),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0),
    )
    return figure


def bar_chart(frame: pd.DataFrame, metric: str):
    summary = (
        frame.groupby("segment", as_index=False)["value"]
        .mean()
        .sort_values("value", ascending=False)
    )
    figure = px.bar(
        summary,
        x="segment",
        y="value",
        template="plotly_white",
        color="segment",
        color_discrete_sequence=COLORWAY,
        labels={"segment": "Segment", "value": f"Mean {metric}"},
    )
    figure.update_layout(showlegend=False, margin=dict(l=8, r=8, t=28, b=8))
    return figure


def render() -> None:
    st.set_page_config(
        page_title="TAMU Datathon 2026",
        page_icon=":bar_chart:",
        layout="wide",
    )
    frame, source, error = load_metrics()
    using_placeholder = source == "placeholder"

    st.title("TAMU Datathon 2026")
    st.caption("Project dashboard")

    if using_placeholder:
        st.warning(PLACEHOLDER_NOTE)
    else:
        st.success(f"Loaded {source}")
    if error:
        st.error(error)

    metrics = sorted(frame["metric"].unique())
    default_metric = "volume" if "volume" in metrics else metrics[0]
    segments = sorted(frame["segment"].unique())
    min_ts = frame["timestamp"].min().to_pydatetime()
    max_ts = frame["timestamp"].max().to_pydatetime()

    with st.sidebar:
        st.header("Filters")
        st.caption(
            "Source: placeholder" if using_placeholder else f"Source: {source}"
        )
        metric = st.selectbox(
            "Metric",
            metrics,
            index=metrics.index(default_metric),
        )
        chosen_segments = st.multiselect("Segments", segments, default=segments)
        date_range = st.date_input(
            "Dates",
            value=(min_ts.date(), max_ts.date()),
            min_value=min_ts.date(),
            max_value=max_ts.date(),
        )
        with st.expander("CSV columns"):
            st.markdown(
                "`timestamp`, `segment`, `metric`, `value`.\n\n"
                "Aliases such as `date` and `category` are accepted. "
                "A file with only a date and a number still loads."
            )
            st.download_button(
                "Download the table currently in memory",
                data=frame.to_csv(index=False),
                file_name="metrics.csv",
                mime="text/csv",
            )

    if isinstance(date_range, tuple):
        if len(date_range) != 2:
            st.info("Select a start date and an end date.")
            return
        start_day, end_day = date_range
    else:
        start_day = end_day = date_range

    start = datetime.combine(start_day, datetime.min.time())
    end = datetime.combine(end_day, datetime.max.time())
    filtered = filter_frame(frame, metric, chosen_segments, start, end)

    if filtered.empty:
        st.info("No rows match these filters.")
        return

    latest_mean, delta = latest_change(filtered)
    day_span = filtered["timestamp"].dt.date.nunique()
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Latest reading", format_number(metric, latest_mean or 0.0))
    c2.metric(
        "Change vs prior point",
        "—" if delta is None else format_number(metric, delta),
    )
    c3.metric("Rows", f"{len(filtered):,}")
    c4.metric("Days", f"{day_span:,}")

    st.plotly_chart(line_chart(filtered, metric))

    chart_col, table_col = st.columns((1, 1))
    with chart_col:
        st.plotly_chart(bar_chart(filtered, metric))
    with table_col:
        preview = filtered.copy()
        preview["timestamp"] = preview["timestamp"].dt.strftime("%Y-%m-%d")
        preview["value"] = preview["value"].map(lambda v: round(float(v), 4))
        st.dataframe(preview, hide_index=True)


render()
